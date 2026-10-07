import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('documentation contains only POST and GET photo lookups with their credential formats', async () => {
  const catalog = JSON.parse(
    await readFile(new URL('../public/admin/api-reference.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    catalog.routes.map((r) => r.method + ' ' + r.path),
    ['POST /api/photos', 'GET /api/photos/:phone'],
  );
  assert.equal(catalog.routes[0].headers['X-Api-Key'], 'SUA_API_KEY');
  assert.equal(catalog.routes[1].query.apikey, 'SUA_API_KEY');
  const guide = await readFile(new URL('../docs/INTEGRATION_IA.md', import.meta.url), 'utf8');
  assert.ok(guide.includes('?apikey=123'));
  assert.ok(!guide.includes('/api/admin/'));
});
