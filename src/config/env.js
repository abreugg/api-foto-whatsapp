import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { normalizeOrigin } from '../utils/validation.js';
import { MAX_CACHE_TTL_SECONDS } from './constants.js';

/** Local runs read .env. Containers receive the same values from Compose. */
export function loadConfig(overrides = {}) {
  if (existsSync('.env')) loadEnvFile('.env');
  const env = { ...process.env, ...overrides };
  const integer = (name, fallback, min = 1, max = 1000000) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} inválido.`);
    return value;
  };
  for (const name of ['ADMIN_API_KEY', 'APP_SECRET'])
    if (!env[name] || env[name].length < 32)
      throw new Error(`Configure ${name} com pelo menos 32 caracteres aleatórios.`);
  const publicUrl = normalizeOrigin(env.PUBLIC_URL || 'http://localhost:3000');
  if (!publicUrl) throw new Error('PUBLIC_URL deve ser uma origem HTTP/HTTPS sem caminho.');
  let upstreamUrl;
  try {
    upstreamUrl = new URL(env.WUZAPI_URL);
  } catch {
    throw new Error('Configure WUZAPI_URL com uma URL válida.');
  }
  if (
    !['http:', 'https:'].includes(upstreamUrl.protocol) ||
    upstreamUrl.username ||
    upstreamUrl.password ||
    upstreamUrl.search ||
    upstreamUrl.hash
  )
    throw new Error('WUZAPI_URL inválida.');
  if (!env.WUZAPI_ADMIN_TOKEN) throw new Error('Configure WUZAPI_ADMIN_TOKEN.');
  if (!env.MYSQL_PASSWORD) throw new Error('Configure MYSQL_PASSWORD.');
  return {
    environment: env.NODE_ENV || 'production',
    host: env.HOST || '127.0.0.1',
    port: integer('PORT', 3000, 1, 65535),
    publicUrl,
    adminApiKey: env.ADMIN_API_KEY,
    secret: env.APP_SECRET,
    secureCookie: env.COOKIE_SECURE === 'true',
    trustProxyHops: integer('TRUST_PROXY_HOPS', 0, 0, 10),
    adminAttempts: integer('ADMIN_LOGIN_ATTEMPTS_PER_MINUTE', 10),
    adminRate: integer('ADMIN_RATE_LIMIT_PER_MINUTE', 120),
    publicAttempts: integer('PUBLIC_AUTH_ATTEMPTS_PER_MINUTE', 30),
    publicRate: integer('RATE_LIMIT_PER_MINUTE', 60),
    upstreamUrl: upstreamUrl.href.replace(/\/$/, ''),
    upstreamAdminToken: env.WUZAPI_ADMIN_TOKEN,
    upstreamTimeout: integer('WUZAPI_TIMEOUT_MS', 15000, 1000, 120000),
    photoHosts: (env.PHOTO_ALLOWED_HOSTS || 'pps.whatsapp.net,mmg.whatsapp.net')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
    cacheTtl: integer('DEFAULT_CACHE_TTL_SECONDS', 86400, 0, MAX_CACHE_TTL_SECONDS),
    mysql: {
      host: env.MYSQL_HOST || '127.0.0.1',
      port: integer('MYSQL_PORT', 3306, 1, 65535),
      database: env.MYSQL_DATABASE || 'whatsapp_photos',
      user: env.MYSQL_USER || 'photoapi',
      password: env.MYSQL_PASSWORD,
      connectionLimit: integer('MYSQL_POOL_SIZE', 10, 1, 100),
      waitForConnections: true,
      queueLimit: 100,
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: false,
      multipleStatements: false,
    },
  };
}
