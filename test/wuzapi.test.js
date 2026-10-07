import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWuzapiService } from '../src/services/wuzapi.service.js';

const config = {
  upstreamUrl: 'https://wuzapi.test',
  upstreamAdminToken: 'secret-admin',
  upstreamTimeout: 1000,
};

test('avatar accepts lowercase live fields and uppercase documented fields without exposing other data', async () => {
  for (const [field, wrapped] of [
    ['url', true],
    ['URL', true],
    ['URL', false],
  ]) {
    const photoUrl = 'https://pps.whatsapp.net/test.jpg';
    const service = createWuzapiService(config, async (url, options) => {
      assert.equal(url, 'https://wuzapi.test/user/avatar');
      assert.deepEqual(JSON.parse(options.body), { Phone: '5511999999999', Preview: false });
      assert.equal(options.headers.token, 'account-token');
      const data = { [field]: photoUrl, token: 'should-not-leak' };
      return Response.json(wrapped ? { success: true, data } : data);
    });
    assert.deepEqual(await service.avatar('account-token', '5511999999999'), { URL: photoUrl });
  }
  const service = createWuzapiService(config, async () =>
    Response.json({ success: true, data: {} }),
  );
  assert.deepEqual(await service.avatar('account-token', '5511999999999'), { URL: '' });
});

test('WUZAPI connection errors distinguish timeout, connection refusal and DNS', async () => {
  const cases = [
    [Object.assign(new Error(), { name: 'TimeoutError' }), 504, /prazo/],
    [Object.assign(new Error(), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), 504, /prazo/],
    [Object.assign(new Error(), { cause: { code: 'ECONNREFUSED' } }), 502, /recusou a conexão/],
    [Object.assign(new Error(), { cause: { code: 'ENOTFOUND' } }), 502, /DNS/],
  ];
  for (const [error, status, message] of cases) {
    const service = createWuzapiService(config, async () => {
      throw error;
    });
    await assert.rejects(
      service.listUsers(),
      (e) => e.status === status && message.test(e.message),
    );
  }
});

test('avatar 404 becomes a missing result while server failures remain errors', async () => {
  const missing = createWuzapiService(config, async () =>
    Response.json({ success: false, error: 'not found' }, { status: 404 }),
  );
  assert.deepEqual(await missing.avatar('token', '5511999999999'), { URL: '' });
  const failure = createWuzapiService(config, async () =>
    Response.json({ success: false }, { status: 500 }),
  );
  await assert.rejects(failure.avatar('token', '5511999999999'), (e) => e.status === 502);
});

test('WUZAPI rejects redirects without forwarding its token', async () => {
  let calls = 0;
  const service = createWuzapiService(config, async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://other.test/' } });
  });
  await assert.rejects(service.listUsers(), /URL final/);
  assert.equal(calls, 1);
});

test('HTTP authentication failure is reported even when the upstream sends HTML', async () => {
  for (const status of [401, 403]) {
    const service = createWuzapiService(
      config,
      async () => new Response('<html>Denied</html>', { status }),
    );
    await assert.rejects(service.listUsers(), /WUZAPI_ADMIN_TOKEN/);
    await assert.rejects(service.status('account-token'), /token da conexão/);
  }
});

test('HTML and malformed JSON responses report the upstream HTTP status without leaking content', async () => {
  const service = createWuzapiService(
    config,
    async () => new Response('secret-admin: proxy HTML', { status: 404 }),
  );
  await assert.rejects(
    service.listUsers(),
    (e) => e.status === 502 && /HTTP 404/.test(e.message) && !e.message.includes('secret-admin'),
  );
});

test('valid WUZAPI JSON is returned and the admin header follows the YAML', async () => {
  const service = createWuzapiService(config, async (url, options) => {
    assert.equal(url, 'https://wuzapi.test/admin/users');
    assert.equal(options.headers.Authorization, 'secret-admin');
    return Response.json({ success: true, data: [] });
  });
  assert.deepEqual(await service.listUsers(), []);
});

test('remote connection deletion uses the admin token and accepts an already absent user', async () => {
  for (const status of [200, 404]) {
    const service = createWuzapiService(config, async (url, options) => {
      assert.equal(url, 'https://wuzapi.test/admin/users/session');
      assert.equal(options.method, 'DELETE');
      assert.equal(options.headers.Authorization, 'secret-admin');
      assert.equal(options.headers.token, undefined);
      return Response.json({ success: status === 200, data: { id: 'session' } }, { status });
    });
    assert.ok(await service.deleteUser('session'));
  }
});
