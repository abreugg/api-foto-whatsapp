/** Test double only. Production exclusively uses the MySQL repository. */
export function memoryRepository(initialTtl = 3600) {
  const state = {
    ttl: initialTtl,
    keys: [],
    domains: [],
    sessions: [],
    connections: [],
    deletedConnections: [],
    photos: [],
    missing: [],
    requests: [],
  };
  const changed = (count) => ({ affectedRows: count });
  const matches = (r, f) =>
    (!f.apiKeyId || r.apiKeyId === f.apiKeyId) &&
    (!f.domainId || r.domainId === f.domainId) &&
    (!f.phone || r.phone === f.phone);
  return {
    state,
    async health() {
      return { ok: 1 };
    },
    async ttl() {
      return state.ttl;
    },
    async setTtl(ttl) {
      state.ttl = ttl;
    },
    async findKey(digest) {
      return state.keys.find((k) => k.digest === digest && k.enabled);
    },
    async findDomain(origin) {
      return state.domains.find((d) => d.origin === origin && d.enabled);
    },
    async listKeys() {
      return state.keys.map(({ digest, ...key }) => key);
    },
    async addKey(key) {
      state.keys.push({ ...key, enabled: 1 });
    },
    async setKey(id, enabled) {
      const key = state.keys.find((k) => k.id === id);
      if (key) key.enabled = enabled;
      return changed(Boolean(key));
    },
    async listDomains() {
      return state.domains;
    },
    async addDomain(domain) {
      if (state.domains.some((d) => d.origin === domain.origin))
        throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
      state.domains.push({ ...domain, enabled: 1 });
    },
    async setDomain(id, enabled) {
      const d = state.domains.find((d) => d.id === id);
      if (d) d.enabled = enabled;
      return changed(Boolean(d));
    },
    async findSession(digest) {
      const s = state.sessions.find((s) => s.digest === digest && s.expiresAt > Date.now());
      return s && { ...s, admin_key_digest: s.adminKeyDigest };
    },
    async addSession(s) {
      state.sessions.push(s);
    },
    async deleteSession(digest) {
      state.sessions = state.sessions.filter((s) => s.digest !== digest);
    },
    async expireSessions() {
      state.sessions = state.sessions.filter((s) => s.expiresAt > Date.now());
    },
    async saveConnections(users) {
      state.connections.forEach((c) => {
        c.connected = 0;
        c.logged_in = 0;
      });
      for (const user of users) {
        if (state.deletedConnections.includes(user.id)) continue;
        const old = state.connections.find((c) => c.id === user.id);
        const value = {
          ...user,
          connected: user.connected,
          logged_in: user.loggedIn,
          rotation: old?.rotation || 0,
          last_used: old?.last_used || 0,
        };
        if (old) Object.assign(old, value);
        else state.connections.push(value);
      }
    },
    async listConnections() {
      return state.connections
        .filter((c) => !state.deletedConnections.includes(c.id))
        .map(({ token, ...c }) => c);
    },
    async findConnection(id) {
      return state.connections.find((c) => c.id === id && !state.deletedConnections.includes(id));
    },
    async deleteConnection(id) {
      state.deletedConnections.push(id);
      Object.assign(
        state.connections.find((c) => c.id === id),
        { token: '', connected: 0, logged_in: 0, rotation: 0 },
      );
    },
    async rotationCandidates() {
      return state.connections
        .filter(
          (c) =>
            c.rotation && c.connected && c.logged_in && !state.deletedConnections.includes(c.id),
        )
        .sort((a, b) => a.last_used - b.last_used || a.id.localeCompare(b.id))
        .map((c) => ({ ...c }));
    },
    async markUsed(id, time) {
      state.connections.find((c) => c.id === id).last_used = time;
    },
    async setRotation(id, rotation) {
      state.connections.find((c) => c.id === id).rotation = rotation;
    },
    async setStatus(id, connected, loggedIn) {
      Object.assign(
        state.connections.find((c) => c.id === id),
        { connected: Number(connected), logged_in: Number(loggedIn) },
      );
    },
    async findCached(phone, cutoff) {
      return [...state.photos, ...state.missing]
        .filter((p) => p.phone === phone && !p.invalidated && p.saved_at > cutoff)
        .sort((a, b) => b.saved_at - a.saved_at)[0];
    },
    async addMissing(p) {
      state.missing = state.missing.filter((m) => m.phone !== p.phone);
      state.missing.push({ ...p, invalidated: 0 });
    },
    async addPhoto(p) {
      state.photos.push({ ...p, invalidated: 0 });
    },
    async findImage(id) {
      return state.photos.find((p) => p.id === id);
    },
    async invalidate(phone) {
      const photos = [...state.photos, ...state.missing].filter(
        (p) => p.phone === phone && !p.invalidated,
      );
      photos.forEach((p) => (p.invalidated = 1));
      return changed(photos.length);
    },
    async addRequest(r) {
      state.requests.push(r);
    },
    async stats(f, ttl) {
      const requests = state.requests.filter((r) => matches(r, f));
      const ids = new Set(requests.map((r) => r.photoId).filter(Boolean));
      return {
        totalRequests: requests.length,
        cacheHits: requests.filter((r) => r.cacheHit).length,
        errors: requests.filter((r) => r.status >= 400).length,
        savedPhotos: ids.size,
        validCache: ttl
          ? new Set(
              [...state.photos, ...state.missing]
                .filter(
                  (p) =>
                    (p.notFound
                      ? requests.some(
                          (r) =>
                            r.phone === p.phone && r.status === 404 && r.createdAt >= p.saved_at,
                        )
                      : ids.has(p.id)) &&
                    !p.invalidated &&
                    p.saved_at > Date.now() - ttl * 1000,
                )
                .map((p) => p.phone),
            ).size
          : 0,
      };
    },
    async history(f) {
      const rows = state.requests.filter((r) => matches(r, f)).reverse();
      return {
        items: rows.slice((f.page - 1) * 30, f.page * 30).map((r) => {
          const m = state.missing.find(
            (m) => m.phone === r.phone && r.status === 404 && m.saved_at <= r.createdAt,
          );
          return {
            ...r,
            ...(m ? { negative_cache: 1, saved_at: m.saved_at, invalidated: m.invalidated } : {}),
          };
        }),
        total: rows.length,
        page: f.page,
      };
    },
  };
}
