export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
/** Database errors and upstream credentials are never sent to clients. */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  const message =
    error instanceof HttpError
      ? error.message
      : status === 400
        ? 'JSON inválido.'
        : status === 413
          ? 'Corpo maior que 64 KB.'
          : 'Erro interno do servidor.';
  if (status === 500)
    console.error(
      JSON.stringify({
        event: 'internal_error',
        method: req.method,
        path: req.path,
        code: error.code || error.name,
      }),
    );
  res.status(status).json({
    error: message,
    ...(error.photoUnavailable
      ? { cacheHit: error.cacheHit, savedAt: error.savedAt, expiresAt: error.expiresAt }
      : {}),
  });
}
