import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageService } from '../src/services/image.service.js';
import { tokenCipher, secretMatches } from '../src/utils/crypto.js';

test('image downloader rejects arbitrary hosts, HTTP, credentials and oversized responses', async () => {
  let calls = 0;
  const images = createImageService(
    { photoHosts: ['pps.whatsapp.net'], upstreamTimeout: 1000 },
    async () => {
      calls++;
      return new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    },
  );
  for (const source of [
    'http://pps.whatsapp.net/a',
    'https://evil.test/a',
    'https://user:pass@pps.whatsapp.net/a',
    'https://pps.whatsapp.net:8443/a',
  ])
    await assert.rejects(images.download(source), { status: 502 });
  assert.equal(calls, 0);
  await assert.rejects(images.download('https://pps.whatsapp.net/a'), /5 MB/);
});
test('HTML and SVG are not accepted as archived profile images', async () => {
  for (const mime of ['text/html', 'image/svg+xml']) {
    const images = createImageService(
      { photoHosts: ['pps.whatsapp.net'], upstreamTimeout: 1000 },
      async () => new Response('not an image', { headers: { 'Content-Type': mime } }),
    );
    await assert.rejects(images.download('https://pps.whatsapp.net/a'), { status: 502 });
  }
});
test('tokens are encrypted with randomized authenticated encryption', () => {
  const cipher = tokenCipher('secret-for-tests'),
    token = 'account-token';
  const a = cipher.encrypt(token),
    b = cipher.encrypt(token);
  assert.notEqual(a, b);
  assert.equal(cipher.decrypt(a), token);
  assert.ok(!a.includes(token));
  const bytes = Buffer.from(a, 'base64');
  bytes[15] ^= 1;
  assert.throws(() => cipher.decrypt(bytes.toString('base64')));
  assert.equal(secretMatches('key', 'key'), true);
  assert.equal(secretMatches('key', 'bad'), false);
});
