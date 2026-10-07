import { randomUUID } from 'node:crypto';
import { safePath, withRequestContext } from '../utils/logger.js';

export function requestLogger(logger) {
  return (req, res, next) => {
    const requestId = randomUUID(),
      started = performance.now();
    res.set('X-Request-Id', requestId);
    withRequestContext({ requestId }, () => {
      logger.debug('http.request', { method: req.method, path: safePath(req.path) });
      res.once('finish', () =>
        logger.info('http.response', {
          requestId,
          method: req.method,
          path: safePath(req.path),
          status: res.statusCode,
          elapsedMs: Math.round(performance.now() - started),
        }),
      );
      next();
    });
  };
}
