import pino from 'pino';
import { createContext } from './context-factory';
import { startWorker } from './jobs';
import { runMigrations } from './db/migrate';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const { ctx, pool } = createContext(undefined, 5);
await runMigrations(ctx.env.DATABASE_URL);
const w = await startWorker(ctx, (msg, extra) => log.info({ extra }, msg));
log.info('worker started');
const stop = async () => {
  await w.stop();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
