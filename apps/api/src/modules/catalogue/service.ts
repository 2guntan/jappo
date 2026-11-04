import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client';
import { cropTemplates, cropVarieties, crops, marketPrices, serviceCatalog, zones, type TemplateInput } from './schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff } from '../../core/context';
import { audit } from '../../core/audit';
import { conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { assertVersion } from '../../core/etag';

const n = (v: string | null) => (v === null ? null : Number(v));
const isAdmin = (a: ActorContext) => a.orgType === 'platform' && a.roles.includes('platform_admin');

// ---------------------------------------------------------------- crops & zones

export async function listCrops(db: DbOrTx) {
  const cs = await db.select().from(crops).orderBy(asc(crops.code));
  const vs = await db.select().from(cropVarieties).orderBy(asc(cropVarieties.name));
  return cs.map((c) => ({ id: c.id, code: c.code, nameFr: c.nameFr, nameEn: c.nameEn, category: c.category, perishable: c.perishable, varieties: vs.filter((v) => v.cropId === c.id).map((v) => ({ id: v.id, name: v.name, cycleDays: v.cycleDays })) }));
}

export async function createCrop(db: Db, actor: ActorContext, body: typeof crops.$inferInsert) {
  if (!isAdmin(actor)) throw forbidden();
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(crops).values({ ...body, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'crop.created', resourceType: 'crop', resourceId: c!.id, after: body });
    return c!;
  });
}

export const listZones = async (db: DbOrTx) => (await db.select().from(zones).orderBy(asc(zones.code))).map((z) => ({ id: z.id, code: z.code, name: z.name, regionList: z.regionList }));

/** Agro-ecological zone for a region (zones.region_list), default `casamance`. */
export async function zoneForRegion(db: DbOrTx, region: string): Promise<string> {
  const rows = await db.select().from(zones);
  const r = region.trim().toLowerCase();
  return rows.find((z) => z.regionList.some((x) => x.toLowerCase() === r))?.code ?? rows[0]?.code ?? 'casamance';
}

// ---------------------------------------------------------------- templates

type TemplateRow = typeof cropTemplates.$inferSelect;
export function templateDto(t: TemplateRow, cropCode: string) {
  return {
    id: t.id,
    ownerOrgId: t.ownerOrgId,
    isOverride: t.ownerOrgId !== null,
    baseTemplateId: t.baseTemplateId,
    cropId: t.cropId,
    cropCode,
    varietyId: t.varietyId,
    zone: t.zone,
    irrigated: t.irrigated,
    cycleDays: t.cycleDays,
    yieldBaseTHa: Number(t.yieldBaseTHa),
    yieldStressTHa: Number(t.yieldStressTHa),
    postHarvestLossPct: Number(t.postHarvestLossPct),
    deliveryRatePct: Number(t.deliveryRatePct),
    waterM3Ha: n(t.waterM3Ha),
    labourDaysHa: n(t.labourDaysHa),
    inputs: t.inputs,
    notes: t.notes,
    version: t.version,
  };
}

/** Effective templates: operator overrides replace platform templates for the same crop/zone/irrigation (SPEC §7.5). */
export async function listTemplates(db: DbOrTx, actor: ActorContext, f: { cropId?: string; zone?: string; irrigated?: boolean }) {
  const conds: SQL[] = [actor.orgId && !isPlatformStaff(actor) ? or(isNull(cropTemplates.ownerOrgId), eq(cropTemplates.ownerOrgId, actor.orgId))! : isNull(cropTemplates.ownerOrgId)];
  if (f.cropId) conds.push(eq(cropTemplates.cropId, f.cropId));
  if (f.zone) conds.push(eq(cropTemplates.zone, f.zone));
  if (f.irrigated !== undefined) conds.push(eq(cropTemplates.irrigated, f.irrigated));
  const rows = await db.select({ t: cropTemplates, code: crops.code }).from(cropTemplates).innerJoin(crops, eq(crops.id, cropTemplates.cropId)).where(and(...conds)).orderBy(asc(crops.code), asc(cropTemplates.zone), desc(cropTemplates.irrigated));
  const overridden = new Set(rows.filter((r) => r.t.ownerOrgId).map((r) => `${r.t.cropId}|${r.t.zone}|${r.t.irrigated}|${r.t.varietyId ?? ''}`));
  return rows.filter((r) => r.t.ownerOrgId || !overridden.has(`${r.t.cropId}|${r.t.zone}|${r.t.irrigated}|${r.t.varietyId ?? ''}`)).map((r) => templateDto(r.t, r.code));
}

export async function resolveTemplate(db: DbOrTx, orgId: string, cropId: string, zone: string, irrigated: boolean): Promise<TemplateRow | null> {
  const rows = await db
    .select()
    .from(cropTemplates)
    .where(and(eq(cropTemplates.cropId, cropId), or(isNull(cropTemplates.ownerOrgId), eq(cropTemplates.ownerOrgId, orgId)), isNull(cropTemplates.varietyId)));
  const score = (t: TemplateRow) => (t.ownerOrgId ? 4 : 0) + (t.zone === zone ? 2 : 0) + (t.irrigated === irrigated ? 1 : 0);
  const best = rows.filter((t) => t.zone === zone || rows.every((x) => x.zone !== zone)).sort((a, b) => score(b) - score(a))[0];
  return best ?? null;
}

export async function getTemplate(db: DbOrTx, id: string): Promise<TemplateRow> {
  const [t] = await db.select().from(cropTemplates).where(eq(cropTemplates.id, id));
  if (!t) throw notFound('Crop template');
  return t;
}

type TemplateBody = { cropId: string; zone: string; irrigated: boolean; cycleDays: number; yieldBaseTHa: number; yieldStressTHa: number; postHarvestLossPct: number; varietyId?: string | null; deliveryRatePct?: number; waterM3Ha?: number | null; labourDaysHa?: number | null; inputs?: TemplateInput[]; notes?: string | null };

const numericCols = (b: Partial<TemplateBody>) => ({
  ...(b.yieldBaseTHa !== undefined ? { yieldBaseTHa: String(b.yieldBaseTHa) } : {}),
  ...(b.yieldStressTHa !== undefined ? { yieldStressTHa: String(b.yieldStressTHa) } : {}),
  ...(b.postHarvestLossPct !== undefined ? { postHarvestLossPct: String(b.postHarvestLossPct) } : {}),
  ...(b.deliveryRatePct !== undefined ? { deliveryRatePct: String(b.deliveryRatePct) } : {}),
  ...(b.waterM3Ha !== undefined ? { waterM3Ha: b.waterM3Ha === null ? null : String(b.waterM3Ha) } : {}),
  ...(b.labourDaysHa !== undefined ? { labourDaysHa: b.labourDaysHa === null ? null : String(b.labourDaysHa) } : {}),
});

async function assertInputs(db: DbOrTx, actor: ActorContext, inputs: TemplateInput[] | undefined) {
  if (!inputs?.length) return;
  const ids = [...new Set(inputs.map((i) => i.serviceId))];
  const found = await db.select({ id: serviceCatalog.id }).from(serviceCatalog).where(and(inArray(serviceCatalog.id, ids), or(isNull(serviceCatalog.ownerOrgId), eq(serviceCatalog.ownerOrgId, actor.orgId ?? sql`null`))));
  if (found.length !== ids.length) throw unprocessable('SERVICE_NOT_FOUND', 'A template input references an unknown service');
}

/** Platform admins create platform defaults; operators create overrides for their organisation. */
export async function createTemplate(db: Db, actor: ActorContext, body: TemplateBody) {
  if (body.yieldStressTHa > body.yieldBaseTHa) throw unprocessable('STRESS_ABOVE_BASE', 'Stress yield cannot exceed base yield');
  const owner = isAdmin(actor) ? null : actor.orgId;
  if (!isAdmin(actor) && actor.orgType !== 'operator') throw forbidden('OPERATOR_ONLY');
  await assertInputs(db, actor, body.inputs);
  return db.transaction(async (tx) => {
    const [base] = owner ? await tx.select({ id: cropTemplates.id }).from(cropTemplates).where(and(isNull(cropTemplates.ownerOrgId), eq(cropTemplates.cropId, body.cropId), eq(cropTemplates.zone, body.zone), eq(cropTemplates.irrigated, body.irrigated))) : [];
    const [t] = await tx
      .insert(cropTemplates)
      .values({ cropId: body.cropId, zone: body.zone, irrigated: body.irrigated, cycleDays: body.cycleDays, varietyId: body.varietyId ?? null, inputs: body.inputs ?? [], notes: body.notes ?? null, ...numericCols(body), yieldBaseTHa: String(body.yieldBaseTHa), yieldStressTHa: String(body.yieldStressTHa), postHarvestLossPct: String(body.postHarvestLossPct), ownerOrgId: owner, baseTemplateId: base?.id ?? null, createdBy: actorUserId(actor) })
      .returning();
    await audit(tx, actor, { action: 'crop_template.created', resourceType: 'crop_template', resourceId: t!.id, after: { cropId: body.cropId, zone: body.zone, override: !!owner } });
    return t!.id;
  });
}

export async function updateTemplate(db: Db, actor: ActorContext, id: string, expected: number, body: Partial<TemplateBody>) {
  return db.transaction(async (tx) => {
    const t = await getTemplate(tx, id);
    const allowed = t.ownerOrgId === null ? isAdmin(actor) : t.ownerOrgId === actor.orgId;
    if (!allowed) throw t.ownerOrgId === null ? forbidden('PLATFORM_TEMPLATE', 'Create an override to change a platform template') : notFound('Crop template');
    assertVersion(expected, t.version);
    await assertInputs(tx, actor, body.inputs);
    const yb = body.yieldBaseTHa ?? Number(t.yieldBaseTHa);
    const ys = body.yieldStressTHa ?? Number(t.yieldStressTHa);
    if (ys > yb) throw unprocessable('STRESS_ABOVE_BASE', 'Stress yield cannot exceed base yield');
    await tx.update(cropTemplates).set({ ...numericCols(body), ...(body.cycleDays !== undefined ? { cycleDays: body.cycleDays } : {}), ...(body.inputs ? { inputs: body.inputs } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}), ...(body.varietyId !== undefined ? { varietyId: body.varietyId } : {}), version: t.version + 1 }).where(eq(cropTemplates.id, id));
    await audit(tx, actor, { action: 'crop_template.updated', resourceType: 'crop_template', resourceId: id, after: body });
  });
}

export async function templateOut(db: DbOrTx, id: string) {
  const t = await getTemplate(db, id);
  const [c] = await db.select({ code: crops.code }).from(crops).where(eq(crops.id, t.cropId));
  return templateDto(t, c!.code);
}

// ---------------------------------------------------------------- services

type ServiceRow = typeof serviceCatalog.$inferSelect;
export const serviceDto = (s: ServiceRow) => ({ id: s.id, ownerOrgId: s.ownerOrgId, code: s.code, nameFr: s.nameFr, nameEn: s.nameEn, kind: s.kind, unit: s.unit, defaultUnitPriceXof: s.defaultUnitPriceXof, active: s.active, version: s.version });

export async function listServices(db: DbOrTx, actor: ActorContext, kind?: string) {
  const conds: SQL[] = [actor.orgId && !isPlatformStaff(actor) ? or(isNull(serviceCatalog.ownerOrgId), eq(serviceCatalog.ownerOrgId, actor.orgId))! : isNull(serviceCatalog.ownerOrgId)];
  if (kind) conds.push(eq(serviceCatalog.kind, kind as ServiceRow['kind']));
  return (await db.select().from(serviceCatalog).where(and(...conds)).orderBy(asc(serviceCatalog.kind), asc(serviceCatalog.code))).map(serviceDto);
}

export async function getVisibleService(db: DbOrTx, actor: ActorContext, id: string): Promise<ServiceRow> {
  const [s] = await db.select().from(serviceCatalog).where(and(eq(serviceCatalog.id, id), or(isNull(serviceCatalog.ownerOrgId), eq(serviceCatalog.ownerOrgId, actor.orgId ?? sql`null`))));
  if (!s) throw notFound('Service');
  return s;
}

export async function createService(db: Db, actor: ActorContext, body: Omit<typeof serviceCatalog.$inferInsert, 'ownerOrgId'>) {
  const owner = isAdmin(actor) ? null : actor.orgId;
  if (!isAdmin(actor) && actor.orgType !== 'operator') throw forbidden('OPERATOR_ONLY');
  return db.transaction(async (tx) => {
    const dup = await tx.select({ id: serviceCatalog.id }).from(serviceCatalog).where(and(eq(serviceCatalog.code, body.code), owner ? eq(serviceCatalog.ownerOrgId, owner) : isNull(serviceCatalog.ownerOrgId)));
    if (dup.length) throw conflict('SERVICE_CODE_TAKEN', `Service code ${body.code} already exists`);
    const [s] = await tx.insert(serviceCatalog).values({ ...body, ownerOrgId: owner, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'service.created', resourceType: 'service', resourceId: s!.id, after: body });
    return serviceDto(s!);
  });
}

export async function updateService(db: Db, actor: ActorContext, id: string, expected: number, body: Partial<typeof serviceCatalog.$inferInsert>) {
  return db.transaction(async (tx) => {
    const s = await getVisibleService(tx, actor, id);
    if (s.ownerOrgId === null ? !isAdmin(actor) : s.ownerOrgId !== actor.orgId) throw forbidden('PLATFORM_SERVICE', 'Platform services are managed by the platform admin');
    assertVersion(expected, s.version);
    const [after] = await tx.update(serviceCatalog).set({ ...body, version: s.version + 1 }).where(eq(serviceCatalog.id, id)).returning();
    await audit(tx, actor, { action: 'service.updated', resourceType: 'service', resourceId: id, after: body });
    return serviceDto(after!);
  });
}

// ---------------------------------------------------------------- market prices

export async function listMarketPrices(db: DbOrTx, cropId?: string) {
  const rows = await db.select().from(marketPrices).where(cropId ? eq(marketPrices.cropId, cropId) : undefined).orderBy(desc(marketPrices.date)).limit(500);
  return rows.map((m) => ({ id: m.id, cropId: m.cropId, market: m.market, date: m.date, priceXofPerKg: m.priceXofPerKg, source: m.source }));
}

export async function createMarketPrice(db: Db, actor: ActorContext, body: typeof marketPrices.$inferInsert) {
  if (!isAdmin(actor)) throw forbidden();
  return db.transaction(async (tx) => {
    const [m] = await tx.insert(marketPrices).values({ ...body, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'market_price.created', resourceType: 'market_price', resourceId: m!.id, after: body });
    return { id: m!.id, cropId: m!.cropId, market: m!.market, date: m!.date, priceXofPerKg: m!.priceXofPerKg, source: m!.source };
  });
}

export async function latestMarketPrice(db: DbOrTx, cropId: string): Promise<number | null> {
  const [m] = await db.select({ p: marketPrices.priceXofPerKg }).from(marketPrices).where(eq(marketPrices.cropId, cropId)).orderBy(desc(marketPrices.date)).limit(1);
  return m?.p ?? null;
}
