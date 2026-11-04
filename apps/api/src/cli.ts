import { runMigrations } from './db/migrate';

const cmd = process.argv[2];

async function main() {
  switch (cmd) {
    case 'migrate': {
      const { env } = await import('./env');
      await runMigrations(env().DATABASE_URL);
      console.error('migrations applied');
      return;
    }
    case 'seed': {
      const { createContext } = await import('./context-factory');
      const { runSeed } = await import('./seed');
      const { ctx, pool } = createContext();
      await runMigrations(ctx.env.DATABASE_URL);
      await runSeed(ctx);
      await pool.end();
      console.error('seed complete');
      return;
    }
    case 'openapi': {
      // Build the app without connecting to the database to export the OpenAPI document.
      process.env.JWT_SECRET ??= 'x'.repeat(32);
      process.env.PII_ENCRYPTION_KEY ??= Buffer.alloc(32).toString('base64');
      process.env.PII_HMAC_KEY ??= 'x'.repeat(32);
      process.env.FILE_URL_SIGNING_KEY ??= 'x'.repeat(32);
      process.env.STORAGE_DRIVER = 'fs';
      process.env.EMAIL_TRANSPORT = 'memory';
      const { createContext } = await import('./context-factory');
      const { buildApp } = await import('./app');
      const { ctx, pool } = createContext();
      const app = await buildApp({ ctx, logger: false });
      await app.ready();
      process.stdout.write(JSON.stringify(app.swagger(), null, 2) + '\n');
      await app.close();
      await pool.end();
      return;
    }
    default:
      console.error('usage: cli.ts migrate|seed|openapi');
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
