import { createDb } from './db/client';
import { env as loadEnv, type Env } from './env';
import { createStorage } from './core/files/storage';
import { createSms } from './core/adapters/sms';
import { createEmail } from './core/adapters/email';
import type { ModuleContext } from './core/module';
import type pg from 'pg';

export function createContext(e: Env = loadEnv(), poolSize = 10): { ctx: ModuleContext; pool: pg.Pool } {
  const { db, pool } = createDb(e.DATABASE_URL, poolSize);
  return { ctx: { db, env: e, storage: createStorage(e), sms: createSms(e), email: createEmail(e) }, pool };
}
