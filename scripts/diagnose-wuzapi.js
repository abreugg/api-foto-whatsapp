import { createWuzapiService } from '../src/services/wuzapi.service.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';

/** Run inside the API container to diagnose its actual network path. No tokens are printed. */
try {
  const config = loadConfig();
  const wuzapi = createWuzapiService(config, fetch, createLogger(config));
  const started = Date.now();
  const users = await wuzapi.listUsers();
  if (!Array.isArray(users))
    throw new Error('A WUZAPI respondeu, mas /admin/users não retornou uma lista.');
  console.log(
    JSON.stringify({
      status: 'ok',
      endpoint: '/admin/users',
      connections: users.length,
      elapsedMs: Date.now() - started,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ status: 'error', httpStatus: error.status || null, message: error.message }),
  );
  process.exitCode = 1;
}
