import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
export const digest = (value) => createHash('sha256').update(value).digest('hex');
/** Compare digests of identical length to avoid leaking key length through timing. */
export const secretMatches = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export function tokenCipher(secret) {
  const key = createHash('sha256').update(secret).digest();
  return {
    encrypt(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, data, cipher.getAuthTag()]).toString('base64');
    },
    decrypt(value) {
      const data = Buffer.from(value, 'base64'),
        cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString();
    },
  };
}
