import { randomBytes } from 'node:crypto';
import { tokenCipher } from '../utils/crypto.js';
import { HttpError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { connectionStatus } from '../utils/connection-status.js';

export function createConnectionsService(repo, wuzapi, config, logger = createLogger(config)) {
  const cipher = tokenCipher(config.secret);
  let syncing;
  async function sync() {
    if (syncing) return syncing;
    logger.debug('connections.sync_start');
    syncing = (async () => {
      const users = await wuzapi.listUsers();
      if (!Array.isArray(users))
        throw new HttpError(502, 'Lista de conexões inválida na API WhatsApp.');
      const normalized = users
        .filter((u) => u.id && u.token)
        .map((u) => ({
          id: String(u.id),
          name: String(u.name || u.id),
          token: cipher.encrypt(String(u.token)),
          jid: u.jid || null,
          connected: Number(connectionStatus(u).Connected),
          loggedIn: Number(connectionStatus(u).LoggedIn),
          syncedAt: Date.now(),
        }));
      await repo.saveConnections(normalized);
      logger.info('connections.synced', {
        total: normalized.length,
        connected: normalized.filter((u) => u.connected && u.loggedIn).length,
      });
      return repo.listConnections();
    })();
    try {
      return await syncing;
    } finally {
      syncing = null;
    }
  }
  async function find(id) {
    const c = await repo.findConnection(id);
    if (!c) throw new HttpError(404, 'Conexão não encontrada.');
    return c;
  }
  async function readStatus(c) {
    const result = await wuzapi.status(cipher.decrypt(c.token));
    // Return only the documented flags. Some deployed APIs include tokens in status data.
    const status = connectionStatus(result);
    await repo.setStatus(c.id, status.Connected, status.LoggedIn);
    logger.debug('connections.status', {
      connectionId: c.id,
      connected: status.Connected,
      loggedIn: status.LoggedIn,
    });
    return status;
  }
  const completedQR = (status) => ({ QRCode: '', passkeyPending: false, ...status });
  return {
    sync,
    async create(name) {
      const user = await wuzapi.createUser(name, randomBytes(32).toString('hex'));
      await sync();
      return { id: user.id, name: user.name || name };
    },
    async setRotation(id, enabled) {
      await find(id);
      await repo.setRotation(id, enabled);
      logger.info('connections.rotation_changed', { connectionId: id, enabled: Boolean(enabled) });
      return { rotation: Boolean(enabled) };
    },
    async connect(id) {
      const c = await find(id);
      logger.info('connections.connect', { connectionId: id });
      return wuzapi.connect(cipher.decrypt(c.token));
    },
    async disconnect(id) {
      const c = await find(id);
      const result = await wuzapi.disconnect(cipher.decrypt(c.token));
      await repo.setStatus(id, false, false);
      logger.info('connections.disconnected', { connectionId: id });
      return result;
    },
    async remove(id) {
      // Finish any earlier synchronization before erasing the remote account.
      if (syncing) await syncing;
      const c = await find(id);
      if (c.connected) {
        await wuzapi.disconnect(cipher.decrypt(c.token));
        await repo.setStatus(id, false, false);
      }
      // Do not hide the account locally if the remote deletion failed.
      await wuzapi.deleteUser(id);
      await repo.deleteConnection(id);
      logger.info('connections.deleted', { connectionId: id });
      return { deleted: true, historyPreserved: true };
    },
    async status(id) {
      const c = await find(id);
      return readStatus(c);
    },
    async qr(id) {
      const c = await find(id);
      const status = await readStatus(c);
      if (status.Connected && status.LoggedIn) {
        logger.info('connections.pairing_complete', { connectionId: id });
        return completedQR(status);
      }
      let data;
      try {
        data = await wuzapi.qr(cipher.decrypt(c.token));
      } catch (error) {
        // Pairing can finish between the status check and the QR request.
        const updated = await readStatus(c).catch(() => null);
        if (updated?.Connected && updated.LoggedIn) {
          logger.info('connections.pairing_complete', { connectionId: id });
          return completedQR(updated);
        }
        throw error;
      }
      logger.debug('connections.qr_status', {
        connectionId: id,
        available: Boolean(data.QRCode),
        passkeyPending: data.passkeyPending === true,
      });
      return { QRCode: data.QRCode || '', passkeyPending: data.passkeyPending === true, ...status };
    },
    token: (c) => cipher.decrypt(c.token),
  };
}
