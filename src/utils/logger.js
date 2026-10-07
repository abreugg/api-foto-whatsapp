import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const sensitive = /token|secret|password|api.?key|authorization|cookie|qrcode|digest|csrf/i;
export const requestContext = () => context.getStore() || {};
export const withRequestContext = (data, callback) => context.run(data, callback);
export const maskPhone = (phone) => String(phone).replace(/.(?=.{4})/g, '*');

/** No query strings, credentials or complete phone numbers in diagnostic URLs. */
export function safePath(value) {
  return String(value)
    .split('?')[0]
    .replace(/\d{8,15}/g, maskPhone);
}
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.origin + safePath(url.pathname);
  } catch {
    return '[invalid-url]';
  }
}
function redact(value) {
  if (value instanceof Error)
    return { type: value.name, code: value.cause?.code || value.code, status: value.status };
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitive.test(key) ? '[REDACTED]' : redact(item),
      ]),
    );
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return safeUrl(value);
  return value;
}

/** Verbose diagnostics exist only in development. Production keeps minimal error events. */
export function createLogger(config = {}, write = (line) => console.log(line)) {
  const development = config.environment === 'development';
  const emit = (level, event, fields = {}) => {
    if (!development && level !== 'error') return;
    const data = development
      ? redact(fields)
      : {
          code: fields.error?.code || fields.error?.cause?.code || fields.code,
          status: fields.status,
        };
    write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...requestContext(),
        ...data,
      }),
    );
  };
  return {
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
  };
}
