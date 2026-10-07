import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionsService } from '../src/services/connections.service.js';
import { memoryRepository } from './helpers/memory-repository.js';
import { HttpError } from '../src/utils/errors.js';

async function fixture(wuzapi) {
  const repo = memoryRepository();
  const remote = {
    listUsers: async () => [
      { id: 'session', name: 'WhatsApp', token: 'private-token', connected: true, loggedIn: false },
    ],
    ...wuzapi,
  };
  const service = createConnectionsService(repo, remote, { secret: 'test-only-secret' });
  await service.sync();
  return { service, repo };
}

test('camelCase and PascalCase status flags are normalized without returning upstream secrets', async () => {
  for (const flags of [
    { connected: true, loggedIn: true },
    { Connected: true, LoggedIn: true },
  ]) {
    const { service, repo } = await fixture({
      status: async () => ({ ...flags, token: 'private-token', publicKey: { secret: 'private' } }),
    });
    assert.deepEqual(await service.status('session'), { Connected: true, LoggedIn: true });
    assert.equal(repo.state.connections[0].logged_in, 1);
    assert.equal(repo.state.connections[0].connected, 1);
  }
});

test('QR endpoint reports connected session without asking WUZAPI for an expired QR', async () => {
  let qrCalls = 0;
  const { service } = await fixture({
    status: async () => ({ connected: true, loggedIn: true }),
    qr: async () => {
      qrCalls++;
      throw new HttpError(502, 'already logged in');
    },
  });
  assert.deepEqual(await service.qr('session'), {
    QRCode: '',
    passkeyPending: false,
    Connected: true,
    LoggedIn: true,
  });
  assert.equal(qrCalls, 0);
});

test('pairing completed between status and QR request becomes success rather than an error', async () => {
  let statuses = 0;
  const { service } = await fixture({
    status: async () => ({ connected: true, loggedIn: ++statuses > 1 }),
    qr: async () => {
      throw new HttpError(502, 'already logged in');
    },
  });
  const result = await service.qr('session');
  assert.equal(result.Connected, true);
  assert.equal(result.LoggedIn, true);
  assert.equal(result.QRCode, '');
  assert.equal(statuses, 2);
});

test('genuine QR failures remain errors when the session has not logged in', async () => {
  const { service } = await fixture({
    status: async () => ({ connected: true, loggedIn: false }),
    qr: async () => {
      throw new HttpError(502, 'remote failure');
    },
  });
  await assert.rejects(service.qr('session'), /remote failure/);
});

test('waiting session still receives its QR and safe status flags', async () => {
  const { service } = await fixture({
    status: async () => ({ connected: true, loggedIn: false }),
    qr: async () => ({
      QRCode: 'data:image/png;base64,aGVsbG8=',
      passkeyPending: false,
      token: 'private',
    }),
  });
  assert.deepEqual(await service.qr('session'), {
    QRCode: 'data:image/png;base64,aGVsbG8=',
    passkeyPending: false,
    Connected: true,
    LoggedIn: false,
  });
});
