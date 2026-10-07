import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest, secretMatches } from '../utils/crypto.js';
import { HttpError } from '../utils/errors.js';
import {
  requiredName,
  requiredBoolean,
  normalizeOrigin,
  normalizePhone,
  cacheSeconds,
  historyFilters,
} from '../utils/validation.js';

/** Admin routes accept X-Admin-Api-Key or the dashboard's short-lived cookie. */
export function adminRoutes({ repo, config, auth, limits, connections, photos }) {
  const router = Router();
  router.use(limits.admin, limits.adminAttempts);
  router.post('/login', async (req, res) => {
    if (req.headers.origin !== config.publicUrl) throw new HttpError(403, 'Origem inválida.');
    if (!secretMatches(req.body?.apiKey, config.adminApiKey))
      throw new HttpError(401, 'API key administrativa inválida.');
    req.adminAuthenticated = true;
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    await repo.expireSessions();
    await repo.addSession({
      digest: digest(token),
      csrf,
      adminKeyDigest: digest(config.adminApiKey),
      expiresAt: Date.now() + 8 * 3600000,
    });
    res.cookie('photo_admin', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookie,
      path: '/',
      maxAge: 8 * 3600000,
    });
    res.json({ csrf });
  });
  router.use(auth.admin);
  router.get('/integration-guide', (req, res) =>
    res.download(
      fileURLToPath(new URL('../../docs/INTEGRATION_IA.md', import.meta.url)),
      'INTEGRATION_IA.md',
    ),
  );
  router.get('/me', (req, res) => res.json({ csrf: req.adminSession?.csrf || null }));
  router.post('/logout', async (req, res) => {
    if (req.adminSession) await repo.deleteSession(req.adminSession.digest);
    res.clearCookie('photo_admin', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookie,
    });
    res.json({ ok: true });
  });
  router.get('/settings', async (req, res) => res.json({ cacheTtlSeconds: await repo.ttl() }));
  router.put('/settings', async (req, res) => {
    const value = cacheSeconds(req.body?.cacheTtlSeconds);
    await repo.setTtl(value);
    res.json({ cacheTtlSeconds: value });
  });
  router.get('/stats', async (req, res) =>
    res.json(await repo.stats(historyFilters(req.query), await repo.ttl())),
  );
  router.get('/history', async (req, res) =>
    res.json(await repo.history(historyFilters(req.query))),
  );
  router.get('/keys', async (req, res) => res.json(await repo.listKeys()));
  router.post('/keys', async (req, res) => {
    const name = requiredName(req.body?.name),
      raw = 'wpf_' + randomBytes(32).toString('hex'),
      id = randomUUID();
    await repo.addKey({
      id,
      name,
      digest: digest(raw),
      prefix: raw.slice(0, 12),
      createdAt: Date.now(),
    });
    res.status(201).json({ id, key: raw });
  });
  router.patch('/keys/:id', async (req, res) => {
    const result = await repo.setKey(req.params.id, requiredBoolean(req.body?.enabled, 'enabled'));
    if (!result.affectedRows) throw new HttpError(404, 'API key não encontrada.');
    res.json({ ok: true });
  });
  router.get('/domains', async (req, res) => res.json(await repo.listDomains()));
  router.post('/domains', async (req, res) => {
    const origin = normalizeOrigin(req.body?.origin);
    if (!origin || origin.length > 255)
      throw new HttpError(
        400,
        'Informe a origem completa, por exemplo https://meusite.com (sem caminho).',
      );
    const id = randomUUID();
    try {
      await repo.addDomain({ id, origin, createdAt: Date.now() });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Domínio já cadastrado.');
      throw e;
    }
    res.status(201).json({ id, origin });
  });
  router.patch('/domains/:id', async (req, res) => {
    const result = await repo.setDomain(
      req.params.id,
      requiredBoolean(req.body?.enabled, 'enabled'),
    );
    if (!result.affectedRows) throw new HttpError(404, 'Domínio não encontrado.');
    res.json({ ok: true });
  });
  router.delete('/cache', async (req, res) =>
    res.json(await photos.invalidate(normalizePhone(req.body?.phone))),
  );
  router.get('/connections', async (req, res) => res.json(await connections.sync()));
  router.post('/connections', async (req, res) =>
    res.status(201).json(await connections.create(requiredName(req.body?.name))),
  );
  router.patch('/connections/:id', async (req, res) =>
    res.json(
      await connections.setRotation(req.params.id, requiredBoolean(req.body?.rotation, 'rotation')),
    ),
  );
  router.post('/connections/:id/connect', async (req, res) =>
    res.json(await connections.connect(req.params.id)),
  );
  router.post('/connections/:id/disconnect', async (req, res) =>
    res.json(await connections.disconnect(req.params.id)),
  );
  router.get('/connections/:id/status', async (req, res) =>
    res.json(await connections.status(req.params.id)),
  );
  router.get('/connections/:id/qr', async (req, res) =>
    res.json(await connections.qr(req.params.id)),
  );
  return router;
}
