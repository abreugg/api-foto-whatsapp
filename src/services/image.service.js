import { HttpError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

/** Archive only allowed HTTPS image hosts. No redirects or arbitrary user URLs. */
export function createImageService(config, fetcher = fetch, logger = createLogger(config)) {
  return {
    async download(source) {
      let url;
      try {
        url = new URL(source);
      } catch {
        throw new HttpError(502, 'URL de foto inválida.');
      }
      if (
        url.protocol !== 'https:' ||
        !config.photoHosts.includes(url.hostname) ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443')
      )
        throw new HttpError(502, 'Host da foto não autorizado em PHOTO_ALLOWED_HOSTS.');
      try {
        const started = performance.now();
        logger.debug('image.download_start', { host: url.hostname });
        const response = await fetcher(url.href, {
          signal: AbortSignal.timeout(config.upstreamTimeout),
          redirect: 'error',
        });
        const mime = (response.headers.get('content-type') || '').split(';')[0];
        if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime))
          throw new HttpError(502, 'Não foi possível arquivar a imagem.');
        const chunks = [];
        let size = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 5 * 1024 * 1024) {
              await reader.cancel();
              throw new HttpError(502, 'Foto maior que 5 MB.');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        if (!size) throw new HttpError(502, 'A foto retornada está vazia.');
        logger.info('image.download_complete', {
          host: url.hostname,
          bytes: size,
          mime,
          elapsedMs: Math.round(performance.now() - started),
        });
        return { image: Buffer.concat(chunks), mime };
      } catch (e) {
        logger.warn('image.download_failed', { host: url.hostname, error: e });
        if (e instanceof HttpError) throw e;
        throw new HttpError(502, 'Falha ao baixar a foto do WhatsApp.');
      }
    },
  };
}
