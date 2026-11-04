import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DEFAULT_ALERT_RULES, evaluateAlertRules, expectedKgByFarmer, type AlertCandidate, type AlertRuleCode, type AlertRuleConfig, type AlertSnapshot } from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { alertRules, alerts, fieldVisits, serviceDeliveries } from './schema';
import { harvestDeliveries, buyerInvoices } from '../harvest/schema';
import { blocks, communityGrievances, landDocuments, plotAllocations, plots } from '../land/schema';
import { budgetLines, plantings, seasons } from '../planning/schema';
import { serviceCatalog, crops } from '../catalogue/schema';
import { farmers } from '../farmers/schema';
import { disbursements, facilities, scheduleLines } from '../facilities/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, systemActor } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { geomFromGeoJson, asGeoJson } from '../../core/geo';
import { notifyOrgRoles } from '../../core/notify';
import { consumeOtp, createOtp } from '../identity/service';
import { getVisibleFile } from '../files/service';
import { loadBlock, loadPlot } from '../land/service';
import { env } from '../../env';

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const link = (path: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}${path}`;
type Point = { type: 'Point'; coordinates: number[] } | null | undefined;
const geo = (g: Point) => (g ? (geomFromGeoJson(g) as unknown as string) : null);

async function loadSeason(db: DbOrTx, actor: ActorContext, seasonId: string, write = false) {
  const [s] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!s) throw notFound('Season');
  const b = await loadBlock(db, actor, s.blockId, write);
  return { s, b };
}

// ---------------------------------------------------------------- farmer acknowledgement codes

/** Send an SMS acknowledgement code to a farmer (service or harvest delivery signed by OTP). */
export async function requestAckCode(db: Db, actor: ActorContext, farmerId: string) {
  const [f] = await db.select().from(farmers).where(eq(farmers.id, farmerId));
  if (!f || f.ownerOrgId !== actor.orgId) throw notFound('Farmer');
  if (!f.phone) throw unprocessable('FARMER_PHONE_MISSING', 'The farmer has no phone number: use a signature photo');
  await db.transaction((tx) => createOtp(tx, f.phone!, 'delivery_ack', f.locale, { type: 'farmer', id: f.id, orgId: f.ownerOrgId }, f.id));
  return { destination: `**** ${f.phone.slice(-4)}` };
}

export async function verifyAck(db: Db, actor: ActorContext, farmerId: string | null, method: 'otp' | 'signature_photo' | 'none', code?: string, photoFileId?: string | null) {
  if (method === 'none') return null;
  if (!farmerId) throw badRequest('VALIDATION_FAILED', 'A farmer is required for an acknowledgement', [{ path: 'body.farmerId', message: 'required' }]);
  if (method === 'signature_photo') {
    if (!photoFileId) throw badRequest('VALIDATION_FAILED', 'A signature photo is required', [{ path: 'body.photoFileId', message: 'required' }]);
    await getVisibleFile(db, actor, photoFileId);
    return new Date();
  }
  if (!code) throw badRequest('VALIDATION_FAILED', 'ackCode is required', [{ path: 'body.ackCode', message: 'required' }]);
  const [f] = await db.select({ phone: farmers.phone }).from(farmers).where(eq(farmers.id, farmerId));
  if (!f?.phone) throw unprocessable('FARMER_PHONE_MISSING', 'The farmer has no phone number');
  await consumeOtp(db, f.phone, 'delivery_ack', code, farmerId);
  return new Date();
}

// ---------------------------------------------------------------- service deliveries

type DeliveryRow = typeof serviceDeliveries.$inferSelect;
export const serviceDeliveryDto = (d: DeliveryRow & { geoJson?: unknown }, label = '') => ({
  id: d.id,
  seasonId: d.seasonId,
  budgetLineId: d.budgetLineId,
  serviceLabel: label,
  plotId: d.plotId,
  farmerId: d.farmerId,
  qty: Number(d.qty),
  unit: d.unit,
  deliveredAt: d.deliveredAt.toISOString(),
  supplierName: d.supplierName,
  deliveredByUserId: d.deliveredByUserId,
  photoFileId: d.photoFileId,
  farmerAckMethod: d.farmerAckMethod,
  farmerAckAt: iso(d.farmerAckAt),
  createdAt: d.createdAt.toISOString(),
});

export async function listServiceDeliveries(db: DbOrTx, actor: ActorContext, seasonId: string) {
  const { s } = await loadSeason(db, actor, seasonId);
  const rows = await db
    .select({ d: serviceDeliveries, fr: serviceCatalog.nameFr, en: serviceCatalog.nameEn })
    .from(serviceDeliveries)
    .innerJoin(budgetLines, eq(budgetLines.id, serviceDeliveries.budgetLineId))
    .innerJoin(serviceCatalog, eq(serviceCatalog.id, budgetLines.serviceId))
    .where(eq(serviceDeliveries.seasonId, s.id))
    .orderBy(desc(serviceDeliveries.deliveredAt));
  return rows.map((r) => serviceDeliveryDto(r.d, r.fr));
}

export interface ServiceDeliveryBody {
  budgetLineId: string;
  plotId?: string | null;
  farmerId?: string | null;
  qty: number;
  deliveredAt?: string;
  supplierName?: string | null;
  photoFileId?: string | null;
  farmerAckMethod?: 'otp' | 'signature_photo' | 'none';
  ackCode?: string;
  geo?: Point;
  offlineClientId?: string | null;
}

export async function createServiceDelivery(db: Db, actor: ActorContext, seasonId: string, body: ServiceDeliveryBody) {
  const { s } = await loadSeason(db, actor, seasonId, true);
  if (body.offlineClientId) {
    const [dup] = await db.select().from(serviceDeliveries).where(and(eq(serviceDeliveries.ownerOrgId, s.ownerOrgId), eq(serviceDeliveries.offlineClientId, body.offlineClientId)));
    if (dup) return serviceDeliveryDto(dup);
  }
  const [bl] = await db.select().from(budgetLines).where(and(eq(budgetLines.id, body.budgetLineId), eq(budgetLines.seasonId, s.id)));
  if (!bl) throw unprocessable('BUDGET_LINE_INVALID', 'The budget line does not belong to this season', [{ path: 'body.budgetLineId', message: 'invalid' }]);
  const plotId = body.plotId ?? bl.plotId ?? null;
  if (plotId) {
    const [p] = await db.select({ id: plots.id }).from(plots).where(and(eq(plots.id, plotId), eq(plots.blockId, s.blockId)));
    if (!p) throw unprocessable('PLOT_NOT_IN_BLOCK', 'The plot is not in this block');
  }
  if (body.farmerId) {
    const [a] = await db.select({ id: plotAllocations.id }).from(plotAllocations).where(and(eq(plotAllocations.farmerId, body.farmerId), eq(plotAllocations.blockId, s.blockId), eq(plotAllocations.status, 'active'))).limit(1);
    if (!a) throw unprocessable('FARMER_NOT_IN_BLOCK', 'The farmer has no active allocation on this block');
  }
  const method = body.farmerAckMethod ?? 'none';
  const ackAt = await verifyAck(db, actor, body.farmerId ?? null, method, body.ackCode, body.photoFileId);
  if (body.photoFileId && method !== 'signature_photo') await getVisibleFile(db, actor, body.photoFileId);
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(serviceDeliveries)
      .values({
        ownerOrgId: s.ownerOrgId,
        blockId: s.blockId,
        seasonId: s.id,
        budgetLineId: bl.id,
        plotId,
        farmerId: body.farmerId ?? null,
        qty: String(body.qty),
        unit: bl.unit,
        deliveredAt: body.deliveredAt ? new Date(body.deliveredAt) : new Date(),
        supplierName: body.supplierName ?? null,
        deliveredByUserId: actorUserId(actor),
        photoFileId: body.photoFileId ?? null,
        farmerAckMethod: method,
        farmerAckAt: ackAt,
        geo: geo(body.geo),
        offlineClientId: body.offlineClientId ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    await audit(tx, actor, { action: 'service_delivery.recorded', resourceType: 'service_delivery', resourceId: d!.id, after: { budgetLineId: bl.id, qty: body.qty, ack: method } });
    await emit(tx, actor, 'service_delivery.recorded', { type: 'service_delivery', id: d!.id }, { seasonId: s.id, blockId: s.blockId, budgetLineId: bl.id }, s.ownerOrgId);
    return serviceDeliveryDto(d!);
  });
}

// ---------------------------------------------------------------- field visits

type VisitRow = typeof fieldVisits.$inferSelect;
export const visitDto = (v: VisitRow, geoJson: unknown = null) => ({
  id: v.id,
  plotId: v.plotId,
  plantingId: v.plantingId,
  agentUserId: v.agentUserId,
  visitedAt: v.visitedAt.toISOString(),
  geo: (geoJson as { type: 'Point'; coordinates: [number, number, ...number[]] } | null) ?? null,
  cropStage: v.cropStage,
  healthScore: v.healthScore,
  estimatedYieldTHa: v.estimatedYieldTHa === null ? null : Number(v.estimatedYieldTHa),
  issues: v.issues,
  notes: v.notes,
  photoFileIds: v.photoFileIds,
  createdAt: v.createdAt.toISOString(),
});

export async function listVisits(db: DbOrTx, actor: ActorContext, plotId: string) {
  const { p } = await loadPlot(db, actor, plotId);
  const rows = await db.select({ v: fieldVisits, g: asGeoJson(fieldVisits.geo) }).from(fieldVisits).where(eq(fieldVisits.plotId, p.id)).orderBy(desc(fieldVisits.visitedAt)).limit(200);
  return rows.map((r) => visitDto(r.v, r.g));
}

export interface VisitBody {
  visitedAt?: string;
  geo?: Point;
  cropStage: VisitRow['cropStage'];
  healthScore: number;
  estimatedYieldTHa?: number | null;
  issues?: string[];
  notes?: string | null;
  photoFileIds?: string[];
  offlineClientId?: string | null;
}

export async function createVisit(db: Db, actor: ActorContext, plotId: string, body: VisitBody) {
  const { p } = await loadPlot(db, actor, plotId, true);
  if (body.offlineClientId) {
    const [dup] = await db.select().from(fieldVisits).where(and(eq(fieldVisits.ownerOrgId, p.ownerOrgId), eq(fieldVisits.offlineClientId, body.offlineClientId)));
    if (dup) return visitDto(dup);
  }
  for (const f of body.photoFileIds ?? []) await getVisibleFile(db, actor, f);
  const [pl] = await db
    .select({ id: plantings.id })
    .from(plantings)
    .innerJoin(seasons, eq(seasons.id, plantings.seasonId))
    .where(and(eq(plantings.plotId, p.id), inArray(seasons.status, ['in_progress', 'financing', 'planning'])))
    .orderBy(desc(seasons.startDate))
    .limit(1);
  const v = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(fieldVisits)
      .values({
        ownerOrgId: p.ownerOrgId,
        blockId: p.blockId,
        plotId: p.id,
        plantingId: pl?.id ?? null,
        agentUserId: actorUserId(actor),
        visitedAt: body.visitedAt ? new Date(body.visitedAt) : new Date(),
        geo: geo(body.geo),
        cropStage: body.cropStage,
        healthScore: body.healthScore,
        estimatedYieldTHa: body.estimatedYieldTHa === null || body.estimatedYieldTHa === undefined ? null : String(body.estimatedYieldTHa),
        issues: body.issues ?? [],
        notes: body.notes ?? null,
        photoFileIds: body.photoFileIds ?? [],
        offlineClientId: body.offlineClientId ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    await audit(tx, actor, { action: 'visit.recorded', resourceType: 'field_visit', resourceId: row!.id, after: { plotId: p.id, healthScore: body.healthScore, cropStage: body.cropStage } });
    await emit(tx, actor, 'visit.recorded', { type: 'field_visit', id: row!.id }, { plotId: p.id, blockId: p.blockId, healthScore: body.healthScore }, p.ownerOrgId);
    return row!;
  });
  await runAlertsForBlock(db, p.blockId); // HEALTH_LOW / YIELD_FORECAST_DROP react immediately (SPEC §9.8 "on relevant events")
  return visitDto(v);
}

// ---------------------------------------------------------------- alerts

type AlertRow = typeof alerts.$inferSelect;
export const alertDto = (a: AlertRow) => ({
  id: a.id,
  blockId: a.blockId,
  seasonId: a.seasonId,
  type: a.type,
  severity: a.severity,
  source: a.source,
  ruleCode: a.ruleCode,
  message: a.message,
  data: a.data as Record<string, unknown>,
  status: a.status,
  acknowledgedBy: a.acknowledgedBy,
  acknowledgedAt: iso(a.acknowledgedAt),
  resolvedAt: iso(a.resolvedAt),
  resolutionNote: a.resolutionNote,
  createdAt: a.createdAt.toISOString(),
  version: a.version,
});

export async function listAlerts(db: DbOrTx, actor: ActorContext, blockId: string, status?: string) {
  const b = await loadBlock(db, actor, blockId);
  const conds = [eq(alerts.blockId, b.id)];
  if (status) conds.push(eq(alerts.status, status as AlertRow['status']));
  const rows = await db.select().from(alerts).where(and(...conds)).orderBy(sql`case ${alerts.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`, desc(alerts.createdAt)).limit(500);
  return rows.map(alertDto);
}

export async function createManualAlert(db: Db, actor: ActorContext, blockId: string, body: { severity: AlertRow['severity']; type: string; message: string; seasonId?: string | null }) {
  const b = await loadBlock(db, actor, blockId, true);
  return db.transaction(async (tx) => {
    const [a] = await tx.insert(alerts).values({ blockId: b.id, ownerOrgId: b.ownerOrgId, seasonId: body.seasonId ?? null, type: body.type, severity: body.severity, source: 'manual', message: body.message, data: {}, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'alert.created', resourceType: 'alert', resourceId: a!.id, after: body });
    await notifyAlert(tx, b, a!);
    return alertDto(a!);
  });
}

export async function actOnAlert(db: Db, actor: ActorContext, id: string, action: 'acknowledge' | 'resolve', note?: string) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(alerts).where(eq(alerts.id, id)).for('update');
    if (!a) throw notFound('Alert');
    await loadBlock(tx, actor, a.blockId, true);
    if (a.status === 'resolved') throw conflict('ALERT_RESOLVED', 'The alert is already resolved');
    if (action === 'acknowledge' && a.status !== 'open') throw conflict('ALERT_NOT_OPEN', 'Only open alerts can be acknowledged');
    if (action === 'resolve' && !note?.trim()) throw badRequest('VALIDATION_FAILED', 'A resolution note is required', [{ path: 'body.note', message: 'required' }]);
    const now = new Date();
    const patch = action === 'acknowledge' ? { status: 'acknowledged' as const, acknowledgedBy: actorUserId(actor), acknowledgedAt: now } : { status: 'resolved' as const, resolvedBy: actorUserId(actor), resolvedAt: now, resolutionNote: note!.trim() };
    const [u] = await tx.update(alerts).set({ ...patch, version: a.version + 1 }).where(eq(alerts.id, id)).returning();
    await audit(tx, actor, { action: `alert.${action === 'acknowledge' ? 'acknowledged' : 'resolved'}`, resourceType: 'alert', resourceId: id, after: { note } });
    return alertDto(u!);
  });
}

export async function listAlertRules(db: DbOrTx) {
  const rows = await db.select().from(alertRules).orderBy(asc(alertRules.code));
  return rows.map((r) => ({ code: r.code, enabled: r.enabled, params: r.params, description: r.description, version: r.version }));
}

export async function updateAlertRule(db: Db, actor: ActorContext, code: string, body: { enabled?: boolean; params?: Record<string, number> }) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(alertRules).where(eq(alertRules.code, code)).for('update');
    if (!r) throw notFound('Alert rule');
    const def = DEFAULT_ALERT_RULES.find((d) => d.code === code)!;
    const unknown = Object.keys(body.params ?? {}).filter((k) => !(k in def.params));
    if (unknown.length) throw badRequest('VALIDATION_FAILED', `Unknown parameter(s): ${unknown.join(', ')}`, unknown.map((k) => ({ path: `body.params.${k}`, message: 'unknown' })));
    const [u] = await tx.update(alertRules).set({ enabled: body.enabled ?? r.enabled, params: { ...r.params, ...(body.params ?? {}) }, version: r.version + 1 }).where(eq(alertRules.id, r.id)).returning();
    await audit(tx, actor, { action: 'alert_rule.updated', resourceType: 'alert_rule', resourceId: r.id, before: { enabled: r.enabled, params: r.params }, after: { enabled: u!.enabled, params: u!.params } });
    return { code: u!.code, enabled: u!.enabled, params: u!.params, description: u!.description, version: u!.version };
  });
}

async function notifyAlert(tx: DbOrTx, b: typeof blocks.$inferSelect, a: AlertRow) {
  const channels: ('in_app' | 'email' | 'sms')[] = a.severity === 'critical' ? ['in_app', 'email', 'sms'] : ['in_app', 'email'];
  const data = { blockRef: b.ref, blockName: b.name, severity: a.severity, message: a.message, link: link(`/app/blocks/${b.id}?tab=alerts`) };
  await notifyOrgRoles(tx, b.ownerOrgId, ['operator_manager'], { channels, templateCode: 'alert.raised', data, link: `/app/blocks/${b.id}?tab=alerts` });
  const lenders = await tx.selectDistinct({ id: facilities.lenderOrgId }).from(facilities).where(and(eq(facilities.blockId, b.id), inArray(facilities.status, ['active', 'in_arrears', 'restructured'])));
  for (const l of lenders) await notifyOrgRoles(tx, l.id, ['credit_officer'], { channels, templateCode: 'alert.raised', data, link: `/app/blocks/${b.id}?tab=alerts` });
}

const daysAgoIso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

/** Build the rules snapshot for one block (SPEC §9.8). */
export async function alertSnapshot(db: DbOrTx, blockId: string, asOf: string): Promise<AlertSnapshot | null> {
  const [b] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!b || b.status === 'archived') return null;
  const [season] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.blockId, b.id), notInArray(seasons.status, ['cancelled'])))
    .orderBy(sql`case ${seasons.status} when 'in_progress' then 0 else 1 end`, desc(seasons.startDate))
    .limit(1);
  const pls = season ? await db.select({ p: plantings, code: plots.code, cropFr: crops.nameFr }).from(plantings).innerJoin(plots, eq(plots.id, plantings.plotId)).innerJoin(crops, eq(crops.id, plantings.cropId)).where(eq(plantings.seasonId, season.id)) : [];
  const plotIds = [...new Set(pls.map((x) => x.p.plotId))];
  const visits = plotIds.length ? await db.select().from(fieldVisits).where(inArray(fieldVisits.plotId, plotIds)).orderBy(desc(fieldVisits.visitedAt)) : [];
  const lastByPlot = new Map<string, VisitRow>();
  for (const v of visits) if (!lastByPlot.has(v.plotId)) lastByPlot.set(v.plotId, v);
  const codeOf = new Map(pls.map((x) => [x.p.plotId, x.code]));
  const yieldByCrop = new Map<string, { cropName: string; base: number[]; plotIds: Set<string> }>();
  for (const x of pls) {
    const e = yieldByCrop.get(x.p.cropId) ?? { cropName: x.cropFr, base: [], plotIds: new Set<string>() };
    if (x.p.yieldBaseTHa !== null) e.base.push(Number(x.p.yieldBaseTHa));
    e.plotIds.add(x.p.plotId);
    yieldByCrop.set(x.p.cropId, e);
  }
  const lines = season ? await db.select({ bl: budgetLines, name: serviceCatalog.nameFr }).from(budgetLines).innerJoin(serviceCatalog, eq(serviceCatalog.id, budgetLines.serviceId)).where(eq(budgetLines.seasonId, season.id)) : [];
  const delivered = season ? new Set((await db.selectDistinct({ id: serviceDeliveries.budgetLineId }).from(serviceDeliveries).where(eq(serviceDeliveries.seasonId, season.id))).map((r) => r.id)) : new Set<string>();
  const facs = await db.select().from(facilities).where(eq(facilities.blockId, b.id));
  const facIds = facs.map((f) => f.id);
  const dsb = facIds.length ? await db.select().from(disbursements).where(inArray(disbursements.facilityId, facIds)) : [];
  const sl = facIds.length ? await db.select().from(scheduleLines).where(and(inArray(scheduleLines.facilityId, facIds), notInArray(scheduleLines.status, ['paid']))) : [];
  const allocs = await db.select().from(plotAllocations).where(and(eq(plotAllocations.blockId, b.id), eq(plotAllocations.status, 'active')));
  const expected = expectedKgByFarmer(
    pls.map((x) => ({ plotId: x.p.plotId, areaHa: Number(x.p.areaHa), yieldBaseTHa: x.p.yieldBaseTHa === null ? null : Number(x.p.yieldBaseTHa), postHarvestLossPct: x.p.postHarvestLossPct === null ? null : Number(x.p.postHarvestLossPct), deliveryRatePct: x.p.deliveryRatePct === null ? null : Number(x.p.deliveryRatePct) })),
    allocs.map((a) => ({ plotId: a.plotId, farmerId: a.farmerId, sharePct: Number(a.sharePct) })),
  );
  const deliveredKg = season
    ? new Map((await db.select({ farmerId: harvestDeliveries.farmerId, kg: sql<string>`sum(${harvestDeliveries.netKg})` }).from(harvestDeliveries).where(and(eq(harvestDeliveries.seasonId, season.id), notInArray(harvestDeliveries.status, ['void']))).groupBy(harvestDeliveries.farmerId)).map((r) => [r.farmerId, Number(r.kg)]))
    : new Map<string, number>();
  const fCodes = expected.size ? await db.select({ id: farmers.id, code: farmers.code }).from(farmers).where(inArray(farmers.id, [...expected.keys()])) : [];
  const invs = await db.select().from(buyerInvoices).where(eq(buyerInvoices.blockId, b.id));
  const docs = await db.select().from(landDocuments).where(and(eq(landDocuments.blockId, b.id), eq(landDocuments.status, 'verified')));
  const grs = await db.select().from(communityGrievances).where(eq(communityGrievances.blockId, b.id));
  return {
    blockId: b.id,
    asOf,
    season: season ? { id: season.id, status: season.status, endDate: season.endDate } : null,
    plantedPlots: plotIds.map((id) => ({ plotId: id, plotCode: codeOf.get(id) ?? '', plantedSince: season?.startedAt ? daysAgoIso(season.startedAt) : (season?.startDate ?? asOf), lastVisitAt: lastByPlot.get(id) ? daysAgoIso(lastByPlot.get(id)!.visitedAt) : null })),
    lastVisits: [...lastByPlot.values()].map((v) => ({ plotId: v.plotId, plotCode: codeOf.get(v.plotId) ?? '', visitId: v.id, healthScore: v.healthScore })),
    yieldForecasts: [...yieldByCrop.entries()].map(([cropId, e]) => ({
      cropId,
      cropName: e.cropName,
      baseYieldTHa: e.base.length ? e.base.reduce((x, y) => x + y, 0) / e.base.length : 0,
      recentEstimatesTHa: visits.filter((v) => e.plotIds.has(v.plotId) && v.estimatedYieldTHa !== null).map((v) => Number(v.estimatedYieldTHa)),
    })),
    budgetLines: lines.map((l) => ({ id: l.bl.id, label: l.name, plannedDate: l.bl.plannedDate, delivered: delivered.has(l.bl.id) })),
    disbursements: dsb.map((d) => ({ id: d.id, ref: d.ref, status: d.status, approvedAt: iso(d.approvedAt) })),
    farmerDeliveries: [...expected.entries()].map(([farmerId, kg]) => ({ farmerId, farmerCode: fCodes.find((f) => f.id === farmerId)?.code ?? '', expectedKg: kg, deliveredKg: deliveredKg.get(farmerId) ?? 0 })),
    buyerInvoices: invs.map((i) => ({ id: i.id, ref: i.ref, dueDate: i.dueDate, status: i.status, outstandingXof: i.amountXof - i.paidXof })),
    scheduleLines: sl.map((l) => ({ facilityId: l.facilityId, facilityRef: facs.find((f) => f.id === l.facilityId)?.ref ?? '', seq: l.seq, dueDate: l.dueDate, outstandingXof: l.totalXof - l.paidXof })),
    landDocuments: docs.map((d) => ({ id: d.id, docType: d.docType, expiresAt: d.expiryDate })),
    grievances: grs.map((g) => ({ id: g.id, openedAt: daysAgoIso(g.reportedAt ?? g.createdAt), status: g.status, category: g.category })),
  };
}

async function ruleConfigs(db: DbOrTx): Promise<AlertRuleConfig[]> {
  const rows = await db.select().from(alertRules);
  return DEFAULT_ALERT_RULES.map((d) => {
    const r = rows.find((x) => x.code === d.code);
    return r ? { code: d.code, enabled: r.enabled, params: { ...d.params, ...r.params } } : d;
  });
}

/**
 * Evaluate rules for one block: new candidates are raised (one open alert per dedupe key), rule alerts whose
 * condition no longer holds are auto-resolved.
 */
export async function runAlertsForBlock(db: Db, blockId: string, asOf = new Date().toISOString().slice(0, 10)): Promise<{ raised: number; resolved: number }> {
  const snap = await alertSnapshot(db, blockId, asOf);
  if (!snap) return { raised: 0, resolved: 0 };
  const candidates = evaluateAlertRules(snap, await ruleConfigs(db));
  const actor = systemActor('alerts');
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(blocks).where(eq(blocks.id, blockId)).for('update');
    const open = await tx.select().from(alerts).where(and(eq(alerts.blockId, blockId), eq(alerts.source, 'rule'), inArray(alerts.status, ['open', 'acknowledged'])));
    const openKeys = new Set(open.map((a) => a.dedupeKey));
    const keys = new Set(candidates.map((c) => c.dedupeKey));
    let raised = 0;
    for (const c of candidates) {
      if (openKeys.has(c.dedupeKey)) continue;
      const [a] = await tx.insert(alerts).values(candidateRow(b!, snap.season?.id ?? null, c)).returning();
      await notifyAlert(tx, b!, a!);
      await emit(tx, actor, 'alert.raised', { type: 'alert', id: a!.id }, { blockId, ruleCode: c.ruleCode, severity: c.severity }, b!.ownerOrgId);
      raised++;
    }
    let resolved = 0;
    for (const a of open) {
      if (a.dedupeKey && !keys.has(a.dedupeKey)) {
        await tx.update(alerts).set({ status: 'resolved', resolvedAt: new Date(), resolutionNote: 'auto: condition no longer met', version: a.version + 1 }).where(eq(alerts.id, a.id));
        resolved++;
      }
    }
    // Overdue buyer invoices are flagged on the invoice too.
    await tx.update(buyerInvoices).set({ status: 'overdue' }).where(and(eq(buyerInvoices.blockId, blockId), inArray(buyerInvoices.status, ['issued', 'partially_paid']), sql`${buyerInvoices.dueDate} < ${asOf}`));
    return { raised, resolved };
  });
}

const candidateRow = (b: typeof blocks.$inferSelect, seasonId: string | null, c: AlertCandidate) => ({
  blockId: b.id,
  ownerOrgId: b.ownerOrgId,
  seasonId,
  type: c.ruleCode.toLowerCase(),
  severity: c.severity,
  source: 'rule' as const,
  ruleCode: c.ruleCode as AlertRuleCode,
  dedupeKey: c.dedupeKey,
  message: c.message,
  data: c.data,
});

/** Nightly job: every non-archived block. */
export async function runAlerts(db: Db, asOf?: string) {
  const bs = await db.select({ id: blocks.id }).from(blocks).where(notInArray(blocks.status, ['archived', 'draft']));
  let raised = 0;
  let resolved = 0;
  for (const b of bs) {
    const r = await runAlertsForBlock(db, b.id, asOf);
    raised += r.raised;
    resolved += r.resolved;
  }
  return { blocks: bs.length, raised, resolved };
}

