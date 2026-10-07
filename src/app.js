import express from 'express';
import { fileURLToPath } from 'node:url';
import { createRepository } from './repositories/repository.js';
import { createWuzapiService } from './services/wuzapi.service.js';
import { createConnectionsService } from './services/connections.service.js';
import { createImageService } from './services/image.service.js';
import { createPhotosService } from './services/photos.service.js';
import { createAuth } from './middlewares/auth.js';
import { createLimiters } from './middlewares/rate-limit.js';
import { securityHeaders } from './middlewares/security.js';
import { adminRoutes } from './routes/admin.routes.js';
import { photoRoutes, legacyRoutes } from './routes/photos.routes.js';
import { HttpError, errorHandler } from './utils/errors.js';
import { createLogger } from './utils/logger.js';
import { requestLogger } from './middlewares/request-logger.js';

/** Composition root. Dependency injection allows tests without real WhatsApp sessions. */
export function createApp({
  config,
  pool,
  repository,
  fetcher,
  wuzapi: injectedWuzapi,
  images: injectedImages,
  logger: injectedLogger,
}) {
  const logger = injectedLogger || createLogger(config);
  const repo = repository || createRepository(pool);
  const wuzapi = injectedWuzapi || createWuzapiService(config, fetcher, logger);
  const images = injectedImages || createImageService(config, fetcher, logger);
  const connections = createConnectionsService(repo, wuzapi, config, logger);
  const photos = createPhotosService(repo, connections, wuzapi, images, config, logger);
  const auth = createAuth(repo, config),
    limits = createLimiters(config, logger);
  const context = { config, repo, wuzapi, connections, photos, auth, limits };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops || false);
  app.use(requestLogger(logger), securityHeaders, express.json({ limit: '64kb' }));
  app.get('/health', async (req, res) => {
    try {
      await repo.health();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use(
    '/admin',
    express.static(fileURLToPath(new URL('../public/admin/', import.meta.url)), {
      etag: false,
      maxAge: 0,
      redirect: true,
    }),
  );
  app.use('/api/admin', adminRoutes(context));
  app.use('/api/photos', photoRoutes(context));
  app.use('/v1/profile', legacyRoutes(context));
  app.use((req, res, next) => next(new HttpError(404, 'Rota não encontrada.')));
  app.use((error, req, res, next) => {
    logger.warn('http.error', {
      error,
      status: error.status || 500,
      message: error instanceof HttpError ? error.message : undefined,
    });
    errorHandler(error, req, res, next);
  });
  return app;
}
