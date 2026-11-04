import { inject } from 'vitest';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: inject('databaseUrl'),
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0123456789',
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PII_HMAC_KEY: 'test-hmac-key-test-hmac-key',
  FILE_URL_SIGNING_KEY: 'test-file-signing-key-0123456789',
  STORAGE_DRIVER: 'fs',
  FS_STORAGE_DIR: `${process.cwd()}/.data/test-files`,
  EMAIL_TRANSPORT: 'memory',
  SMS_PROVIDER: 'console',
  MFA_ENFORCE: 'true',
  RATE_LIMIT_ENABLED: 'false',
  LOG_LEVEL: 'silent',
  API_PUBLIC_URL: 'http://localhost:3000',
  SEED_ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  SEED_ADMIN_PASSWORD: 'Jappo-Admin-2026!',
});
