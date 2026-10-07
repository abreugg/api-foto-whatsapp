import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = new URL('../../database/migrations/', import.meta.url);
const checksum = (sql) => createHash('sha256').update(sql).digest('hex');

/** Files contain plain DDL statements, without procedures or semicolons inside literals. */
export async function migrationFiles() {
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = (await readFile(new URL(name, directory), 'utf8')).replaceAll('\r\n', '\n');
      return {
        name,
        checksum: checksum(sql),
        statements: sql
          .replace(/^--.*$/gm, '')
          .split(';')
          .map((statement) => statement.trim())
          .filter(Boolean),
      };
    }),
  );
}

/** DDL commits implicitly in MySQL: record success only after all statements complete.
 * Each migration must be safe to repeat after an interrupted run.
 * GET_LOCK and RELEASE_LOCK use the same dedicated connection.
 */
export async function migrateDatabase(
  pool,
  database,
  {
    files,
    apply = true,
    report = (event) => console.log(JSON.stringify({ event: 'mysql.migration', ...event })),
  } = {},
) {
  const migrations = files || (await migrationFiles());
  const connection = await pool.getConnection();
  const lock = 'photo-migrations-' + checksum(database).slice(0, 40);
  let locked = false;
  try {
    const [rows] = await connection.execute('SELECT GET_LOCK(?,30) acquired', [lock]);
    if (Number(rows[0]?.acquired) !== 1)
      throw new Error('Não foi possível obter o lock das migrations. Tente novamente.');
    locked = true;
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at BIGINT NOT NULL
    ) ENGINE=InnoDB`);
    const [applied] = await connection.query(
      'SELECT name,checksum,applied_at FROM schema_migrations',
    );
    const known = new Map(applied.map((row) => [row.name, row]));
    // Detect altered files before applying any pending migration.
    for (const migration of migrations) {
      if (known.has(migration.name) && known.get(migration.name).checksum !== migration.checksum)
        throw new Error(
          'Migration já aplicada foi alterada: ' + migration.name + '. Crie uma nova migration.',
        );
    }
    const result = [];
    for (const migration of migrations) {
      if (known.has(migration.name)) {
        result.push({ name: migration.name, status: 'applied' });
        continue;
      }
      if (!apply) {
        result.push({ name: migration.name, status: 'pending' });
        continue;
      }
      report({ name: migration.name, status: 'starting' });
      for (const statement of migration.statements) await connection.query(statement);
      await connection.execute(
        'INSERT INTO schema_migrations(name,checksum,applied_at) VALUES (?,?,?)',
        [migration.name, migration.checksum, Date.now()],
      );
      report({ name: migration.name, status: 'applied' });
      result.push({ name: migration.name, status: 'applied' });
    }
    return result;
  } finally {
    try {
      if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [lock]);
    } finally {
      connection.release();
    }
  }
}
