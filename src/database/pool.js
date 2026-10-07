import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
/** Run the idempotent initial schema without enabling multiStatements. */
export async function connectDatabase(config) {
  const pool = mysql.createPool(config.mysql);
  try {
    await pool.query('SELECT 1');
    const sql = await readFile(
      new URL('../../database/migrations/001_initial.sql', import.meta.url),
      'utf8',
    );
    for (const statement of sql
      .replace(/^--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await pool.query(statement);
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
