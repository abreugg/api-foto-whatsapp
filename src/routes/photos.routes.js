import { Router } from 'express';
import { normalizePhone } from '../utils/validation.js';

export function photoRoutes({ auth, limits, photos }) {
  const router = Router();
  router.options('/', limits.publicAttempts, auth.preflight);
  router.options('/:phone', limits.publicAttempts, auth.preflight);
  router.options('/:id/image', limits.publicAttempts, auth.preflight);
  router.use(limits.publicAttempts, auth.public, limits.public);
  router.get('/:id/image', async (req, res) => {
    const photo = await photos.image(req.params.id);
    res.type(photo.mime).send(photo.image);
  });
  router.post('/', async (req, res) =>
    res.json(await photos.query(normalizePhone(req.body?.phone), req.identity)),
  );
  router.get('/:phone', async (req, res) =>
    res.json(await photos.query(normalizePhone(req.params.phone), req.identity)),
  );
  return router;
}

/** Preserve the old lookup URL and its `link` property, with the new authorization. */
export function legacyRoutes({ auth, limits, photos }) {
  const router = Router();
  router.options('/:phone', limits.publicAttempts, auth.preflight);
  router.use(limits.publicAttempts, auth.public, limits.public);
  router.get('/:phone', async (req, res) => {
    const result = await photos.query(normalizePhone(req.params.phone), req.identity);
    res.json({ ...result, link: result.url });
  });
  return router;
}
