import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from './pool.js';

interface AppliedMigration {
  version: string;
  checksum: string;
}

const projectRoot = resolve(import.meta.dirname, '../../../..');
const baselineFiles = [
  resolve(projectRoot, 'database/init/001_schema.sql'),
  resolve(projectRoot, 'database/init/002_seed.sql'),
];
const migrationsDirectory = resolve(projectRoot, 'database/migrations');

function checksum(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function ensureBaseline(client: PoolClient, applied: Map<string, string>): Promise<void> {
  const version = '001_initial_baseline';
  const scripts = await Promise.all(baselineFiles.map((file) => readFile(file, 'utf8')));
  const currentChecksum = checksum(scripts.join('\n'));
  const recordedChecksum = applied.get(version);

  if (recordedChecksum) {
    if (recordedChecksum !== currentChecksum) {
      throw new Error(`${version} was modified after it was applied`);
    }
    return;
  }

  const tableResult = await client.query<{ exists: string | null }>(
    "SELECT to_regclass('public.users')::text AS exists",
  );

  if (!tableResult.rows[0]?.exists) {
    for (const script of scripts) {
      await client.query(script);
    }
  }

  await client.query(
    'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
    [version, currentChecksum],
  );
}

async function applySqlMigrations(
  client: PoolClient,
  applied: Map<string, string>,
): Promise<void> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^\d{3}_[a-z0-9_]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    const version = file.slice(0, -4);
    const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
    const currentChecksum = checksum(sql);
    const recordedChecksum = applied.get(version);

    if (recordedChecksum) {
      if (recordedChecksum !== currentChecksum) {
        throw new Error(`${version} was modified after it was applied`);
      }
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [version, currentChecksum],
      );
      await client.query('COMMIT');
      console.log(`Applied migration ${version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('knowledgehub_schema_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(160) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const result = await client.query<AppliedMigration>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(result.rows.map((row) => [row.version, row.checksum]));

    await ensureBaseline(client, applied);
    await applySqlMigrations(client, applied);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('knowledgehub_schema_migrations'))");
    client.release();
  }
}

runMigrations()
  .then(async () => {
    console.log('Database migrations are up to date');
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
