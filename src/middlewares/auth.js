import { digest, secretMatches } from '../utils/crypto.js';
import { normalizeOrigin } from '../utils/validation.js';
import { HttpError } from '../utils/errors.js';

export function createAuth(repo, config) {
  const adminDigest = digest(config.adminApiKey);
  async function session(req) {
    const token = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('photo_admin='))
      ?.slice(12);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const current = await repo.findSession(digest(token));
    return current && current.admin_key_digest === adminDigest ? current : null;
  }
  function allowOrigin(res, origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
  }
  return {
    session,
    async admin(req, res, next) {
      const raw = req.get('X-Admin-Api-Key');
      if (raw) {
        if (!secretMatches(raw, config.adminApiKey))
          throw new HttpError(401, 'API key administrativa inválida.');
        // Header keys are for server integrations, not cross-origin browser access.
        if (req.headers.origin && req.headers.origin !== config.publicUrl)
          throw new HttpError(403, 'Origem administrativa inválida.');
        req.adminAuthenticated = true;
        return next();
      }
      const current = await session(req);
      if (!current) throw new HttpError(401, 'Entre no painel com a API key administrativa.');
      req.adminAuthenticated = true;
      req.adminSession = current;
      if (
        !['GET', 'HEAD'].includes(req.method) &&
        (!secretMatches(req.get('X-CSRF-Token') || '', current.csrf) ||
          req.headers.origin !== config.publicUrl)
      )
        throw new HttpError(403, 'Validação CSRF falhou.');
      next();
    },
    async public(req, res, next) {
      // The panel can display archived images with its HttpOnly session cookie.
      if (req.path.endsWith('/image')) {
        const current = await session(req);
        if (current) {
          req.identity = {
            apiKeyId: null,
            domainId: null,
            origin: null,
            adminSession: current.digest,
          };
          return next();
        }
      }
      const origin = normalizeOrigin(req.headers.origin);
      const domain = origin && (await repo.findDomain(origin));
      // Query credentials are supported only by the GET photo lookup endpoint.
      const queryKey =
        req.method === 'GET' &&
        req.baseUrl === '/api/photos' &&
        /^\/[^/]+$/.test(req.path) &&
        typeof req.query.apikey === 'string'
          ? req.query.apikey
          : null;
      const raw =
        req.get('X-Api-Key') ||
        (req.get('Authorization')?.startsWith('Bearer ')
          ? req.get('Authorization').slice(7)
          : null) ||
        queryKey;
      const apiKey = raw && (await repo.findKey(digest(raw)));
      if (!domain && !apiKey)
        throw new HttpError(401, 'Use um domínio aprovado no Origin ou uma API key válida.');
      if (domain) allowOrigin(res, origin);
      req.identity = {
        apiKeyId: apiKey?.id || null,
        domainId: domain?.id || null,
        origin: origin || null,
      };
      next();
    },
    async preflight(req, res) {
      const origin = normalizeOrigin(req.headers.origin);
      if (!origin || !(await repo.findDomain(origin)))
        throw new HttpError(403, 'Domínio não aprovado.');
      allowOrigin(res, origin);
      res
        .set({
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
        })
        .sendStatus(204);
    },
  };
}
