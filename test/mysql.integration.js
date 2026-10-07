import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { connectDatabase } from '../src/database/pool.js';
import { createRepository } from '../src/repositories/repository.js';

/** Run explicitly with npm run test:mysql against a disposable/test MySQL database. */
test('MySQL persists the photo BLOB, filters history and invalidates without deleting', async (t) => {
  const pool = await connectDatabase(loadConfig());
  const repo = createRepository(pool),
    id = randomUUID(),
    connectionId = 'test-' + id,
    keyId = randomUUID();
  const phone = '5511999999999',
    bytes = Buffer.from([137, 80, 78, 71]);
  // Test-specific rows only; no TRUNCATE and no changes to existing records.
  t.after(async () => {
    try {
      await pool.execute('DELETE FROM requests WHERE api_key_id=?', [keyId]);
      await pool.execute('DELETE FROM photos WHERE id=?', [id]);
      await pool.execute('DELETE FROM api_keys WHERE id=?', [keyId]);
      await pool.execute('DELETE FROM connections WHERE id=?', [connectionId]);
    } finally {
      await pool.end();
    }
  });
  await pool.execute('INSERT INTO connections(id,name,token,synced_at) VALUES (?,?,?,?)', [
    connectionId,
    'Integration test',
    'test-only',
    Date.now(),
  ]);
  await repo.addKey({
    id: keyId,
    name: 'Integration test',
    digest: randomUUID().replaceAll('-', '').repeat(2),
    prefix: 'test',
    createdAt: Date.now(),
  });
  await repo.addPhoto({
    id,
    phone,
    source_url: 'https://pps.whatsapp.net/test',
    image: bytes,
    mime: 'image/png',
    connectionId,
    saved_at: Date.now(),
  });
  await repo.addRequest({
    id: randomUUID(),
    phone,
    apiKeyId: keyId,
    domainId: null,
    origin: null,
    photoId: id,
    cacheHit: false,
    status: 200,
    error: null,
    createdAt: Date.now(),
  });
  await repo.addRequest({
    id: randomUUID(),
    phone,
    apiKeyId: keyId,
    domainId: null,
    origin: null,
    photoId: id,
    cacheHit: true,
    status: 200,
    error: null,
    createdAt: Date.now(),
  });
  assert.deepEqual((await repo.findImage(id)).image, bytes);
  const stats = await repo.stats({ apiKeyId: keyId }, 3600);
  assert.equal(stats.totalRequests, 2);
  assert.equal(stats.cacheHits, 1);
  assert.equal(stats.savedPhotos, 1);
  // Invalidate just our row, avoiding unrelated photos sharing the test number.
  await pool.execute('UPDATE photos SET invalidated=1 WHERE id=?', [id]);
  assert.equal((await repo.stats({ apiKeyId: keyId }, 3600)).validCache, 0);
  assert.deepEqual((await repo.findImage(id)).image, bytes);
  assert.equal((await repo.history({ apiKeyId: keyId, page: 1 })).total, 2);
});

test('MySQL persists missing-photo cache across repositories, counts and invalidates it', async (t) => {
  const pool = await connectDatabase(loadConfig());
  const repo = createRepository(pool),
    keyId = randomUUID();
  const phone = '9' + randomUUID().replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
  const savedAt = Date.now();
  t.after(async () => {
    try {
      await pool.execute('DELETE FROM requests WHERE api_key_id=?', [keyId]);
      await pool.execute('DELETE FROM missing_photos WHERE phone=?', [phone]);
      await pool.execute('DELETE FROM api_keys WHERE id=?', [keyId]);
    } finally {
      await pool.end();
    }
  });
  await repo.addKey({
    id: keyId,
    name: 'Negative cache test',
    digest: randomUUID().replaceAll('-', '').repeat(2),
    prefix: 'test',
    createdAt: savedAt,
  });
  await repo.addMissing({ phone, saved_at: savedAt });
  await repo.addRequest({
    id: randomUUID(),
    phone,
    apiKeyId: keyId,
    domainId: null,
    origin: null,
    photoId: null,
    cacheHit: true,
    status: 404,
    error: 'Foto indisponível para este número.',
    createdAt: savedAt,
  });
  assert.equal((await createRepository(pool).findCached(phone, savedAt - 1)).notFound, true);
  const stats = await repo.stats({ apiKeyId: keyId }, 3600);
  assert.equal(stats.savedPhotos, 0);
  assert.equal(stats.validCache, 1);
  assert.equal(stats.cacheHits, 1);
  assert.equal((await repo.history({ apiKeyId: keyId, page: 1 })).items[0].negative_cache, 1);
  await repo.invalidate(phone);
  assert.equal(await repo.findCached(phone, savedAt - 1), null);
  assert.equal((await repo.stats({ apiKeyId: keyId }, 3600)).validCache, 0);
  assert.equal((await repo.history({ apiKeyId: keyId, page: 1 })).total, 1);
});
