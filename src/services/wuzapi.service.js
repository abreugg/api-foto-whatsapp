import { HttpError } from '../utils/errors.js';
import { createLogger, safeUrl } from '../utils/logger.js';

/** Adapter for the supplied WUZAPI YAML. Admin and account tokens are distinct. */
export function createWuzapiService(config, fetcher = fetch, logger = createLogger(config)) {
  async function request(route, { method = 'GET', token, body, admin = false } = {}) {
    const started = performance.now();
    logger.debug('wuzapi.request', {
      method,
      route,
      url: safeUrl(config.upstreamUrl + route),
      auth: admin ? 'admin' : 'account',
      timeoutMs: config.upstreamTimeout,
    });
    let response, payload;
    try {
      response = await fetcher(config.upstreamUrl + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(admin ? { Authorization: config.upstreamAdminToken } : { token }),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(config.upstreamTimeout),
        // Inspect redirects without forwarding credentials to another origin.
        redirect: 'manual',
      });
    } catch (error) {
      logger.warn('wuzapi.network_error', {
        method,
        route,
        error,
        elapsedMs: Math.round(performance.now() - started),
      });
      const code = error.cause?.code || error.code;
      if (
        error.name === 'TimeoutError' ||
        ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code)
      )
        throw new HttpError(
          504,
          'A WUZAPI não respondeu dentro do prazo. Verifique WUZAPI_URL, a porta e o firewall do servidor.',
        );
      if (code === 'ECONNREFUSED')
        throw new HttpError(
          502,
          'A WUZAPI recusou a conexão. Verifique se o serviço está ativo na porta configurada.',
        );
      if (['ENOTFOUND', 'EAI_AGAIN'].includes(code))
        throw new HttpError(
          502,
          'Não foi possível resolver o host da WUZAPI. Verifique WUZAPI_URL e o DNS.',
        );
      throw new HttpError(
        502,
        'Não foi possível conectar à WUZAPI. Verifique a URL e a conectividade do servidor.',
      );
    }
    logger.info('wuzapi.response', {
      method,
      route,
      status: response.status,
      contentType: response.headers.get('content-type'),
      elapsedMs: Math.round(performance.now() - started),
    });
    if (response.status >= 300 && response.status < 400)
      throw new HttpError(
        502,
        'A WUZAPI redirecionou a requisição. Configure WUZAPI_URL com a URL final, incluindo HTTPS quando necessário.',
      );
    if ([401, 403].includes(response.status))
      throw new HttpError(
        502,
        admin
          ? 'A WUZAPI rejeitou o admin token. Verifique WUZAPI_ADMIN_TOKEN no .env.'
          : 'A WUZAPI rejeitou o token da conexão. Sincronize as conexões no painel.',
      );
    try {
      payload = await response.json();
    } catch (error) {
      logger.warn('wuzapi.invalid_response', { route, status: response.status, error });
      if (error.name === 'TimeoutError')
        throw new HttpError(
          504,
          'A WUZAPI demorou para enviar a resposta completa. Verifique o serviço remoto.',
        );
      throw new HttpError(
        502,
        `A WUZAPI retornou uma resposta que não é JSON (HTTP ${response.status}). Verifique a URL base e o proxy.`,
      );
    }
    if (!payload || typeof payload !== 'object')
      throw new HttpError(502, 'A WUZAPI retornou um JSON em formato inválido.');
    if (route === '/user/avatar' && response.status === 404)
      throw new HttpError(404, 'Foto indisponível para este número.');
    if (method === 'DELETE' && /^\/admin\/users\/[^/]+$/.test(route) && response.status === 404)
      return { alreadyDeleted: true };
    if (!response.ok || payload.success === false)
      throw new HttpError(
        502,
        'A API WhatsApp recusou a operação. Verifique a conexão e as credenciais.',
      );
    const data = payload.data ?? payload;
    logger.debug('wuzapi.decoded', {
      route,
      success: payload.success !== false,
      dataType: Array.isArray(data) ? 'array' : typeof data,
      count: Array.isArray(data) ? data.length : undefined,
    });
    return data;
  }
  return {
    listUsers: () => request('/admin/users', { admin: true }),
    createUser: (name, token) =>
      request('/admin/users', { method: 'POST', admin: true, body: { name, token, events: '' } }),
    deleteUser: (id) =>
      request('/admin/users/' + encodeURIComponent(id), { method: 'DELETE', admin: true }),
    async avatar(token, phone) {
      let data;
      try {
        data = await request('/user/avatar', {
          method: 'POST',
          token,
          body: { Phone: phone, Preview: false },
        });
      } catch (error) {
        if (error.status !== 404) throw error;
        return { URL: '' };
      }
      // Live WUZAPI uses lowercase url; the supplied YAML documents uppercase URL.
      const url = data?.URL || data?.url;
      logger.debug('wuzapi.avatar_decoded', {
        hasPhotoUrl: typeof url === 'string' && url.length > 0,
        urlField: data?.URL ? 'URL' : data?.url ? 'url' : null,
      });
      return { URL: typeof url === 'string' ? url : '' };
    },
    connect: (token) =>
      request('/session/connect', {
        method: 'POST',
        token,
        body: { Immediate: true, Subscribe: [] },
      }),
    disconnect: (token) => request('/session/disconnect', { method: 'POST', token }),
    status: (token) => request('/session/status', { token }),
    qr: (token) => request('/session/qr', { token }),
  };
}
