import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs a production build of the web app (port 3100) against a dedicated API (port 4100)
 * and database `jappo_e2e` on the dev Postgres (infra/docker-compose.yml), reset on each run.
 * Build first with API_INTERNAL_URL=http://localhost:4100 (see `pnpm e2e`).
 */
const PG = process.env.E2E_PG_URL ?? 'postgres://jappo:jappo@localhost:5432';
export const E2E_DB_URL = `${PG}/jappo_e2e`;

const apiEnv = {
  NODE_ENV: 'test',
  API_PORT: '4100',
  DATABASE_URL: E2E_DB_URL,
  API_PUBLIC_URL: 'http://localhost:3100',
  WEB_ORIGIN: 'http://localhost:3100',
  JWT_SECRET: 'e2e-jwt-secret-e2e-jwt-secret-0123456789',
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  PII_HMAC_KEY: 'e2e-hmac-key-e2e-hmac-key',
  FILE_URL_SIGNING_KEY: 'e2e-file-signing-key-0123456789',
  STORAGE_DRIVER: 'fs',
  FS_STORAGE_DIR: '/tmp/jappo-e2e-files',
  EMAIL_TRANSPORT: 'memory',
  SMS_PROVIDER: 'console',
  MFA_ENFORCE: 'true',
  RATE_LIMIT_ENABLED: 'false',
  LOG_LEVEL: 'warn',
  SEED_ADMIN_PASSWORD: 'Jappo-Admin-2026!',
  SEED_ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  WORKER_IN_PROCESS: 'true',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3100', locale: 'fr-FR', timezoneId: 'Africa/Dakar', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  projects: [
    { name: 'phases', testMatch: /p\d+-.*\.spec\.ts/ },
    { name: 'full', testMatch: /full-lifecycle\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node e2e/prepare-db.mjs && pnpm --filter @jappo/api exec tsx src/main.ts',
      url: 'http://localhost:4100/health',
      env: { ...apiEnv, E2E_PG_URL: PG },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm exec next start -p 3100',
      url: 'http://localhost:3100',
      env: { API_INTERNAL_URL: 'http://localhost:4100' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
