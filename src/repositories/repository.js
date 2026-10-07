/** SQL is isolated from HTTP and business rules. Values always use placeholders. */
export function createRepository(pool) {
  const all = async (sql, args = []) => (await pool.execute(sql, args))[0];
  const one = async (sql, args = []) => (await all(sql, args))[0] || null;
  const filter = (f = {}) => {
    const clauses = [],
      args = [];
    for (const [key, column] of [
      ['apiKeyId', 'r.api_key_id'],
      ['domainId', 'r.domain_id'],
      ['phone', 'r.phone'],
    ])
      if (f[key]) {
        clauses.push(`${column}=?`);
        args.push(f[key]);
      }
    return {
      where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
      args,
      and: clauses.length ? ' AND ' + clauses.join(' AND ') : '',
    };
  };
  return {
    health: () => one('SELECT 1 ok'),
    async ttl() {
      return Number(
        (await one('SELECT value FROM settings WHERE `key`=?', ['cache_ttl_seconds'])).value,
      );
    },
    setTtl: (value) =>
      all('UPDATE settings SET value=? WHERE `key`=?', [String(value), 'cache_ttl_seconds']),
    findDomain: (origin) => one('SELECT * FROM domains WHERE origin=? AND enabled=1', [origin]),
    findKey: (digest) => one('SELECT id,name FROM api_keys WHERE digest=? AND enabled=1', [digest]),
    listKeys: () =>
      all('SELECT id,name,prefix,enabled,created_at FROM api_keys ORDER BY created_at DESC'),
    addKey: (k) =>
      all('INSERT INTO api_keys(id,name,digest,prefix,created_at) VALUES (?,?,?,?,?)', [
        k.id,
        k.name,
        k.digest,
        k.prefix,
        k.createdAt,
      ]),
    setKey: (id, enabled) => all('UPDATE api_keys SET enabled=? WHERE id=?', [enabled, id]),
    listDomains: () => all('SELECT * FROM domains ORDER BY created_at DESC'),
    addDomain: (d) =>
      all('INSERT INTO domains(id,origin,created_at) VALUES (?,?,?)', [
        d.id,
        d.origin,
        d.createdAt,
      ]),
    setDomain: (id, enabled) => all('UPDATE domains SET enabled=? WHERE id=?', [enabled, id]),
    findSession: (digest) =>
      one('SELECT * FROM sessions WHERE digest=? AND expires_at>?', [digest, Date.now()]),
    addSession: (s) =>
      all('INSERT INTO sessions(digest,csrf,admin_key_digest,expires_at) VALUES (?,?,?,?)', [
        s.digest,
        s.csrf,
        s.adminKeyDigest,
        s.expiresAt,
      ]),
    deleteSession: (digest) => all('DELETE FROM sessions WHERE digest=?', [digest]),
    expireSessions: () => all('DELETE FROM sessions WHERE expires_at<=?', [Date.now()]),
    async saveConnections(users) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // Preserve rotation and historical links even when a remote account disappears.
        await connection.execute('UPDATE connections SET connected=0,logged_in=0');
        for (const u of users)
          await connection.execute(
            `INSERT INTO connections(id,name,token,jid,connected,logged_in,synced_at) SELECT ?,?,?,?,?,?,? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deleted_connections WHERE id=?) ON DUPLICATE KEY UPDATE name=VALUES(name),token=VALUES(token),jid=VALUES(jid),connected=VALUES(connected),logged_in=VALUES(logged_in),synced_at=VALUES(synced_at)`,
            [u.id, u.name, u.token, u.jid, u.connected, u.loggedIn, u.syncedAt, u.id],
          );
        await connection.commit();
      } catch (e) {
        await connection.rollback();
        throw e;
      } finally {
        connection.release();
      }
    },
    listConnections: () =>
      all(
        'SELECT id,name,jid,connected,logged_in,rotation,last_used,synced_at FROM connections c WHERE NOT EXISTS (SELECT 1 FROM deleted_connections d WHERE d.id=c.id) ORDER BY name',
      ),
    findConnection: (id) =>
      one(
        'SELECT * FROM connections c WHERE id=? AND NOT EXISTS (SELECT 1 FROM deleted_connections d WHERE d.id=c.id)',
        [id],
      ),
    async deleteConnection(id) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          'INSERT IGNORE INTO deleted_connections(id,deleted_at) VALUES (?,?)',
          [id, Date.now()],
        );
        await connection.execute(
          "UPDATE connections SET token='',connected=0,logged_in=0,rotation=0 WHERE id=?",
          [id],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    rotationCandidates: () =>
      all(
        'SELECT * FROM connections c WHERE rotation=1 AND connected=1 AND logged_in=1 AND NOT EXISTS (SELECT 1 FROM deleted_connections d WHERE d.id=c.id) ORDER BY last_used,id',
      ),
    markUsed: (id, time) => all('UPDATE connections SET last_used=? WHERE id=?', [time, id]),
    setRotation: (id, value) => all('UPDATE connections SET rotation=? WHERE id=?', [value, id]),
    setStatus: (id, connected, loggedIn) =>
      all('UPDATE connections SET connected=?,logged_in=?,synced_at=? WHERE id=?', [
        Number(connected),
        Number(loggedIn),
        Date.now(),
        id,
      ]),
    async findCached(phone, cutoff) {
      const photo = await one(
        'SELECT id,phone,source_url,mime,saved_at FROM photos WHERE phone=? AND invalidated=0 AND saved_at>? ORDER BY saved_at DESC,id DESC LIMIT 1',
        [phone, cutoff],
      );
      const missing = await one(
        'SELECT phone,saved_at FROM missing_photos WHERE phone=? AND invalidated=0 AND saved_at>?',
        [phone, cutoff],
      );
      return missing && (!photo || missing.saved_at >= photo.saved_at)
        ? { ...missing, notFound: true }
        : photo;
    },
    addMissing: (p) =>
      all(
        'INSERT INTO missing_photos(phone,saved_at,invalidated) VALUES (?,?,0) ON DUPLICATE KEY UPDATE saved_at=VALUES(saved_at),invalidated=0',
        [p.phone, p.saved_at],
      ),
    addPhoto: (p) =>
      all(
        'INSERT INTO photos(id,phone,source_url,image,mime,connection_id,saved_at) VALUES (?,?,?,?,?,?,?)',
        [p.id, p.phone, p.source_url, p.image, p.mime, p.connectionId, p.saved_at],
      ),
    findImage: (id) => one('SELECT image,mime FROM photos WHERE id=?', [id]),
    async invalidate(phone) {
      const photos = await all('UPDATE photos SET invalidated=1 WHERE phone=? AND invalidated=0', [
        phone,
      ]);
      const missing = await all(
        'UPDATE missing_photos SET invalidated=1 WHERE phone=? AND invalidated=0',
        [phone],
      );
      return { affectedRows: photos.affectedRows + missing.affectedRows };
    },
    addRequest: (r) =>
      all(
        'INSERT INTO requests(id,phone,api_key_id,domain_id,origin,photo_id,cache_hit,status,error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
          r.id,
          r.phone,
          r.apiKeyId,
          r.domainId,
          r.origin,
          r.photoId,
          Number(r.cacheHit),
          r.status,
          r.error,
          r.createdAt,
        ],
      ),
    async stats(filters, ttl) {
      const f = filter(filters);
      const stats = await one(
        `SELECT COUNT(*) totalRequests,COALESCE(SUM(r.cache_hit),0) cacheHits,COALESCE(SUM(r.status>=400),0) errors,COUNT(DISTINCT r.photo_id) savedPhotos FROM requests r${f.where}`,
        f.args,
      );
      stats.validCache =
        ttl === 0
          ? 0
          : Number(
              (
                await one(
                  `SELECT COUNT(DISTINCT entries.phone) count FROM (
                    SELECT p.phone FROM photos p WHERE p.invalidated=0 AND p.saved_at>? AND EXISTS (SELECT 1 FROM requests r WHERE r.photo_id=p.id${f.and})
                    UNION ALL
                    SELECT n.phone FROM missing_photos n WHERE n.invalidated=0 AND n.saved_at>? AND EXISTS (SELECT 1 FROM requests r WHERE r.phone=n.phone AND r.status=404 AND r.created_at>=n.saved_at${f.and})
                  ) entries`,
                  [Date.now() - ttl * 1000, ...f.args, Date.now() - ttl * 1000, ...f.args],
                )
              ).count,
            );
      if (!f.where)
        stats.savedPhotos = Number((await one('SELECT COUNT(*) count FROM photos')).count);
      for (const field of ['totalRequests', 'cacheHits', 'errors', 'savedPhotos'])
        stats[field] = Number(stats[field]);
      return stats;
    },
    async history(filters) {
      const f = filter(filters),
        page = filters.page || 1;
      // Bounded integer from validation; mysql2 otherwise treats LIMIT as DOUBLE.
      const offset = (page - 1) * 30;
      const items = await all(
        `SELECT r.*,k.name api_key_name,d.origin domain,p.source_url,COALESCE(p.saved_at,n.saved_at) saved_at,COALESCE(p.invalidated,n.invalidated) invalidated,(n.phone IS NOT NULL) negative_cache FROM requests r LEFT JOIN api_keys k ON k.id=r.api_key_id LEFT JOIN domains d ON d.id=r.domain_id LEFT JOIN photos p ON p.id=r.photo_id LEFT JOIN missing_photos n ON n.phone=r.phone AND r.status=404 AND r.photo_id IS NULL AND n.saved_at<=r.created_at${f.where} ORDER BY r.created_at DESC,r.id LIMIT 30 OFFSET ${offset}`,
        f.args,
      );
      const total = Number(
        (await one(`SELECT COUNT(*) count FROM requests r${f.where}`, f.args)).count,
      );
      return { items, total, page };
    },
  };
}
