import { and, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FarmerCreateBody, FarmerUpdateBody } from '@jappo/contracts';
import type { Db, DbOrTx } from '../../db/client';
import { farmerFlags, farmers } from './schema';
import { blocks, plotAllocations, plots } from '../land/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { decryptPii, encryptPii, mask, piiHash } from '../../core/crypto';
import { hasPermission } from '../../core/authz/permissions';
import { accessGrants } from '../../core/schema';
import { geomFromGeoJson, asGeoJson, qcol } from '../../core/geo';
import { assertVersion } from '../../core/etag';
import { createOtp, consumeOtp } from '../identity/service';
import { decodeCursor, toPage } from '../../core/pagination';
import { csvToObjects, toCsv } from '../../core/csv';

export type FarmerRow = typeof farmers.$inferSelect & { homeLocationJson?: unknown };
export const CONSENT_TEXT_VERSION = 'consent-v1-2026';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Columns + GeoJSON of home location. */
const farmerSelect = { f: farmers, home: asGeoJson(farmers.homeLocation) };

export function farmerDto(r: { f: typeof farmers.$inferSelect; home: unknown }, actor: ActorContext, flags: { id: string; type: string; detail: string | null }[] = []) {
  const f = r.f;
  const own = actor.orgId === f.ownerOrgId;
  const actions: string[] = [];
  if (own && hasPermission(actor.permissions, 'farmer:update')) actions.push('update');
  if (own && hasPermission(actor.permissions, 'farmer:verify_kyc') && f.kycStatus !== 'verified') actions.push('verify_kyc');
  if (own && hasPermission(actor.permissions, 'farmer:verify_wallet') && f.mobileWalletNumberEnc && !f.walletVerifiedAt) actions.push('verify_wallet');
  if (own && hasPermission(actor.permissions, 'farmer:pii_read')) actions.push('reveal_pii');
  return {
    id: f.id,
    ownerOrgId: f.ownerOrgId,
    code: f.code,
    firstName: f.firstName,
    lastName: f.lastName,
    sex: f.sex,
    birthYear: f.birthYear,
    phone: own || isPlatformStaff(actor) ? f.phone : mask(f.phone),
    locale: f.locale,
    nationalIdType: f.nationalIdType,
    nationalIdNumberMasked: f.nationalIdLast4 ? `**** ${f.nationalIdLast4}` : null,
    photoFileId: f.photoFileId,
    idPhotoFileId: f.idPhotoFileId,
    village: f.village,
    commune: f.commune,
    homeLocation: (r.home as { type: 'Point'; coordinates: [number, number] } | null) ?? null,
    householdSize: f.householdSize,
    baselineIncomeXof: f.baselineIncomeXof,
    mobileWalletProvider: f.mobileWalletProvider,
    mobileWalletNumberMasked: f.mobileWalletLast4 ? `**** ${f.mobileWalletLast4}` : null,
    walletVerifiedAt: iso(f.walletVerifiedAt),
    consentDataAt: iso(f.consentDataAt),
    consentCreditBureauAt: iso(f.consentCreditBureauAt),
    kycStatus: f.kycStatus,
    kycVerifiedAt: iso(f.kycVerifiedAt),
    status: f.status,
    flags,
    version: f.version,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    allowedActions: actions,
  };
}

/** Farmers visible to the actor: own org, platform staff, or allocated on a block the actor has a grant on (SPEC §6.3). */
export function farmerVisibility(actor: ActorContext): SQL {
  if (isPlatformStaff(actor)) return sql`true`;
  if (!actor.orgId) return sql`false`;
  return or(
    sql`${qcol(farmers.ownerOrgId)} = ${actor.orgId}`,
    sql`exists (select 1 from ${plotAllocations} pa join ${accessGrants} g on g.resource_type = 'block' and g.resource_id = pa.block_id
      where pa.farmer_id = ${qcol(farmers.id)} and g.grantee_org_id = ${actor.orgId} and (g.expires_at is null or g.expires_at > now()))`,
  )!;
}

export async function getFarmer(db: DbOrTx, actor: ActorContext, id: string) {
  const [r] = await db.select(farmerSelect).from(farmers).where(and(eq(farmers.id, id), farmerVisibility(actor)));
  if (!r) throw notFound('Farmer');
  return r;
}

async function flagsFor(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; type: string; detail: string | null }[]>();
  const rows = await db.select().from(farmerFlags).where(and(inArray(farmerFlags.farmerId, ids), isNull(farmerFlags.resolvedAt)));
  const m = new Map<string, { id: string; type: string; detail: string | null }[]>();
  for (const r of rows) m.set(r.farmerId, [...(m.get(r.farmerId) ?? []), { id: r.id, type: r.type, detail: r.detail }]);
  return m;
}

export async function farmerOut(db: DbOrTx, actor: ActorContext, id: string) {
  const r = await getFarmer(db, actor, id);
  return farmerDto(r, actor, (await flagsFor(db, [id])).get(id) ?? []);
}

export interface ListFarmersQuery {
  limit: number;
  cursor?: string;
  q?: string;
  blockId?: string;
  kycStatus?: string;
  status?: string;
}

export async function listFarmers(db: Db, actor: ActorContext, q: ListFarmersQuery) {
  const conds: SQL[] = [farmerVisibility(actor), isNull(farmers.pseudonymisedAt)];
  if (q.q) conds.push(or(ilike(farmers.firstName, `%${q.q}%`), ilike(farmers.lastName, `%${q.q}%`), ilike(farmers.code, `%${q.q}%`), ilike(farmers.phone, `%${q.q}%`), ilike(farmers.village, `%${q.q}%`))!);
  if (q.kycStatus) conds.push(eq(farmers.kycStatus, q.kycStatus as 'pending'));
  if (q.status) conds.push(eq(farmers.status, q.status as 'active'));
  if (q.blockId) conds.push(sql`exists (select 1 from ${plotAllocations} pa where pa.farmer_id = ${qcol(farmers.id)} and pa.block_id = ${q.blockId} and pa.status = 'active')`);
  const c = decodeCursor(q.cursor);
  if (c) conds.push(lt(farmers.id, c.id));
  const rows = await db.select(farmerSelect).from(farmers).where(and(...conds)).orderBy(desc(farmers.id)).limit(q.limit + 1);
  const flags = await flagsFor(db, rows.map((r) => r.f.id));
  return toPage(rows.map((r) => ({ ...r, id: r.f.id })), q.limit, (r) => farmerDto(r, actor, flags.get(r.f.id) ?? []));
}

async function nextFarmerCode(tx: DbOrTx, orgId: string): Promise<string> {
  const r = await tx.execute<{ last: number }>(sql`
    insert into ref_sequences (prefix, year, last) values (${`F:${orgId}`}, 0, 1)
    on conflict (prefix, year) do update set last = ref_sequences.last + 1 returning last`);
  return `F-${String(r.rows[0]!.last).padStart(6, '0')}`;
}

function piiColumns(body: FarmerUpdateBody) {
  const out: Partial<typeof farmers.$inferInsert> = {};
  if (body.nationalIdNumber !== undefined) {
    const v = body.nationalIdNumber?.replace(/\s+/g, '') || null;
    out.nationalIdNumberEnc = v ? encryptPii(v) : null;
    out.nationalIdHash = v ? piiHash(v) : null;
    out.nationalIdLast4 = v ? v.slice(-4) : null;
  }
  if (body.mobileWalletNumber !== undefined) {
    const v = body.mobileWalletNumber;
    out.mobileWalletNumberEnc = v ? encryptPii(v) : null;
    out.mobileWalletHash = v ? piiHash(v) : null;
    out.mobileWalletLast4 = v ? v.slice(-4) : null;
    out.walletVerifiedAt = null; // a new wallet must be verified again
  }
  return out;
}

function plainColumns(body: FarmerUpdateBody, existing?: typeof farmers.$inferSelect) {
  const out: Partial<typeof farmers.$inferInsert> = {};
  const keys = ['firstName', 'lastName', 'sex', 'birthYear', 'phone', 'locale', 'nationalIdType', 'photoFileId', 'idPhotoFileId', 'village', 'commune', 'householdSize', 'baselineIncomeXof', 'mobileWalletProvider'] as const;
  for (const k of keys) if (body[k] !== undefined) (out as Record<string, unknown>)[k] = body[k];
  if (body.homeLocation !== undefined) out.homeLocation = (body.homeLocation ? geomFromGeoJson(body.homeLocation) : null) as unknown as string;
  if (body.consentData !== undefined) {
    out.consentDataAt = body.consentData ? (existing?.consentDataAt ?? new Date()) : null;
    if (body.consentData) out.consentTextVersion = CONSENT_TEXT_VERSION;
  }
  if (body.consentCreditBureau !== undefined) out.consentCreditBureauAt = body.consentCreditBureau ? (existing?.consentCreditBureauAt ?? new Date()) : null;
  return out;
}

async function assertUnique(tx: DbOrTx, orgId: string, cols: Partial<typeof farmers.$inferInsert>, exceptId?: string) {
  const conds: SQL[] = [];
  if (cols.phone) conds.push(eq(farmers.phone, cols.phone));
  if (cols.nationalIdHash) conds.push(eq(farmers.nationalIdHash, cols.nationalIdHash));
  if (!conds.length) return;
  const where = [eq(farmers.ownerOrgId, orgId), or(...conds)!];
  if (exceptId) where.push(ne(farmers.id, exceptId));
  const [dup] = await tx.select({ id: farmers.id, phone: farmers.phone, code: farmers.code }).from(farmers).where(and(...where));
  if (dup) {
    const field = cols.phone && dup.phone === cols.phone ? 'phone' : 'nationalIdNumber';
    throw conflict('FARMER_DUPLICATE', `A farmer with the same ${field} already exists (${dup.code})`, { existingFarmerId: dup.id, field });
  }
}

/** Cross-operator duplicate detection by national id → flag, never block (SPEC §7.3). */
async function flagCrossOperatorDuplicates(tx: DbOrTx, farmerId: string, orgId: string, hash: string | null | undefined) {
  if (!hash) return;
  const others = await tx.select({ id: farmers.id, ownerOrgId: farmers.ownerOrgId }).from(farmers).where(and(eq(farmers.nationalIdHash, hash), ne(farmers.ownerOrgId, orgId)));
  if (!others.length) return;
  await tx.insert(farmerFlags).values({ farmerId, type: 'duplicate_suspected', detail: `National ID also registered by ${others.length} other operator(s)`, data: { otherFarmerIds: others.map((o) => o.id) } });
}

export function assertOperator(actor: ActorContext) {
  if (actor.orgType !== 'operator') throw forbidden('OPERATOR_ONLY', 'Only operator organisations manage farmers and blocks');
}

export async function createFarmer(tx: DbOrTx, actor: ActorContext, body: FarmerCreateBody): Promise<string> {
  assertOperator(actor);
  const orgId = requireOrg(actor);
  if (body.nationalIdType && body.nationalIdType !== 'none' && !body.nationalIdNumber) {
    throw badRequest('VALIDATION_FAILED', 'nationalIdNumber is required for this ID type', [{ path: 'body.nationalIdNumber', message: 'required' }]);
  }
  const pii = piiColumns(body);
  const plain = plainColumns(body);
  await assertUnique(tx, orgId, { ...plain, ...pii });
  const code = await nextFarmerCode(tx, orgId);
  const [f] = await tx
    .insert(farmers)
    .values({ ownerOrgId: orgId, code, firstName: body.firstName, lastName: body.lastName, sex: body.sex, ...plain, ...pii, createdBy: actorUserId(actor) })
    .returning({ id: farmers.id });
  await flagCrossOperatorDuplicates(tx, f!.id, orgId, pii.nationalIdHash);
  await audit(tx, actor, { action: 'farmer.created', resourceType: 'farmer', resourceId: f!.id, after: { code, firstName: body.firstName, lastName: body.lastName } });
  await emit(tx, actor, 'farmer.created', { type: 'farmer', id: f!.id }, { code });
  return f!.id;
}

export async function updateFarmer(tx: DbOrTx, actor: ActorContext, id: string, expectedVersion: number, body: FarmerUpdateBody): Promise<void> {
  const orgId = requireOrg(actor);
  const { f } = await getFarmer(tx, actor, id);
  if (f.ownerOrgId !== orgId) throw notFound('Farmer');
  assertVersion(expectedVersion, f.version);
  const pii = piiColumns(body);
  const plain = plainColumns(body, f);
  await assertUnique(tx, orgId, { ...plain, ...pii }, id);
  // Identity changes after KYC verification reset the verification (rule 3: safer for lenders).
  const identityChanged = ['firstName', 'lastName', 'nationalIdNumber', 'nationalIdType'].some((k) => (body as Record<string, unknown>)[k] !== undefined);
  const kyc = identityChanged && f.kycStatus === 'verified' ? { kycStatus: 'pending' as const, kycVerifiedAt: null, kycVerifiedBy: null } : {};
  const [u] = await tx
    .update(farmers)
    .set({ ...plain, ...pii, ...kyc, version: f.version + 1 })
    .where(and(eq(farmers.id, id), eq(farmers.version, f.version)))
    .returning({ id: farmers.id });
  if (!u) throw conflict('VERSION_CONFLICT');
  if (pii.nationalIdHash) await flagCrossOperatorDuplicates(tx, id, orgId, pii.nationalIdHash);
  const changed = Object.keys(body).map((k) => (k === 'nationalIdNumber' || k === 'mobileWalletNumber' ? `${k}(masked)` : k));
  await audit(tx, actor, { action: 'farmer.updated', resourceType: 'farmer', resourceId: id, after: { changed } });
  await emit(tx, actor, 'farmer.updated', { type: 'farmer', id }, { changed });
}

export async function verifyFarmerKyc(db: Db, actor: ActorContext, id: string, expectedVersion: number) {
  return db.transaction(async (tx) => {
    const { f } = await getFarmer(tx, actor, id);
    if (f.ownerOrgId !== actor.orgId) throw notFound('Farmer');
    assertVersion(expectedVersion, f.version);
    if (f.kycStatus === 'verified') throw conflict('INVALID_STATE_TRANSITION', 'Farmer KYC already verified');
    const missing: string[] = [];
    if (!f.consentDataAt) missing.push('consentData');
    if (f.nationalIdType === 'none' && !f.photoFileId) missing.push('nationalIdNumber|photoFileId');
    if (missing.length) throw unprocessable('FARMER_KYC_INCOMPLETE', `Missing: ${missing.join(', ')}`, missing.map((m) => ({ path: m, message: 'required' })));
    await tx.update(farmers).set({ kycStatus: 'verified', kycVerifiedAt: new Date(), kycVerifiedBy: actorUserId(actor), version: f.version + 1 }).where(eq(farmers.id, id));
    await audit(tx, actor, { action: 'farmer.kyc_verified', resourceType: 'farmer', resourceId: id });
    await emit(tx, actor, 'farmer.kyc_verified', { type: 'farmer', id }, {});
  });
}

export async function startWalletVerification(db: Db, actor: ActorContext, id: string) {
  const { f } = await getFarmer(db, actor, id);
  if (f.ownerOrgId !== actor.orgId) throw notFound('Farmer');
  if (!f.mobileWalletNumberEnc) throw unprocessable('WALLET_MISSING', 'The farmer has no mobile wallet number');
  if (f.walletVerifiedAt) throw conflict('WALLET_ALREADY_VERIFIED');
  const phone = decryptPii(f.mobileWalletNumberEnc);
  await db.transaction((tx) => createOtp(tx, phone, 'wallet_verify', f.locale, { type: 'farmer', id: f.id, orgId: f.ownerOrgId }, f.id));
}

export async function confirmWallet(db: Db, actor: ActorContext, id: string, code: string) {
  const { f } = await getFarmer(db, actor, id);
  if (f.ownerOrgId !== actor.orgId) throw notFound('Farmer');
  if (!f.mobileWalletNumberEnc) throw unprocessable('WALLET_MISSING');
  await consumeOtp(db, decryptPii(f.mobileWalletNumberEnc), 'wallet_verify', code, f.id);
  await db.transaction(async (tx) => {
    await tx.update(farmers).set({ walletVerifiedAt: new Date(), version: f.version + 1 }).where(eq(farmers.id, id));
    await audit(tx, actor, { action: 'farmer.wallet_verified', resourceType: 'farmer', resourceId: id });
  });
}

/** Reveal full PII; every access is audited with a reason (SPEC §18.1). */
export async function revealPii(db: Db, actor: ActorContext, id: string, reason: string) {
  const { f } = await getFarmer(db, actor, id);
  if (f.ownerOrgId !== actor.orgId) throw notFound('Farmer');
  await db.transaction((tx) => audit(tx, actor, { action: 'farmer.pii_revealed', resourceType: 'farmer', resourceId: id, after: { reason } }));
  return {
    nationalIdNumber: f.nationalIdNumberEnc ? decryptPii(f.nationalIdNumberEnc) : null,
    mobileWalletNumber: f.mobileWalletNumberEnc ? decryptPii(f.mobileWalletNumberEnc) : null,
  };
}

export async function farmerHistory(db: Db, actor: ActorContext, id: string) {
  await getFarmer(db, actor, id);
  const rows = await db
    .select({ a: plotAllocations, plotCode: plots.code, blockName: blocks.name })
    .from(plotAllocations)
    .innerJoin(plots, eq(plots.id, plotAllocations.plotId))
    .innerJoin(blocks, eq(blocks.id, plotAllocations.blockId))
    .where(eq(plotAllocations.farmerId, id))
    .orderBy(desc(plotAllocations.startDate));
  return {
    allocations: rows.map(({ a, plotCode, blockName }) => ({ id: a.id, plotId: a.plotId, plotCode, blockId: a.blockId, blockName, sharePct: Number(a.sharePct), startDate: a.startDate, endDate: a.endDate, status: a.status })),
    deliveries: [],
    statements: [],
    arrears: [],
  };
}

// ---------------------------------------------------------------- CSV import

export const IMPORT_COLUMNS = [
  'first_name', 'last_name', 'sex', 'birth_year', 'phone', 'village', 'commune', 'national_id_type', 'national_id_number',
  'mobile_wallet_provider', 'mobile_wallet_number', 'household_size', 'baseline_income_xof', 'consent_data', 'consent_credit_bureau',
] as const;

export const importTemplateCsv = () =>
  toCsv([...IMPORT_COLUMNS], [['Awa', 'Diatta', 'F', '1988', '+221771234567', 'Niaguis', 'Niaguis', 'cni', '1234567890123', 'wave', '+221771234567', '6', '150000', 'yes', 'yes']]);

const yes = (v: string) => ['yes', 'oui', 'y', 'o', '1', 'true', 'vrai', 'x'].includes(v.trim().toLowerCase());
const intOrNull = (v: string) => (v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

/** Import farmers from CSV, idempotent by phone / national id (upsert), with row-level errors (SPEC §10.3). */
export async function importFarmers(db: Db, actor: ActorContext, csv: string) {
  assertOperator(actor);
  const orgId = requireOrg(actor);
  const { header, rows } = csvToObjects(csv);
  const missingCols = ['first_name', 'last_name', 'sex'].filter((c) => !header.includes(c));
  if (missingCols.length) throw unprocessable('CSV_COLUMNS_MISSING', `Missing columns: ${missingCols.join(', ')}`);
  const result = { created: 0, updated: 0, failed: 0, rows: [] as { row: number; status: 'created' | 'updated' | 'error'; farmerId: string | null; code: string | null; errors: { field: string; message: string }[] }[] };
  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2;
    const errors: { field: string; message: string }[] = [];
    const body = {
      firstName: r.first_name ?? '',
      lastName: r.last_name ?? '',
      sex: (r.sex ?? '').toUpperCase() as 'F' | 'M',
      birthYear: intOrNull(r.birth_year ?? ''),
      phone: r.phone || null,
      village: r.village || null,
      commune: r.commune || null,
      nationalIdType: ((r.national_id_type || (r.national_id_number ? 'cni' : 'none')) as 'cni'),
      nationalIdNumber: r.national_id_number || null,
      mobileWalletProvider: ((r.mobile_wallet_provider || (r.mobile_wallet_number ? 'other' : 'none')) as 'wave'),
      mobileWalletNumber: r.mobile_wallet_number || null,
      householdSize: intOrNull(r.household_size ?? ''),
      baselineIncomeXof: intOrNull(r.baseline_income_xof ?? ''),
      consentData: yes(r.consent_data ?? ''),
      consentCreditBureau: yes(r.consent_credit_bureau ?? ''),
    };
    if (!body.firstName) errors.push({ field: 'first_name', message: 'required' });
    if (!body.lastName) errors.push({ field: 'last_name', message: 'required' });
    if (body.sex !== 'F' && body.sex !== 'M') errors.push({ field: 'sex', message: 'F or M' });
    for (const k of ['birthYear', 'householdSize', 'baselineIncomeXof'] as const) if (Number.isNaN(body[k])) errors.push({ field: k, message: 'integer expected' });
    for (const k of ['phone', 'mobileWalletNumber'] as const) if (body[k] && !/^\+[1-9]\d{7,14}$/.test(body[k]!)) errors.push({ field: k === 'phone' ? 'phone' : 'mobile_wallet_number', message: 'international format +221…' });
    if (!['cni', 'passport', 'other', 'none'].includes(body.nationalIdType)) errors.push({ field: 'national_id_type', message: 'cni|passport|other|none' });
    if (!['wave', 'orange_money', 'free_money', 'other', 'none'].includes(body.mobileWalletProvider)) errors.push({ field: 'mobile_wallet_provider', message: 'wave|orange_money|free_money|other|none' });
    if (errors.length) {
      result.failed++;
      result.rows.push({ row: rowNo, status: 'error', farmerId: null, code: null, errors });
      continue;
    }
    try {
      const out = await db.transaction(async (tx) => {
        const idHash = body.nationalIdNumber ? piiHash(body.nationalIdNumber.replace(/\s+/g, '')) : null;
        const matchConds: SQL[] = [];
        if (body.phone) matchConds.push(eq(farmers.phone, body.phone));
        if (idHash) matchConds.push(eq(farmers.nationalIdHash, idHash));
        const [existing] = matchConds.length ? await tx.select().from(farmers).where(and(eq(farmers.ownerOrgId, orgId), or(...matchConds)!)) : [];
        const clean = { ...body, birthYear: body.birthYear as number | null, householdSize: body.householdSize as number | null, baselineIncomeXof: body.baselineIncomeXof as number | null };
        if (existing) {
          await updateFarmer(tx, actor, existing.id, existing.version, clean);
          return { status: 'updated' as const, id: existing.id, code: existing.code };
        }
        const id = await createFarmer(tx, actor, clean);
        const [f] = await tx.select({ code: farmers.code }).from(farmers).where(eq(farmers.id, id));
        return { status: 'created' as const, id, code: f!.code };
      });
      result[out.status]++;
      result.rows.push({ row: rowNo, status: out.status, farmerId: out.id, code: out.code, errors: [] });
    } catch (e) {
      result.failed++;
      result.rows.push({ row: rowNo, status: 'error', farmerId: null, code: null, errors: [{ field: '*', message: (e as Error).message }] });
    }
  }
  return result;
}
