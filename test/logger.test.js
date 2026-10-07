import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, safeUrl, maskPhone, withRequestContext } from '../src/utils/logger.js';
import { createWuzapiService } from '../src/services/wuzapi.service.js';

test('development logs redact nested credentials and signed URL query strings', () => {
  const lines = [],
    logger = createLogger({ environment: 'development' }, (line) => lines.push(JSON.parse(line)));
  logger.debug('test', {
    token: 'private-token',
    nested: {
      Authorization: 'private-header',
      apiKey: 'private-key',
      cookie: 'private-cookie',
      QRCode: 'private-qr',
    },
    url: 'https://user:password@host.test/image?secret=signed-value',
  });
  const raw = JSON.stringify(lines);
  for (const value of [
    'private-token',
    'private-header',
    'private-key',
    'private-cookie',
    'private-qr',
    'password',
    'signed-value',
  ])
    assert.ok(!raw.includes(value));
  assert.equal(lines[0].nested.QRCode, '[REDACTED]');
  assert.equal(lines[0].url, 'https://host.test/image');
});

test('production suppresses detailed logs and retains minimal error metadata', () => {
  const lines = [],
    logger = createLogger({ environment: 'production' }, (line) => lines.push(JSON.parse(line)));
  logger.debug('debug', { secret: 'hidden' });
  logger.info('info');
  logger.warn('warn');
  assert.equal(lines.length, 0);
  logger.error('database.failed', {
    error: Object.assign(new Error('private message'), { code: 'ECONNREFUSED' }),
    status: 500,
    body: 'private payload',
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].code, 'ECONNREFUSED');
  assert.ok(!JSON.stringify(lines).includes('private'));
});

test('asynchronous request contexts keep independent correlation IDs', async () => {
  const lines = [],
    logger = createLogger({ environment: 'development' }, (line) => lines.push(JSON.parse(line)));
  await Promise.all(
    ['request-a', 'request-b'].map((requestId) =>
      withRequestContext({ requestId }, async () => {
        await Promise.resolve();
        logger.debug('event', { expected: requestId });
      }),
    ),
  );
  assert.ok(lines.every((line) => line.requestId === line.expected));
});

test('diagnostic paths mask phone numbers and remove signed queries', () => {
  assert.equal(maskPhone('5511999999999'), '*********9999');
  assert.equal(
    safeUrl('https://host.test/api/photos/5511999999999?token=secret'),
    'https://host.test/api/photos/*********9999',
  );
});

test('WUZAPI diagnostics include timing and network code without token or body', async () => {
  const lines = [],
    config = {
      environment: 'development',
      upstreamUrl: 'http://wuzapi.test',
      upstreamAdminToken: 'private-admin-token',
      upstreamTimeout: 1000,
    };
  const logger = createLogger(config, (line) => lines.push(JSON.parse(line)));
  const service = createWuzapiService(
    config,
    async () => {
      throw Object.assign(new Error('private-admin-token'), { cause: { code: 'ECONNREFUSED' } });
    },
    logger,
  );
  await assert.rejects(service.listUsers(), { status: 502 });
  assert.equal(lines[0].event, 'wuzapi.request');
  assert.equal(lines[1].event, 'wuzapi.network_error');
  assert.equal(lines[1].error.code, 'ECONNREFUSED');
  assert.equal(typeof lines[1].elapsedMs, 'number');
  assert.ok(!JSON.stringify(lines).includes('private-admin-token'));
});
