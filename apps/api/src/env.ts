import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  API_PUBLIC_URL: z.string().default('http://localhost:3000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().default('postgres://jappo:jappo@localhost:5432/jappo'),
  LOG_LEVEL: z.string().default('info'),
  JWT_SECRET: z.string().min(32),
  PII_ENCRYPTION_KEY: z.string().min(40),
  PII_HMAC_KEY: z.string().min(16),
  FILE_URL_SIGNING_KEY: z.string().min(16),
  WEBHOOK_SECRET_KEY: z.string().min(40).optional(),
  MFA_ENFORCE: bool.default(true),
  COOKIE_SECURE: bool.default(false),
  RATE_LIMIT_ENABLED: bool.default(true),
  /** Remove one-time codes from stored notifications once delivered (SPEC §18.1). E2E sets false to read codes. */
  OTP_REDACT_AFTER_DELIVERY: bool.default(true),
  STORAGE_DRIVER: z.enum(['s3', 'fs']).default('s3'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('jappo'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  FS_STORAGE_DIR: z.string().default('./.data/files'),
  EMAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('Jappo <no-reply@jappo.local>'),
  SMS_PROVIDER: z.enum(['console', 'http_generic']).default('console'),
  SMS_HTTP_URL: z.string().optional(),
  SMS_HTTP_AUTH_HEADER: z.string().optional(),
  SMS_HTTP_BODY_TEMPLATE: z.string().default('{"to":"{{to}}","text":"{{text}}"}'),
  PAYOUT_PROVIDERS: z.string().default('manual_csv,wave_bulk_csv,orange_money_bulk_csv'),
  SEED_ADMIN_PASSWORD: z.string().default('Jappo-Admin-2026!'),
  SEED_ADMIN_TOTP_SECRET: z.string().optional(),
  SEED_USER_PASSWORD: z.string().default('Jappo-Demo-2026!'),
});

export type Env = z.infer<typeof EnvSchema>;

const blankToUndefined = (src: NodeJS.ProcessEnv): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v === '' ? undefined : v]));

let cached: Env | undefined;
export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(blankToUndefined(src));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test hook: reset cached env after mutating process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
