import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const MIGRATION_LOCK = 724_000;

export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle'), path.resolve(process.cwd(), 'drizzle'), path.resolve(process.cwd(), 'apps/api/drizzle')];
  const found = candidates.find((c) => existsSync(path.join(c, 'meta/_journal.json')));
  if (!found) throw new Error('drizzle migrations folder not found');
  return found;
}

/** Apply committed SQL migrations under a Postgres advisory lock (safe with several API replicas). */
export async function runMigrations(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    await client.end();
  }
}
