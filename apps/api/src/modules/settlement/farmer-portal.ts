import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client';
import { farmerStatements, settlementLines, settlementRuns } from './schema';
import { farmers } from '../farmers/schema';
import { blocks, plotAllocations, plots } from '../land/schema';
import { seasons } from '../planning/schema';
import { organizations } from '../identity/schema';
import { files } from '../../core/schema';
import type { ActorContext } from '../../core/context';
import { audit } from '../../core/audit';
import { notFound, unauthorized } from '../../core/errors';
import { signAccessToken } from '../../core/auth/tokens';
import { consumeOtp, createOtp } from '../identity/service';

const FARMER_TTL_SECONDS = 60 * 60;

function farmerOf(actor: ActorContext) {
  if (actor.principal.type !== 'farmer') throw unauthorized('FARMER_TOKEN_REQUIRED', 'Sign in with your phone number');
  return actor.principal.farmerId;
}

/** Phone OTP for the farmer portal; never reveals whether the number is known. */
export async function requestFarmerOtp(db: Db, phone: string) {
  const [f] = await db.select().from(farmers).where(and(eq(farmers.phone, phone), eq(farmers.status, 'active'))).limit(1);
  if (!f) return;
  await db.transaction((tx) => createOtp(tx, phone, 'farmer_login', f.locale, { type: 'farmer', id: f.id, orgId: f.ownerOrgId }, f.id));
}

export async function verifyFarmerOtp(db: Db, actor: ActorContext, phone: string, code: string) {
  const [f] = await db.select().from(farmers).where(and(eq(farmers.phone, phone), eq(farmers.status, 'active'))).limit(1);
  if (!f) throw unauthorized('OTP_INVALID', 'Incorrect code');
  await consumeOtp(db, phone, 'farmer_login', code, f.id);
  await db.transaction((tx) => audit(tx, { ...actor, principal: { type: 'farmer', farmerId: f.id, orgId: f.ownerOrgId }, orgId: f.ownerOrgId }, { action: 'auth.farmer_login', resourceType: 'farmer', resourceId: f.id }));
  return { accessToken: await signAccessToken({ sub: f.id, typ: 'farmer', mfa: false, org: f.ownerOrgId }, FARMER_TTL_SECONDS), expiresIn: FARMER_TTL_SECONDS };
}

export async function meFarmer(db: DbOrTx, actor: ActorContext) {
  const [f] = await db.select().from(farmers).where(eq(farmers.id, farmerOf(actor)));
  if (!f) throw notFound('Farmer');
  const [o] = await db.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, f.ownerOrgId));
  return {
    id: f.id,
    code: f.code,
    firstName: f.firstName,
    lastName: f.lastName,
    village: f.village,
    phoneMasked: f.phone ? `**** ${f.phone.slice(-4)}` : null,
    walletMasked: f.mobileWalletLast4 ? `**** ${f.mobileWalletLast4}` : null,
    walletVerified: Boolean(f.walletVerifiedAt),
    operatorName: o?.name ?? '',
    locale: f.locale,
  };
}

export async function mePlots(db: DbOrTx, actor: ActorContext) {
  const rows = await db
    .select({ a: plotAllocations, code: plots.code, areaHa: plots.areaHa, bref: blocks.ref, bname: blocks.name })
    .from(plotAllocations)
    .innerJoin(plots, eq(plots.id, plotAllocations.plotId))
    .innerJoin(blocks, eq(blocks.id, plotAllocations.blockId))
    .where(eq(plotAllocations.farmerId, farmerOf(actor)));
  return rows.map((r) => ({ plotId: r.a.plotId, plotCode: r.code, blockRef: r.bref, blockName: r.bname, areaHa: Number(r.areaHa), sharePct: Number(r.a.sharePct), status: r.a.status }));
}

export async function meStatements(db: DbOrTx, actor: ActorContext) {
  const farmerId = farmerOf(actor);
  const rows = await db
    .select({ s: farmerStatements, ref: settlementRuns.ref, seasonName: seasons.name, blockName: blocks.name, runId: settlementRuns.id })
    .from(farmerStatements)
    .innerJoin(settlementRuns, eq(settlementRuns.id, farmerStatements.runId))
    .innerJoin(seasons, eq(seasons.id, settlementRuns.seasonId))
    .innerJoin(blocks, eq(blocks.id, settlementRuns.blockId))
    .where(eq(farmerStatements.farmerId, farmerId))
    .orderBy(desc(farmerStatements.createdAt));
  const lines = rows.length ? await db.select().from(settlementLines).where(and(eq(settlementLines.farmerId, farmerId), inArray(settlementLines.runId, rows.map((r) => r.runId)))) : [];
  return rows.map((r) => {
    const l = lines.find((x) => x.runId === r.runId);
    const a = l?.arrearsCreatedXof ?? { seasonalDebtXof: 0, investmentFeeXof: 0, operatorFeesXof: 0 };
    return { id: r.s.id, runRef: r.ref, seasonName: r.seasonName, blockName: r.blockName, grossCreditXof: l?.grossCreditXof ?? 0, payoutXof: l?.payoutXof ?? 0, arrearsXof: a.seasonalDebtXof + a.investmentFeeXof + a.operatorFeesXof, createdAt: r.s.createdAt.toISOString() };
  });
}

/** The statement PDF file of the farmer (own statements only). */
export async function meStatementFile(db: DbOrTx, actor: ActorContext, id: string) {
  const [s] = await db.select().from(farmerStatements).where(and(eq(farmerStatements.id, id), eq(farmerStatements.farmerId, farmerOf(actor))));
  if (!s?.pdfFileId) throw notFound('Statement');
  const [f] = await db.select().from(files).where(eq(files.id, s.pdfFileId));
  if (!f) throw notFound('Statement');
  return f;
}
