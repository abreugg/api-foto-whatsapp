import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase, migrationFiles } from '../src/database/migrations.js';

function fixture({ fail, acquired = 1, applied = [] } = {}) {
  const calls = [],
    records = [...applied];
  let released = false;
  const connection = {
    async query(sql) {
      calls.push(sql);
      if (sql === 'SELECT name,checksum,applied_at FROM schema_migrations') return [records];
      if (sql === fail) throw new Error('DDL failed');
      return [{}];
    },
    async execute(sql, args) {
      calls.push(sql);
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired }]];
      if (sql.startsWith('INSERT INTO schema_migrations'))
        records.push({ name: args[0], checksum: args[1] });
      return [[]];
    },
    release() {
      released = true;
    },
  };
  return {
    pool: { getConnection: async () => connection },
    calls,
    records,
    get released() {
      return released;
    },
  };
}
const files = [
  {
    name: '001_initial.sql',
    checksum: 'one',
    statements: ['CREATE TABLE IF NOT EXISTS base (id INT)'],
  },
  {
    name: '002_upgrade.sql',
    checksum: 'two',
    statements: ['CREATE TABLE IF NOT EXISTS upgrade (id INT)'],
  },
];
const options = { files, report: () => {} };

test('migrations apply in order, record only completed files and skip already applied files', async () => {
  const f = fixture();
  await migrateDatabase(f.pool, 'test', options);
  assert.deepEqual(
    f.records.map((r) => r.name),
    files.map((f) => f.name),
  );
  const before = f.calls.filter((c) => c === files[1].statements[0]).length;
  await migrateDatabase(f.pool, 'test', options);
  assert.equal(f.calls.filter((c) => c === files[1].statements[0]).length, before);
  assert.equal(f.released, true);
});
test('failed DDL is not marked applied and releases its database lock', async () => {
  const f = fixture({ fail: files[1].statements[0] });
  await assert.rejects(migrateDatabase(f.pool, 'test', options), /DDL failed/);
  assert.deepEqual(
    f.records.map((r) => r.name),
    ['001_initial.sql'],
  );
  assert.ok(f.calls.includes('SELECT RELEASE_LOCK(?)'));
  assert.equal(f.released, true);
});
test('status lists pending migrations without running their statements', async () => {
  const f = fixture({ applied: [{ name: '001_initial.sql', checksum: 'one' }] });
  assert.deepEqual(await migrateDatabase(f.pool, 'test', { ...options, apply: false }), [
    { name: '001_initial.sql', status: 'applied' },
    { name: '002_upgrade.sql', status: 'pending' },
  ]);
  assert.ok(!f.calls.includes(files[1].statements[0]));
});
test('changed applied migration fails before pending DDL executes', async () => {
  const f = fixture({ applied: [{ name: '001_initial.sql', checksum: 'changed' }] });
  await assert.rejects(migrateDatabase(f.pool, 'test', options), /já aplicada foi alterada/);
  assert.ok(!f.calls.includes(files[1].statements[0]));
  assert.equal(f.released, true);
});
test('lock contention prevents all schema changes and returns the connection', async () => {
  const f = fixture({ acquired: 0 });
  await assert.rejects(migrateDatabase(f.pool, 'test', options), /lock/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.released, true);
});
test('VPS upgrades are separate idempotent migrations with no data deletion', async () => {
  const catalog = await migrationFiles();
  assert.deepEqual(
    catalog.map((f) => f.name),
    ['001_initial.sql', '002_missing_photos.sql', '003_deleted_connections.sql'],
  );
  assert.ok(
    !catalog[0].statements.some(
      (s) => s.includes('missing_photos') || s.includes('deleted_connections'),
    ),
  );
  assert.ok(catalog[1].statements[0].startsWith('CREATE TABLE IF NOT EXISTS missing_photos'));
  assert.ok(catalog[2].statements[0].startsWith('CREATE TABLE IF NOT EXISTS deleted_connections'));
  assert.ok(
    catalog.every((f) => f.statements.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))),
  );
});
