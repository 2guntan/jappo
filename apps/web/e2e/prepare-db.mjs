// Reset the e2e database, then migrate + seed through the API CLI.
import pg from 'pg';
import { execSync } from 'node:child_process';

const base = process.env.E2E_PG_URL ?? 'postgres://jappo:jappo@localhost:5432';
const c = new pg.Client({ connectionString: `${base}/postgres` });
await c.connect();
await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = 'jappo_e2e' and pid <> pg_backend_pid()`);
await c.query('drop database if exists jappo_e2e');
await c.query('create database jappo_e2e');
await c.end();
execSync('pnpm --filter @jappo/api exec tsx src/cli.ts seed', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: `${base}/jappo_e2e` } });
