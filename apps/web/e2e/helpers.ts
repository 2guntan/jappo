import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { Secret, TOTP } from 'otpauth';

const PG = process.env.E2E_PG_URL ?? 'postgres://jappo:jappo@localhost:5432';
export const ADMIN = { email: 'admin@jappo.local', password: 'Jappo-Admin-2026!', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
export const PASSWORD = 'Kawral-Secure-Pass-2026';

export const totp = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();

/** Query the e2e database (to read links that would arrive by email/SMS). */
export async function dbQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: `${PG}/jappo_e2e` });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export async function latestLinkToken(destination: string, template: string): Promise<string> {
  const rows = await dbQuery<{ body: string }>(
    'select body from notifications where destination = $1 and template_code = $2 order by id desc limit 1',
    [destination, template],
  );
  const m = /token=([A-Za-z0-9_-]+)/.exec(rows[0]?.body ?? '');
  if (!m) throw new Error(`no ${template} link for ${destination}`);
  return m[1]!;
}

export async function login(page: Page, email: string, password: string, totpSecret?: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form button[type=submit]').click();
  if (totpSecret) {
    await expect(page.locator('#totp')).toBeVisible();
    await page.locator('#totp').fill(totp(totpSecret));
    await page.locator('form button[type=submit]').click();
  }
  await page.waitForURL(/\/app/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /déconnecter|log out/i }).click();
  await page.waitForURL(/\/login/);
}

export const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });
