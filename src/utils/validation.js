import { HttpError } from './errors.js';
import { MAX_CACHE_TTL_SECONDS } from '../config/constants.js';
export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^\+?[\d ()-]+$/.test(value))
    throw new HttpError(400, 'Informe o número com DDI.');
  const phone = value.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new HttpError(400, 'Use de 8 a 15 dígitos com DDI.');
  return phone;
}
export function normalizeOrigin(value) {
  try {
    const u = new URL(value);
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}
export function requiredName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80)
    throw new HttpError(400, 'Informe um nome de até 80 caracteres.');
  return value.trim();
}
export function requiredBoolean(value, name) {
  if (typeof value !== 'boolean') throw new HttpError(400, `${name} deve ser booleano.`);
  return Number(value);
}
export function cacheSeconds(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CACHE_TTL_SECONDS)
    throw new HttpError(
      400,
      `Tempo de cache deve ser inteiro entre 0 e ${MAX_CACHE_TTL_SECONDS} segundos.`,
    );
  return value;
}
export function historyFilters(query) {
  return {
    apiKeyId: typeof query.apiKeyId === 'string' ? query.apiKeyId : null,
    domainId: typeof query.domainId === 'string' ? query.domainId : null,
    phone: query.phone ? normalizePhone(query.phone) : null,
    page: Math.max(1, Math.min(1000000, Number.parseInt(query.page, 10) || 1)),
  };
}
