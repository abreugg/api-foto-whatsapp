import { loadConfig } from './config/env.js';
import { connectDatabase } from './database/pool.js';
import { createApp } from './app.js';
import { createLogger } from './utils/logger.js';

try {
  const config = loadConfig();
  const logger = createLogger(config);
  logger.info('application.starting', { environment: config.environment, port: config.port });
  logger.debug('mysql.connecting', {
    host: config.mysql.host,
    port: config.mysql.port,
    database: config.mysql.database,
  });
  const pool = await connectDatabase(config);
  logger.info('mysql.ready', { database: config.mysql.database });
  const app = createApp({ config, pool, logger });
  const server = app.listen(config.port, config.host, () =>
    console.log(`API: ${config.publicUrl} | Painel: ${config.publicUrl}/admin`),
  );
  server.on('error', async (e) => {
    console.error(`Falha HTTP: ${e.code}`);
    await pool.end();
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      logger.info('application.stopping', { signal });
      const timeout = setTimeout(() => process.exit(1), 20000);
      timeout.unref();
      server.close(async () => {
        await pool.end();
        clearTimeout(timeout);
        process.exit(0);
      });
    });
} catch (error) {
  console.error(`Falha ao iniciar: ${error.code || error.message}`);
  process.exit(1);
}
