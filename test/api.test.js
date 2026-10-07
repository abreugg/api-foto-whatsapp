import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { memoryRepository } from './helpers/memory-repository.js';

const adminKey = 'admin-test-key-' + 'x'.repeat(40);
const phone = '5511999999999';
const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FQAAAABJRU5ErkJggg==',
  'base64',
);

async function fixture(t, overrides = {}) {
  const config = loadConfig({
    ADMIN_API_KEY: adminKey,
    APP_SECRET: 'test-secret-' + 'z'.repeat(40),
    WUZAPI_URL: 'http://wuzapi.test',
    WUZAPI_ADMIN_TOKEN: 'upstream-admin',
    MYSQL_PASSWORD: 'test-only',
    ADMIN_LOGIN_ATTEMPTS_PER_MINUTE: '3',
    ADMIN_RATE_LIMIT_PER_MINUTE: '200',
    PUBLIC_AUTH_ATTEMPTS_PER_MINUTE: '100',
    RATE_LIMIT_PER_MINUTE: '100',
    ...overrides,
  });
  const repo = memoryRepository();
  const calls = [],
    users = [
      {
        id: 'a',
        name: 'Principal',
        token: 'account-a',
        connected: true,
        loggedIn: true,
        jid: '5511000000000:1@s.whatsapp.net',
      },
      { id: 'b', name: 'Secundário', token: 'account-b', connected: true, loggedIn: true },
    ];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url === 'http://wuzapi.test/admin/users' && options.method === 'GET')
      return Response.json({ success: true, data: users });
    if (url === 'http://wuzapi.test/admin/users' && options.method === 'POST') {
      const input = JSON.parse(options.body);
      const user = { id: 'c', ...input, connected: false, loggedIn: false };
      users.push(user);
      return Response.json({ success: true, data: user }, { status: 201 });
    }
    if (url.startsWith('http://wuzapi.test/admin/users/') && options.method === 'DELETE') {
      if (overrides.deleteFailure) return Response.json({ success: false }, { status: 500 });
      const id = decodeURIComponent(url.split('/').pop());
      const index = users.findIndex((u) => u.id === id);
      if (index >= 0) users.splice(index, 1);
      return Response.json({ success: true, data: { id } });
    }
    if (url === 'http://wuzapi.test/user/avatar' && overrides.avatarResponse)
      return overrides.avatarResponse();
    if (url === 'http://wuzapi.test/user/avatar')
      return Response.json({ success: true, data: { URL: 'https://pps.whatsapp.net/test.png' } });
    if (url === 'http://wuzapi.test/session/connect')
      return Response.json({ data: { details: 'Connecting' } });
    if (url === 'http://wuzapi.test/session/disconnect')
      return Response.json({ data: { Details: 'Disconnected' } });
    if (url === 'http://wuzapi.test/session/status')
      return Response.json({
        data: {
          connected: true,
          loggedIn: options.headers.token !== users.find((u) => u.id === 'c')?.token,
          token: options.headers.token,
        },
      });
    if (url === 'http://wuzapi.test/session/qr')
      return Response.json({
        data: { QRCode: 'data:image/png;base64,' + imageBytes.toString('base64') },
      });
    if (url === 'https://pps.whatsapp.net/test.png')
      return new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } });
    throw Error('Unexpected request: ' + url);
  };
  const app = createApp({ config, repository: repo, fetcher });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  config.publicUrl = base;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  async function request(route, { method = 'GET', data, headers = {} } = {}) {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const payload = res.headers.get('content-type')?.includes('json')
      ? await res.json()
      : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: payload, headers: res.headers };
  }
  const admin = (route, opts = {}) =>
    request('/api/admin/' + route, {
      ...opts,
      headers: { 'X-Admin-Api-Key': adminKey, ...opts.headers },
    });
  async function key(name = 'CRM') {
    const result = await admin('keys', { method: 'POST', data: { name } });
    assert.equal(result.status, 201);
    return result.body;
  }
  async function ready() {
    await admin('connections');
    await admin('connections/a', { method: 'PATCH', data: { rotation: true } });
  }
  return { config, repo, calls, users, request, admin, key, ready, base };
}

test('public access requires approved Origin or active API key, with exact domain matching', async (t) => {
  const f = await fixture(t);
  await f.ready();
  assert.equal((await f.request('/api/photos/' + phone)).status, 401);
  const d = await f.admin('domains', { method: 'POST', data: { origin: 'https://site.test' } });
  assert.equal(d.status, 201);
  const good = await f.request('/api/photos/' + phone, {
    headers: { Origin: 'https://site.test' },
  });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://site.test');
  assert.equal(
    (
      await f.request('/api/photos/' + phone, {
        headers: { Origin: 'https://site.test.evil.test' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request('/api/photos', {
        method: 'OPTIONS',
        headers: { Origin: 'https://site.test' },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await f.request('/api/photos', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.test' },
      })
    ).status,
    403,
  );
  const k = await f.key();
  assert.equal(
    (await f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } })).status,
    200,
  );
  await f.admin('keys/' + k.id, { method: 'PATCH', data: { enabled: false } });
  assert.equal(
    (await f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } })).status,
    401,
  );
  await f.admin('domains/' + d.body.id, { method: 'PATCH', data: { enabled: false } });
  assert.equal(
    (await f.request('/api/photos/' + phone, { headers: { Origin: 'https://site.test' } })).status,
    401,
  );
});

test('cache, archived image, history per lookup, invalidation and filters', async (t) => {
  const f = await fixture(t);
  await f.ready();
  const k = await f.key();
  const headers = { 'X-Api-Key': k.key };
  const first = await f.request('/api/photos', {
    method: 'POST',
    data: { phone: '+55 (11) 99999-9999' },
    headers,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.cacheHit, false);
  assert.equal(first.body.phone, phone);
  const second = await f.request('/api/photos/' + phone, { headers });
  assert.equal(second.body.cacheHit, true);
  assert.equal(first.body.id, second.body.id);
  assert.notEqual(first.body.requestId, second.body.requestId);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/user/avatar')).length, 1);
  assert.equal(f.repo.state.requests.length, 2);
  const imagePath = new URL(first.body.url).pathname;
  assert.equal((await f.request(imagePath)).status, 401);
  assert.deepEqual((await f.request(imagePath, { headers })).body, imageBytes);
  const upstream = f.calls.find((c) => c.url.endsWith('/user/avatar'));
  assert.equal(upstream.headers.token, 'account-a');
  assert.deepEqual(JSON.parse(upstream.body), { Phone: phone, Preview: false });
  assert.equal(
    f.calls.find((c) => c.url.endsWith('/admin/users')).headers.Authorization,
    'upstream-admin',
  );
  assert.ok(!JSON.stringify((await f.admin('connections')).body).includes('account-a'));
  const stats = await f.admin('stats?apiKeyId=' + k.id);
  assert.deepEqual(stats.body, {
    totalRequests: 2,
    cacheHits: 1,
    errors: 0,
    savedPhotos: 1,
    validCache: 1,
  });
  assert.equal((await f.admin('stats?apiKeyId=other')).body.totalRequests, 0);
  assert.equal((await f.admin('history?phone=' + phone)).body.total, 2);
  await f.admin('cache', { method: 'DELETE', data: { phone } });
  assert.equal((await f.admin('stats')).body.validCache, 0);
  const third = await f.request('/api/photos/' + phone, { headers });
  assert.equal(third.body.cacheHit, false);
  assert.notEqual(third.body.id, first.body.id);
  assert.equal(f.repo.state.photos.length, 2);
  assert.equal(f.repo.state.requests.length, 3);
  assert.deepEqual((await f.request(imagePath, { headers })).body, imageBytes);
});

test('admin brute-force rate limit includes direct header authentication', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++)
    assert.equal(
      (await f.request('/api/admin/me', { headers: { 'X-Admin-Api-Key': 'bad-key' } })).status,
      401,
    );
  const blocked = await f.request('/api/admin/me', { headers: { 'X-Admin-Api-Key': 'bad-key' } });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});

test('invalid dashboard keys hit the login rate limit and authenticated admin calls have a total limit', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) {
    const result = await f.request('/api/admin/login', {
      method: 'POST',
      data: { apiKey: 'invalid-key' },
      headers: { Origin: f.base },
    });
    assert.equal(result.status, 401);
  }
  assert.equal(
    (
      await f.request('/api/admin/login', {
        method: 'POST',
        data: { apiKey: adminKey },
        headers: { Origin: f.base },
      })
    ).status,
    429,
  );
  const limited = await fixture(t, { ADMIN_RATE_LIMIT_PER_MINUTE: '2' });
  assert.equal((await limited.admin('me')).status, 200);
  assert.equal((await limited.admin('me')).status, 200);
  assert.equal((await limited.admin('me')).status, 429);
});

test('dashboard login uses admin API key, HttpOnly session and CSRF; logout invalidates it', async (t) => {
  const f = await fixture(t);
  const login = await f.request('/api/admin/login', {
    method: 'POST',
    data: { apiKey: adminKey },
    headers: { Origin: f.base },
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.equal((await f.request('/api/admin/me', { headers })).status, 200);
  assert.equal(
    (
      await f.request('/api/admin/settings', {
        method: 'PUT',
        headers,
        data: { cacheTtlSeconds: 10 },
      })
    ).status,
    403,
  );
  const secured = { ...headers, Origin: f.base, 'X-CSRF-Token': login.body.csrf };
  assert.equal(
    (
      await f.request('/api/admin/settings', {
        method: 'PUT',
        headers: secured,
        data: { cacheTtlSeconds: 10 },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request('/api/admin/logout', { method: 'POST', headers: secured })).status,
    200,
  );
  assert.equal((await f.request('/api/admin/me', { headers })).status, 401);
  assert.equal(f.repo.state.sessions.length, 0);
});

test('valid admin calls do not consume invalid authentication quota', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 8; i++) assert.equal((await f.admin('me')).status, 200);
  assert.equal((await f.request('/api/admin/me')).status, 401);
  assert.equal((await f.admin('me')).status, 200);
});

test('API key rate limit applies independently from authentication attempts', async (t) => {
  const f = await fixture(t, { RATE_LIMIT_PER_MINUTE: '2' });
  await f.ready();
  const k = await f.key();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } })).status,
      200,
    );
  assert.equal(
    (await f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } })).status,
    429,
  );
  assert.equal(f.repo.state.requests.length, 2);
});

test('rotation excludes disabled connections and serves cache while WhatsApp is offline', async (t) => {
  const f = await fixture(t);
  const k = await f.key();
  assert.equal(
    (await f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } })).status,
    503,
  );
  await f.ready();
  await f.admin('connections/b', { method: 'PATCH', data: { rotation: true } });
  await f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } });
  await f.request('/api/photos/5511888888888', { headers: { 'X-Api-Key': k.key } });
  assert.deepEqual(
    f.calls.filter((c) => c.url.endsWith('/user/avatar')).map((c) => c.headers.token),
    ['account-a', 'account-b'],
  );
  f.users.forEach((u) => {
    u.connected = false;
    u.loggedIn = false;
  });
  const cached = await f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } });
  assert.equal(cached.status, 200);
  assert.equal(cached.body.cacheHit, true);
  assert.equal(
    (await f.request('/api/photos/5511777777777', { headers: { 'X-Api-Key': k.key } })).status,
    503,
  );
});

test('parallel same-number requests share one upstream lookup and retain each request', async (t) => {
  const f = await fixture(t);
  await f.ready();
  const k = await f.key();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      f.request('/api/photos/' + phone, { headers: { 'X-Api-Key': k.key } }),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(f.calls.filter((c) => c.url.endsWith('/user/avatar')).length, 1);
  assert.equal(f.repo.state.requests.length, 6);
  assert.equal(f.repo.state.photos.length, 1);
});

test('zero TTL, expired cache, number validation and old lookup route', async (t) => {
  const f = await fixture(t);
  await f.ready();
  const k = await f.key(),
    headers = { 'X-Api-Key': k.key };
  assert.equal((await f.request('/api/photos/invalid', { headers })).status, 400);
  assert.equal(
    (await f.admin('settings', { method: 'PUT', data: { cacheTtlSeconds: -1 } })).status,
    400,
  );
  const legacy = await f.request('/v1/profile/' + phone, { headers });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.link, legacy.body.url);
  f.repo.state.photos[0].saved_at = Date.now() - 4000000;
  assert.equal((await f.request('/api/photos/' + phone, { headers })).body.cacheHit, false);
  await f.admin('settings', { method: 'PUT', data: { cacheTtlSeconds: 0 } });
  assert.equal((await f.request('/api/photos/' + phone, { headers })).body.cacheHit, false);
  assert.equal((await f.request('/api/photos/' + phone, { headers })).body.cacheHit, false);
  assert.equal((await f.admin('stats')).body.validCache, 0);
});

test('connection creation, QR, status and disconnect follow the documented WUZAPI contract', async (t) => {
  const f = await fixture(t);
  const created = await f.admin('connections', { method: 'POST', data: { name: 'Nova sessão' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 'c');
  const all = await f.admin('connections');
  assert.ok(!JSON.stringify(all.body).includes('token'));
  assert.equal((await f.admin('connections/c/connect', { method: 'POST' })).status, 200);
  assert.match((await f.admin('connections/c/qr')).body.QRCode, /^data:image\/png;base64,/);
  assert.deepEqual((await f.admin('connections/c/status')).body, {
    Connected: true,
    LoggedIn: false,
  });
  assert.equal((await f.admin('connections/c/disconnect', { method: 'POST' })).status, 200);
  assert.equal(f.repo.state.connections.find((c) => c.id === 'c').connected, 0);
});

test('dashboard and health are reachable; secret files and arbitrary static files are not', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/admin/')).status, 200);
  assert.equal((await f.request('/admin/app.js')).status, 200);
  assert.equal((await f.request('/admin/styles.css')).status, 200);
  assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/.env')).status, 404);
  assert.equal((await f.request('/admin/../../package.json')).status, 404);
});

test('missing avatars are cached, counted and invalidated without losing lookup history', async (t) => {
  const f = await fixture(t, { avatarResponse: () => Response.json({ success: true, data: {} }) });
  const k = await f.key();
  await f.ready();
  const lookup = '/api/photos/' + phone + '?apikey=' + k.key;
  const first = await f.request(lookup);
  assert.equal(first.status, 404);
  assert.equal(first.body.cacheHit, false);
  assert.ok(first.body.savedAt && first.body.expiresAt);
  const second = await f.request(lookup);
  assert.equal(second.status, 404);
  assert.equal(second.body.cacheHit, true);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/user/avatar')).length, 1);
  assert.equal(f.repo.state.requests.length, 2);
  let stats = (await f.admin('stats?apiKeyId=' + k.id)).body;
  assert.equal(stats.cacheHits, 1);
  assert.equal(stats.validCache, 1);
  assert.equal(stats.savedPhotos, 0);
  const history = (await f.admin('history')).body;
  assert.equal(history.items[0].negative_cache, 1);
  assert.equal((await f.admin('cache', { method: 'DELETE', data: { phone } })).body.invalidated, 1);
  assert.equal((await f.admin('stats')).body.validCache, 0);
  assert.equal(f.repo.state.requests.length, 2);
  assert.equal((await f.request(lookup)).body.cacheHit, false);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/user/avatar')).length, 2);
});

test('missing avatar TTL expires and zero disables reuse', async (t) => {
  const f = await fixture(t, { avatarResponse: () => Response.json({ success: true, data: {} }) });
  const k = await f.key();
  await f.ready();
  const lookup = '/api/photos/' + phone + '?apikey=' + k.key;
  await f.request(lookup);
  f.repo.state.missing[0].saved_at -= 3601000;
  assert.equal((await f.request(lookup)).body.cacheHit, false);
  await f.admin('settings', { method: 'PUT', data: { cacheTtlSeconds: 0 } });
  assert.equal((await f.request(lookup)).body.cacheHit, false);
  assert.equal((await f.request(lookup)).body.cacheHit, false);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/user/avatar')).length, 4);
});

test('transient upstream failures never create negative cache entries', async (t) => {
  const f = await fixture(t, {
    avatarResponse: () => Response.json({ success: false }, { status: 500 }),
  });
  const k = await f.key();
  await f.ready();
  const lookup = '/api/photos/' + phone + '?apikey=' + k.key;
  assert.equal((await f.request(lookup)).status, 502);
  assert.equal((await f.request(lookup)).status, 502);
  assert.equal(f.repo.state.missing.length, 0);
  assert.equal(f.repo.state.requests.length, 2);
});

test('concurrent missing avatar lookups share upstream work and keep separate history', async (t) => {
  const f = await fixture(t, {
    avatarResponse: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return Response.json({ success: true, data: {} });
    },
  });
  const k = await f.key();
  await f.ready();
  const lookup = '/api/photos/' + phone + '?apikey=' + k.key;
  const results = await Promise.all([f.request(lookup), f.request(lookup)]);
  assert.ok(results.every((r) => r.status === 404));
  assert.equal(results.filter((r) => r.body.cacheHit).length, 1);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/user/avatar')).length, 1);
  assert.equal(f.repo.state.requests.length, 2);
});

test('deleting a connection removes it remotely and from rotation while retaining archived photos and history', async (t) => {
  const f = await fixture(t);
  const k = await f.key();
  await f.ready();
  const lookup = '/api/photos/' + phone + '?apikey=' + k.key;
  const photo = await f.request(lookup);
  assert.equal(photo.status, 200);
  assert.equal((await f.request('/api/admin/connections/a', { method: 'DELETE' })).status, 401);
  const removed = await f.admin('connections/a', { method: 'DELETE' });
  assert.deepEqual(removed.body, { deleted: true, historyPreserved: true });
  assert.equal(
    f.users.some((u) => u.id === 'a'),
    false,
  );
  assert.equal(
    (await f.admin('connections')).body.some((c) => c.id === 'a'),
    false,
  );
  assert.equal(
    (await f.repo.rotationCandidates()).some((c) => c.id === 'a'),
    false,
  );
  assert.equal((await f.admin('connections/a/status')).status, 404);
  assert.equal(f.repo.state.connections.find((c) => c.id === 'a').token, '');
  assert.equal((await f.request(lookup)).body.cacheHit, true);
  assert.equal(
    (
      await f.request('/api/photos/' + photo.body.id + '/image', {
        headers: { 'X-Api-Key': k.key },
      })
    ).status,
    200,
  );
  assert.equal(f.repo.state.requests.length, 2);
  const operations = f.calls.filter(
    (c) => c.url.endsWith('/session/disconnect') || c.method === 'DELETE',
  );
  assert.deepEqual(
    operations.map((c) => c.method),
    ['POST', 'DELETE'],
  );
});

test('failed remote deletion keeps the connection visible and preserves local credentials', async (t) => {
  const f = await fixture(t, { deleteFailure: true });
  await f.ready();
  assert.equal((await f.admin('connections/a', { method: 'DELETE' })).status, 502);
  assert.equal(f.repo.state.deletedConnections.length, 0);
  assert.ok((await f.repo.findConnection('a')).token);
  assert.equal(
    (await f.repo.listConnections()).some((c) => c.id === 'a'),
    true,
  );
});

test('GET lookup accepts apikey query while POST requires header credentials', async (t) => {
  const f = await fixture(t);
  const k = await f.key();
  await f.ready();
  const lookup = '/api/photos/' + phone;
  assert.equal((await f.request(lookup + '?apikey=' + encodeURIComponent(k.key))).status, 200);
  assert.equal((await f.request(lookup + '?apikey=invalid')).status, 401);
  assert.equal((await f.request(lookup + '?apikey=' + k.key + '&apikey=invalid')).status, 401);
  assert.equal(
    (await f.request('/api/photos?apikey=' + k.key, { method: 'POST', data: { phone } })).status,
    401,
  );
  assert.equal(
    (
      await f.request('/api/photos', {
        method: 'POST',
        data: { phone },
        headers: { 'X-Api-Key': k.key },
      })
    ).status,
    200,
  );
  await f.admin('keys/' + k.id, { method: 'PATCH', data: { enabled: false } });
  assert.equal((await f.request(lookup + '?apikey=' + k.key)).status, 401);
});

test('integration guide download requires admin authentication and includes the consultation catalog', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/integration-guide')).status, 401);
  const guide = await f.admin('integration-guide');
  assert.equal(guide.status, 200);
  assert.match(guide.headers.get('content-disposition'), /attachment.*INTEGRATION_IA\.md/);
  const reference = await f.request('/admin/api-reference.json');
  assert.equal(reference.status, 200);
  for (const route of reference.body.routes)
    assert.ok(guide.body.toString().includes(route.method + ' ' + route.path));
});

test('cache settings accept 24 fixed-duration months and reject values beyond the documented maximum', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.admin('settings', { method: 'PUT', data: { cacheTtlSeconds: 62208000 } })).status,
    200,
  );
  assert.equal((await f.admin('settings')).body.cacheTtlSeconds, 62208000);
  assert.equal(
    (await f.admin('settings', { method: 'PUT', data: { cacheTtlSeconds: 315360001 } })).status,
    400,
  );
});
