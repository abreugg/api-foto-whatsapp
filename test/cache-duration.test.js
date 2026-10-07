import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { MAX_CACHE_TTL_SECONDS } from '../src/config/constants.js';
const context = createContext({});
runInContext(
  await readFile(new URL('../public/admin/cache-duration.js', import.meta.url), 'utf8'),
  context,
);
const duration = runInContext('CacheDuration', context);
test('24 hours and 24 months convert to exact API seconds; all units and zero are supported', () => {
  assert.equal(duration.toSeconds('24', 'hours'), 86400);
  assert.equal(duration.toSeconds('24', 'months'), 62208000);
  assert.equal(duration.toSeconds('1.5', 'days'), 129600);
  assert.equal(duration.toSeconds('2', 'minutes'), 120);
  assert.equal(duration.toSeconds('9', 'seconds'), 9);
  assert.equal(duration.toSeconds('0', 'months'), 0);
  assert.equal(duration.maxSeconds, MAX_CACHE_TTL_SECONDS);
});
test('existing TTL values round-trip without losing precision', () => {
  for (const seconds of [0, 1, 61, 3600, 86400, 90000, 62208000, MAX_CACHE_TTL_SECONDS]) {
    const value = duration.fromSeconds(seconds);
    assert.equal(duration.toSeconds(value.value, value.unit), seconds);
  }
});
test('empty/negative/invalid units, fractional seconds and excessive durations are rejected', () => {
  for (const [value, unit] of [
    ['', 'hours'],
    ['-1', 'days'],
    ['1', 'invalid'],
    ['0.5', 'seconds'],
    ['999', 'months'],
  ])
    assert.throws(() => duration.toSeconds(value, unit));
});
