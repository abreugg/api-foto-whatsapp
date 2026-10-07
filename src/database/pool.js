import mysql from 'mysql2/promise';
import { migrateDatabase } from './migrations.js';
/** Apply pending migrations before accepting HTTP requests. Existing rows are preserved. */
export async function connectDatabase(config) {
  const pool = mysql.createPool(config.mysql);
  try {
    await pool.query('SELECT 1');
    await migrateDatabase(pool, config.mysql.database);
    await pool.execute('INSERT IGNORE INTO settings (`key`,value) VALUES (?,?)', [
      'cache_ttl_seconds',
      String(config.cacheTtl),
    ]);
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
