import { buildApp } from './app';
import { createContext } from './context-factory';
import { runMigrations } from './db/migrate';

const { ctx, pool } = createContext();
if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(ctx.env.DATABASE_URL);
const app = await buildApp({ ctx });
const close = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
await app.listen({ port: ctx.env.API_PORT, host: '0.0.0.0' });
