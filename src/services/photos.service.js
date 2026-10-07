import { randomUUID } from 'node:crypto';
import { HttpError } from '../utils/errors.js';
import { createLogger, maskPhone, requestContext } from '../utils/logger.js';

/** Cache is global per normalized number. Every authorized lookup has its own history row. */
export function createPhotosService(
  repo,
  connections,
  wuzapi,
  images,
  config,
  logger = createLogger(config),
) {
  const inflight = new Map();
  // Serialize candidate selection briefly so concurrent different numbers rotate fairly.
  let selection = Promise.resolve();
  async function candidates() {
    const previous = selection;
    let release;
    selection = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const list = await repo.rotationCandidates();
      logger.debug('photos.rotation_candidates', { count: list.length });
      if (!list.length)
        throw new HttpError(503, 'Nenhuma conexão conectada e habilitada para rotação.');
      await repo.markUsed(list[0].id, Date.now());
      return list;
    } finally {
      release();
    }
  }
  async function fetchPhoto(phone) {
    await connections.sync();
    const list = await candidates();
    let lastError;
    for (const connection of list) {
      try {
        logger.debug('photos.upstream_attempt', {
          connectionId: connection.id,
          phone: maskPhone(phone),
        });
        if (connection !== list[0]) await repo.markUsed(connection.id, Date.now());
        const avatar = await wuzapi.avatar(connections.token(connection), phone);
        if (!avatar.URL) {
          const missing = { phone, notFound: true, saved_at: Date.now() };
          await repo.addMissing(missing);
          logger.info('cache.missing_saved', { phone: maskPhone(phone) });
          return missing;
        }
        const image = await images.download(avatar.URL);
        const photo = {
          id: randomUUID(),
          phone,
          source_url: avatar.URL,
          ...image,
          connectionId: connection.id,
          saved_at: Date.now(),
        };
        await repo.addPhoto(photo);
        logger.info('photos.saved', {
          photoId: photo.id,
          phone: maskPhone(phone),
          connectionId: connection.id,
          bytes: image.image.length,
        });
        return photo;
      } catch (e) {
        logger.warn('photos.upstream_failed', {
          connectionId: connection.id,
          phone: maskPhone(phone),
          error: e,
        });
        if (e.status === 404) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }
  async function lookup(phone) {
    const ttl = await repo.ttl();
    const cached = ttl > 0 && (await repo.findCached(phone, Date.now() - ttl * 1000));
    if (cached) {
      logger.debug('cache.hit', { phone: maskPhone(phone), photoId: cached.id, ttlSeconds: ttl });
      return { photo: cached, cacheHit: true, ttl };
    }
    if (inflight.has(phone)) {
      logger.debug('cache.wait_inflight', { phone: maskPhone(phone) });
      return { photo: await inflight.get(phone), cacheHit: true, ttl };
    }
    logger.debug('cache.miss', { phone: maskPhone(phone), ttlSeconds: ttl });
    // Set before yielding to prevent two external lookups of the same number.
    const task = fetchPhoto(phone);
    inflight.set(phone, task);
    try {
      return { photo: await task, cacheHit: false, ttl };
    } finally {
      inflight.delete(phone);
    }
  }
  return {
    async query(phone, identity) {
      const requestId = requestContext().requestId || randomUUID(),
        createdAt = Date.now();
      logger.info('photos.query_start', { requestId, phone: maskPhone(phone) });
      let result;
      try {
        result = await lookup(phone);
        if (result.photo.notFound) {
          const error = new HttpError(404, 'Foto indisponível para este número.');
          error.photoUnavailable = true;
          error.cacheHit = result.cacheHit;
          error.savedAt = new Date(result.photo.saved_at).toISOString();
          error.expiresAt = new Date(result.photo.saved_at + result.ttl * 1000).toISOString();
          throw error;
        }
      } catch (error) {
        await repo.addRequest({
          id: requestId,
          phone,
          ...identity,
          photoId: null,
          cacheHit: result?.cacheHit || false,
          status: error.status || 500,
          error: error instanceof HttpError ? error.message : 'Falha na consulta',
          createdAt: result?.photo.notFound
            ? Math.max(createdAt, result.photo.saved_at)
            : createdAt,
        });
        throw error;
      }
      const { photo, cacheHit, ttl } = result;
      await repo.addRequest({
        id: requestId,
        phone,
        ...identity,
        photoId: photo.id,
        cacheHit,
        status: 200,
        error: null,
        createdAt,
      });
      logger.info('photos.query_complete', {
        requestId,
        phone: maskPhone(phone),
        photoId: photo.id,
        cacheHit,
        elapsedMs: Date.now() - createdAt,
      });
      return {
        id: photo.id,
        requestId,
        phone,
        url: `${config.publicUrl}/api/photos/${photo.id}/image`,
        sourceUrl: photo.source_url,
        savedAt: new Date(photo.saved_at).toISOString(),
        expiresAt: new Date(photo.saved_at + ttl * 1000).toISOString(),
        cacheHit,
      };
    },
    async invalidate(phone) {
      if (inflight.has(phone))
        throw new HttpError(409, 'Consulta em andamento. Aguarde para invalidar o cache.');
      const result = await repo.invalidate(phone);
      logger.info('cache.invalidated', { phone: maskPhone(phone), count: result.affectedRows });
      return { invalidated: result.affectedRows, historyPreserved: true };
    },
    async image(id) {
      const photo = await repo.findImage(id);
      if (!photo) throw new HttpError(404, 'Foto não encontrada.');
      return photo;
    },
  };
}
