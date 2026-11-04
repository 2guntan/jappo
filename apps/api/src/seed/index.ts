import { eq } from 'drizzle-orm';
import { ROLES, ROLE_ORG_TYPES, ORG_TYPES } from '@jappo/contracts';
import { senegalFixedHolidays } from '@jappo/domain';
import type { ModuleContext } from '../core/module';
import { holidays, roles, settings } from '../core/schema';
import { memberships, organizations, users } from '../modules/identity/schema';
import { hashPassword } from '../core/auth/passwords';
import { encryptPii } from '../core/crypto';
import type { Db } from '../db/client';

const ROLE_DESCRIPTIONS: Record<string, string> = {
  platform_admin: 'Everything; KYC review; catalogues; templates; plans; support',
  platform_support: 'Read-only across tenants, impersonation-free',
  org_admin: 'Manage org profile, members, API keys, webhooks, billing',
  operator_manager: 'Build blocks, plans, dossiers, tenders, award, contracts, settlements',
  agronomist: 'Crop plans, templates overrides, visits, yield estimates',
  field_agent: 'Field PWA: enrol farmers, map plots, visits, deliveries, weighing',
  finance_officer: 'Budgets, quotes, invoices, settlement preparation and approval, buyer payments',
  credit_officer: 'Appetite profile, review dossiers, Q&A, draft bids, monitoring, settlement approval',
  credit_committee: 'Submit/withdraw bids, accept award, sign contracts',
  buyer_rep: 'Offtake contracts, dispatch acceptance, invoices, escrow payments',
  viewer: 'Read-only within org scope',
};

/** Platform settings defaults (editable by platform admin). */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'rfp.default_deadline_working_days': 15,
  'rfp.min_bid_share_pct': 20,
  'rfp.max_extensions': 2,
  'bid_evaluation.weights': { cost: 0.5, share: 0.2, speed: 0.15, conditions: 0.15 },
  'facility.default_days': 90,
  'billing.vat_bps': 1800,
  'lender_success_fee_enabled': false,
  'legal.terms_text': 'Jappo fournit des services technologiques et de structuration. Les décisions de crédit appartiennent aux prêteurs. [À compléter par l’administrateur]',
  'legal.privacy_text': 'Données hébergées sur l’infrastructure de l’exploitant, conformément à la loi n° 2008-12. [À compléter par l’administrateur]',
};

export async function seedReference(db: Db): Promise<void> {
  for (const code of ROLES) {
    const t = ROLE_ORG_TYPES[code];
    await db
      .insert(roles)
      .values({ code, orgTypes: t === 'any' ? [...ORG_TYPES] : [...t], description: ROLE_DESCRIPTIONS[code] ?? code })
      .onConflictDoNothing();
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(settings).values({ key, value: value as object }).onConflictDoNothing();
  }
  for (const y of [2026, 2027, 2028]) {
    for (const h of senegalFixedHolidays(y)) await db.insert(holidays).values({ date: h.date, name: h.name }).onConflictDoNothing();
  }
}

export async function seedPlatform(ctx: ModuleContext): Promise<{ orgId: string; adminId: string }> {
  const db = ctx.db;
  let [platform] = await db.select().from(organizations).where(eq(organizations.type, 'platform'));
  platform ??= (
    await db
      .insert(organizations)
      .values({ type: 'platform', legalName: 'Jappo Platform', tradeName: 'Jappo', legalForm: 'SAS', kycStatus: 'verified', email: 'admin@jappo.local', region: 'Dakar' })
      .returning()
  )[0]!;
  let [admin] = await db.select().from(users).where(eq(users.email, 'admin@jappo.local'));
  if (!admin) {
    const totp = ctx.env.SEED_ADMIN_TOTP_SECRET;
    admin = (
      await db
        .insert(users)
        .values({
          email: 'admin@jappo.local',
          fullName: 'Administrateur Jappo',
          passwordHash: await hashPassword(ctx.env.SEED_ADMIN_PASSWORD),
          status: 'active',
          emailVerifiedAt: new Date(),
          mfaTotpSecret: totp ? encryptPii(totp) : null,
          mfaEnabledAt: totp ? new Date() : null,
        })
        .returning()
    )[0]!;
    await db.insert(memberships).values({ userId: admin.id, orgId: platform.id, roles: ['platform_admin'] });
  }
  return { orgId: platform.id, adminId: admin.id };
}

export async function runSeed(ctx: ModuleContext): Promise<void> {
  await seedReference(ctx.db);
  await seedPlatform(ctx);
}
