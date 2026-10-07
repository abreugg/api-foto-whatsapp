import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config/env.js';
import { migrateDatabase } from '../src/database/migrations.js';

let pool;
try {
  const config = loadConfig();
  pool = mysql.createPool(config.mysql);
  const result = await migrateDatabase(pool, config.mysql.database, {
    apply: !process.argv.includes('--status'),
  });
  console.log(JSON.stringify({ event: 'mysql.migrations', migrations: result }));
} catch (error) {
  console.error('Falha nas migrations: ' + (error.code || error.message));
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
