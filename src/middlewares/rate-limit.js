import { rateLimit } from 'express-rate-limit';
import { createLogger, safePath } from '../utils/logger.js';
/** In-memory limits belong to one API process. See README before adding replicas. */
export function createLimiters(config, logger = createLogger(config)) {
  const base = {
    windowMs: 60000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Limite de requisições por minuto excedido. Aguarde e tente novamente.' },
    handler: (req, res, next, options) => {
      logger.warn('rate_limit.blocked', {
        method: req.method,
        path: safePath(req.path),
        status: 429,
      });
      res.status(options.statusCode).json(options.message);
    },
  };
  return {
    admin: rateLimit({ ...base, limit: config.adminRate }),
    adminAttempts: rateLimit({
      ...base,
      limit: config.adminAttempts,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (req) => req.adminAuthenticated === true,
    }),
    publicAttempts: rateLimit({
      ...base,
      limit: config.publicAttempts,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (req) => Boolean(req.identity),
    }),
    public: rateLimit({
      ...base,
      limit: config.publicRate,
      keyGenerator: (req) =>
        req.identity.apiKeyId || req.identity.domainId || req.identity.adminSession,
    }),
  };
}
