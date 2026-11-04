import { buildApp } from './app';
import { createContext } from './context-factory';
import { runMigrations } from './db/migrate';

const { ctx, pool } = createContext();
if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(ctx.env.DATABASE_URL);
const app = await buildApp({ ctx });
// Single-process mode (dev, e2e, small installs): run the outbox/notification worker inside the API.
const worker = process.env.WORKER_IN_PROCESS === 'true' ? await (await import('./jobs')).startWorker(ctx, (msg) => app.log.info(msg)) : null;
const close = async () => {
  await worker?.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
await app.listen({ port: ctx.env.API_PORT, host: '0.0.0.0' });
