import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { computeInvoice, formatXof, seasonMachine, transition, type QualityGrade } from '@jappo/domain';
import { renderBuyerInvoiceHtml } from '@jappo/templates';
import type { Db, DbOrTx } from '../../db/client';
import { buyerInvoices, dispatches, escrowReceipts, harvestDeliveries } from './schema';
import { escrowAccounts, facilities } from '../facilities/schema';
import { offtakeContracts } from '../offtake/schema';
import { blocks, plotAllocations, plots } from '../land/schema';
import { plantings, seasons } from '../planning/schema';
import { crops } from '../catalogue/schema';
import { farmers } from '../farmers/schema';
import { organizations } from '../identity/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { hasGrant } from '../../core/authz/visibility';
import { notifyOrgRoles } from '../../core/notify';
import { getSetting } from '../../core/settings';
import { pdfRenderer } from '../../core/adapters/pdf';
import { storeFile, getVisibleFile } from '../files/service';
import { loadBlock } from '../land/service';
import { verifyAck } from '../operations/service';
import type { ModuleContext } from '../../core/module';
import { env } from '../../env';

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const link = (path: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}${path}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const kg = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

async function loadSeason(db: DbOrTx, actor: ActorContext, seasonId: string, write = false) {
  const [s] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!s) throw notFound('Season');
  const b = await loadBlock(db, actor, s.blockId, write);
  return { s, b };
}

// ---------------------------------------------------------------- harvest deliveries (weighing tickets)

type DeliveryRow = typeof harvestDeliveries.$inferSelect;
export const harvestDto = (d: DeliveryRow, farmerCode = '', plotCode = '') => ({
  id: d.id,
  ticketNo: d.ticketNo,
  seasonId: d.seasonId,
  plotId: d.plotId,
  plotCode,
  farmerId: d.farmerId,
  farmerCode,
  plantingId: d.plantingId,
  cropId: d.cropId,
  deliveredAt: d.deliveredAt.toISOString(),
  grossKg: kg(d.grossKg),
  tareKg: kg(d.tareKg),
  netKg: kg(d.netKg),
  moisturePct: d.moisturePct === null ? null : Number(d.moisturePct),
  grade: d.grade,
  photoFileId: d.photoFileId,
  farmerAckMethod: d.farmerAckMethod,
  farmerAckAt: iso(d.farmerAckAt),
  status: d.status,
  dispatchId: d.dispatchId,
  voidReason: d.voidReason,
  version: d.version,
});

export async function listHarvest(db: DbOrTx, actor: ActorContext, seasonId: string, farmerId?: string) {
  const { s } = await loadSeason(db, actor, seasonId);
  const conds = [eq(harvestDeliveries.seasonId, s.id)];
  if (farmerId) conds.push(eq(harvestDeliveries.farmerId, farmerId));
  const rows = await db.select({ d: harvestDeliveries, fc: farmers.code, pc: plots.code }).from(harvestDeliveries).innerJoin(farmers, eq(farmers.id, harvestDeliveries.farmerId)).innerJoin(plots, eq(plots.id, harvestDeliveries.plotId)).where(and(...conds)).orderBy(desc(harvestDeliveries.deliveredAt));
  return rows.map((r) => harvestDto(r.d, r.fc, r.pc));
}

async function nextTicket(tx: DbOrTx, blockId: string): Promise<string> {
  const r = await tx.execute<{ last: number }>(sql`
    insert into ref_sequences (prefix, year, last) values (${`TKT:${blockId}`}, 0, 1)
    on conflict (prefix, year) do update set last = ref_sequences.last + 1
    returning last`);
  return `T-${String(r.rows[0]!.last).padStart(6, '0')}`;
}

/** Grades accepted for a crop on the block: union of active offtake quality specs (empty = free text). */
async function gradesFor(tx: DbOrTx, blockId: string, cropId: string): Promise<QualityGrade[]> {
  const ocs = await tx.select({ q: offtakeContracts.qualitySpec }).from(offtakeContracts).where(and(eq(offtakeContracts.blockId, blockId), eq(offtakeContracts.cropId, cropId), notInArray(offtakeContracts.status, ['terminated', 'expired'])));
  return ocs.flatMap((o) => o.q);
}

export interface HarvestBody {
  plotId: string;
  farmerId: string;
  deliveredAt?: string;
  grossKg: number;
  tareKg?: number;
  moisturePct?: number | null;
  grade: string;
  photoFileId?: string | null;
  farmerAckMethod?: 'otp' | 'signature_photo' | 'none';
  ackCode?: string;
  offlineClientId?: string | null;
}

export async function recordHarvest(db: Db, actor: ActorContext, seasonId: string, body: HarvestBody) {
  const { s, b } = await loadSeason(db, actor, seasonId, true);
  if (body.offlineClientId) {
    const [dup] = await db.select().from(harvestDeliveries).where(and(eq(harvestDeliveries.ownerOrgId, b.ownerOrgId), eq(harvestDeliveries.offlineClientId, body.offlineClientId)));
    if (dup) return harvestDto(dup);
  }
  if (!['in_progress', 'harvest'].includes(s.status)) throw conflict('SEASON_NOT_IN_PROGRESS', 'Harvest can be weighed only while the season is in progress or in harvest');
  const tare = body.tareKg ?? 0;
  if (tare < 0 || tare >= body.grossKg) throw badRequest('VALIDATION_FAILED', 'Tare must be ≥ 0 and below gross weight', [{ path: 'body.tareKg', message: 'invalid' }]);
  const [alloc] = await db.select().from(plotAllocations).where(and(eq(plotAllocations.plotId, body.plotId), eq(plotAllocations.farmerId, body.farmerId), eq(plotAllocations.blockId, b.id), eq(plotAllocations.status, 'active')));
  if (!alloc) throw unprocessable('FARMER_NOT_ON_PLOT', 'The farmer has no active allocation on this plot');
  const [pl] = await db.select().from(plantings).where(and(eq(plantings.plotId, body.plotId), eq(plantings.seasonId, s.id))).limit(1);
  if (!pl) throw unprocessable('NO_PLANTING', 'The plot has no planting in this season');
  const grades = await gradesFor(db, b.id, pl.cropId);
  if (grades.length && !grades.some((g) => g.grade === body.grade)) throw unprocessable('GRADE_INVALID', `Grade must be one of ${[...new Set(grades.map((g) => g.grade))].join(', ')}`, [{ path: 'body.grade', message: 'not in offtake quality spec' }]);
  const method = body.farmerAckMethod ?? 'none';
  const ackAt = await verifyAck(db, actor, body.farmerId, method, body.ackCode, body.photoFileId);
  if (body.photoFileId && method !== 'signature_photo') await getVisibleFile(db, actor, body.photoFileId);
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(harvestDeliveries)
      .values({
        ownerOrgId: b.ownerOrgId,
        blockId: b.id,
        ticketNo: await nextTicket(tx, b.id),
        seasonId: s.id,
        plotId: body.plotId,
        farmerId: body.farmerId,
        plantingId: pl.id,
        cropId: pl.cropId,
        deliveredAt: body.deliveredAt ? new Date(body.deliveredAt) : new Date(),
        grossKg: String(body.grossKg),
        tareKg: String(tare),
        moisturePct: body.moisturePct === null || body.moisturePct === undefined ? null : String(body.moisturePct),
        grade: body.grade,
        weighedByUserId: actorUserId(actor),
        photoFileId: body.photoFileId ?? null,
        farmerAckMethod: method,
        farmerAckAt: ackAt,
        offlineClientId: body.offlineClientId ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    if (s.status === 'in_progress') {
      // First weighing ticket moves the season to harvest (SPEC §8.2).
      await tx.update(seasons).set({ status: transition(seasonMachine, s.status, 'first_harvest'), version: sql`${seasons.version} + 1` }).where(and(eq(seasons.id, s.id), eq(seasons.status, 'in_progress')));
    }
    await audit(tx, actor, { action: 'harvest.recorded', resourceType: 'harvest_delivery', resourceId: d!.id, after: { ticketNo: d!.ticketNo, netKg: kg(d!.netKg), grade: d!.grade } });
    await emit(tx, actor, 'harvest.recorded', { type: 'harvest_delivery', id: d!.id }, { seasonId: s.id, blockId: b.id, farmerId: body.farmerId, netKg: kg(d!.netKg) }, b.ownerOrgId);
    return harvestDto(d!);
  });
}

export async function voidHarvest(db: Db, actor: ActorContext, id: string, expected: number, reason: string) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(harvestDeliveries).where(eq(harvestDeliveries.id, id)).for('update');
    if (!d || d.ownerOrgId !== actor.orgId) throw notFound('Harvest delivery');
    if (d.version !== expected) throw conflict('VERSION_MISMATCH', `Current version is ${d.version}`);
    if (d.status !== 'recorded') throw conflict('INVALID_STATE_TRANSITION', `A ${d.status} ticket cannot be voided`);
    const [u] = await tx.update(harvestDeliveries).set({ status: 'void', voidReason: reason, version: d.version + 1 }).where(eq(harvestDeliveries.id, id)).returning();
    await audit(tx, actor, { action: 'harvest.voided', resourceType: 'harvest_delivery', resourceId: id, after: { reason } });
    return harvestDto(u!);
  });
}

// ---------------------------------------------------------------- dispatches

type DispatchRow = typeof dispatches.$inferSelect;
export const dispatchDto = (d: DispatchRow, actor: ActorContext, extra: { buyerName?: string; offtakeRef?: string; blockRef?: string } = {}) => {
  const actions: string[] = [];
  if (d.buyerOrgId === actor.orgId && d.status === 'in_transit') actions.push('accept');
  if (d.ownerOrgId === actor.orgId && ['accepted', 'partially_accepted'].includes(d.status) && !d.invoiceId) actions.push('invoice');
  return {
    id: d.id,
    ref: d.ref,
    seasonId: d.seasonId,
    blockId: d.blockId,
    blockRef: extra.blockRef ?? '',
    offtakeContractId: d.offtakeContractId,
    offtakeRef: extra.offtakeRef ?? '',
    buyerOrgId: d.buyerOrgId,
    buyerName: extra.buyerName ?? '',
    dispatchedAt: d.dispatchedAt.toISOString(),
    vehicle: d.vehicle,
    deliveryIds: d.deliveryIds,
    netKgTotal: kg(d.netKgTotal),
    buyerAcceptedKg: d.buyerAcceptedKg === null ? null : kg(d.buyerAcceptedKg),
    buyerRejectedKg: d.buyerRejectedKg === null ? null : kg(d.buyerRejectedKg),
    buyerAcceptedAt: iso(d.buyerAcceptedAt),
    buyerComment: d.buyerComment,
    status: d.status,
    invoiceId: d.invoiceId,
    version: d.version,
    allowedActions: actions,
  };
};

async function dispatchExtras(db: DbOrTx, rows: DispatchRow[]) {
  const orgIds = [...new Set(rows.map((r) => r.buyerOrgId))];
  const ocIds = [...new Set(rows.map((r) => r.offtakeContractId))];
  const bIds = [...new Set(rows.map((r) => r.blockId))];
  const orgs = orgIds.length ? await db.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(inArray(organizations.id, orgIds)) : [];
  const ocs = ocIds.length ? await db.select({ id: offtakeContracts.id, ref: offtakeContracts.ref }).from(offtakeContracts).where(inArray(offtakeContracts.id, ocIds)) : [];
  const bs = bIds.length ? await db.select({ id: blocks.id, ref: blocks.ref }).from(blocks).where(inArray(blocks.id, bIds)) : [];
  return (r: DispatchRow) => ({ buyerName: orgs.find((o) => o.id === r.buyerOrgId)?.name, offtakeRef: ocs.find((o) => o.id === r.offtakeContractId)?.ref, blockRef: bs.find((b) => b.id === r.blockId)?.ref });
}

/** Operator: dispatches of a season. Buyer: its own dispatches (no season access needed). */
export async function listDispatches(db: DbOrTx, actor: ActorContext, q: { seasonId?: string }) {
  const orgId = requireOrg(actor);
  let rows: DispatchRow[];
  if (actor.orgType === 'buyer') rows = await db.select().from(dispatches).where(and(eq(dispatches.buyerOrgId, orgId), q.seasonId ? eq(dispatches.seasonId, q.seasonId) : undefined)).orderBy(desc(dispatches.dispatchedAt));
  else {
    if (!q.seasonId) throw badRequest('VALIDATION_FAILED', 'seasonId is required', [{ path: 'query.seasonId', message: 'required' }]);
    const { s } = await loadSeason(db, actor, q.seasonId);
    rows = await db.select().from(dispatches).where(eq(dispatches.seasonId, s.id)).orderBy(desc(dispatches.dispatchedAt));
  }
  const ex = await dispatchExtras(db, rows);
  return rows.map((r) => dispatchDto(r, actor, ex(r)));
}

export async function createDispatch(db: Db, actor: ActorContext, seasonId: string, body: { offtakeContractId: string; deliveryIds: string[]; vehicle?: string | null; dispatchedAt?: string }) {
  const { s, b } = await loadSeason(db, actor, seasonId, true);
  return db.transaction(async (tx) => {
    const [oc] = await tx.select().from(offtakeContracts).where(eq(offtakeContracts.id, body.offtakeContractId));
    if (!oc || oc.blockId !== b.id) throw notFound('Offtake contract');
    if (oc.status !== 'signed') throw unprocessable('OFFTAKE_NOT_SIGNED', 'Dispatch only against a signed offtake contract');
    const ds = await tx.select().from(harvestDeliveries).where(and(inArray(harvestDeliveries.id, body.deliveryIds), eq(harvestDeliveries.seasonId, s.id))).for('update');
    if (ds.length !== new Set(body.deliveryIds).size) throw unprocessable('DELIVERY_INVALID', 'Every ticket must belong to this season', [{ path: 'body.deliveryIds', message: 'invalid' }]);
    const bad = ds.filter((d) => d.status !== 'recorded' || d.cropId !== oc.cropId);
    if (bad.length) throw unprocessable('DELIVERY_NOT_DISPATCHABLE', `Tickets not dispatchable (already dispatched, void or other crop): ${bad.map((d) => d.ticketNo).join(', ')}`);
    const total = ds.reduce((sum, d) => sum + kg(d.netKg), 0);
    const [row] = await tx
      .insert(dispatches)
      .values({ ref: await nextRef(tx, 'DSP'), ownerOrgId: b.ownerOrgId, blockId: b.id, seasonId: s.id, offtakeContractId: oc.id, buyerOrgId: oc.buyerOrgId, dispatchedAt: body.dispatchedAt ? new Date(body.dispatchedAt) : new Date(), vehicle: body.vehicle ?? null, deliveryIds: ds.map((d) => d.id), netKgTotal: total.toFixed(3), createdBy: actorUserId(actor) })
      .returning();
    await tx.update(harvestDeliveries).set({ status: 'dispatched', dispatchId: row!.id }).where(inArray(harvestDeliveries.id, ds.map((d) => d.id)));
    await audit(tx, actor, { action: 'dispatch.created', resourceType: 'dispatch', resourceId: row!.id, after: { ref: row!.ref, netKgTotal: total, tickets: ds.length } });
    await emit(tx, actor, 'dispatch.created', { type: 'dispatch', id: row!.id }, { seasonId: s.id, offtakeContractId: oc.id, netKgTotal: total }, b.ownerOrgId);
    await notifyOrgRoles(tx, oc.buyerOrgId, ['buyer_rep'], { channels: ['in_app', 'email'], templateCode: 'dispatch.created', data: { ref: row!.ref, kg: total.toLocaleString('fr-SN'), blockRef: b.ref, link: link('/app/buyer/dispatches') }, link: '/app/buyer/dispatches' });
    return dispatchDto(row!, actor, { blockRef: b.ref, offtakeRef: oc.ref });
  });
}

/** Buyer acceptance with accepted / rejected kg (transit losses = remainder). */
export async function acceptDispatch(db: Db, actor: ActorContext, id: string, expected: number, body: { acceptedKg: number; rejectedKg: number; comment?: string | null }) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(dispatches).where(eq(dispatches.id, id)).for('update');
    if (!d || d.buyerOrgId !== actor.orgId) throw notFound('Dispatch');
    if (d.version !== expected) throw conflict('VERSION_MISMATCH', `Current version is ${d.version}`);
    if (d.status !== 'in_transit') throw conflict('INVALID_STATE_TRANSITION', `Dispatch is ${d.status}`);
    const total = kg(d.netKgTotal);
    if (body.acceptedKg + body.rejectedKg > total + 0.0005) throw unprocessable('KG_EXCEEDS_DISPATCH', `Accepted + rejected (${body.acceptedKg + body.rejectedKg} kg) exceeds dispatched ${total} kg`);
    if (body.rejectedKg > 0 && !body.comment?.trim()) throw badRequest('VALIDATION_FAILED', 'A comment is required when rejecting quantities', [{ path: 'body.comment', message: 'required' }]);
    const status = body.acceptedKg <= 0 ? ('rejected' as const) : body.acceptedKg + 0.0005 >= total ? ('accepted' as const) : ('partially_accepted' as const);
    const [u] = await tx
      .update(dispatches)
      .set({ buyerAcceptedKg: body.acceptedKg.toFixed(3), buyerRejectedKg: body.rejectedKg.toFixed(3), buyerAcceptedAt: new Date(), buyerComment: body.comment ?? null, status, version: d.version + 1 })
      .where(eq(dispatches.id, id))
      .returning();
    if (status === 'rejected') await tx.update(harvestDeliveries).set({ status: 'rejected' }).where(inArray(harvestDeliveries.id, d.deliveryIds));
    await audit(tx, actor, { action: 'dispatch.accepted', resourceType: 'dispatch', resourceId: id, after: body });
    await emit(tx, actor, 'dispatch.accepted', { type: 'dispatch', id }, { acceptedKg: body.acceptedKg, rejectedKg: body.rejectedKg, status }, d.ownerOrgId);
    await notifyOrgRoles(tx, d.ownerOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app', 'email'], templateCode: 'dispatch.accepted', data: { ref: d.ref, acceptedKg: body.acceptedKg.toLocaleString('fr-SN'), rejectedKg: body.rejectedKg.toLocaleString('fr-SN'), link: link(`/app/seasons/${d.seasonId}?tab=harvest`) }, link: `/app/seasons/${d.seasonId}?tab=harvest` });
    return dispatchDto(u!, actor);
  });
}

// ---------------------------------------------------------------- buyer invoices

type InvoiceRow = typeof buyerInvoices.$inferSelect;
export const invoiceDto = (i: InvoiceRow, actor: ActorContext, extra: { buyerName?: string; offtakeRef?: string; blockRef?: string } = {}) => ({
  id: i.id,
  ref: i.ref,
  blockId: i.blockId,
  blockRef: extra.blockRef ?? '',
  seasonId: i.seasonId,
  offtakeContractId: i.offtakeContractId,
  offtakeRef: extra.offtakeRef ?? '',
  buyerOrgId: i.buyerOrgId,
  buyerName: extra.buyerName ?? '',
  dispatchIds: i.dispatchIds,
  acceptedKg: kg(i.acceptedKg),
  amountXof: i.amountXof,
  paidXof: i.paidXof,
  outstandingXof: i.amountXof - i.paidXof,
  lines: i.lines as { grade: string; acceptedKg: number; adjustmentPct: number; unitPriceXof: number; amountXof: number }[],
  issuedAt: i.issuedAt.toISOString(),
  dueDate: i.dueDate,
  status: i.status,
  hasPdf: Boolean(i.pdfFileId),
  version: i.version,
  allowedActions: [...(i.buyerOrgId === actor.orgId && i.status !== 'paid' ? ['record_payment'] : [])],
});

async function invoiceVisible(db: DbOrTx, actor: ActorContext, i: InvoiceRow) {
  if (i.ownerOrgId === actor.orgId || i.buyerOrgId === actor.orgId || isPlatformStaff(actor)) return true;
  return hasGrant(db, actor, 'block', i.blockId);
}

export async function listInvoices(db: DbOrTx, actor: ActorContext, q: { seasonId?: string; blockId?: string }) {
  const orgId = requireOrg(actor);
  const conds = [];
  if (q.seasonId) conds.push(eq(buyerInvoices.seasonId, q.seasonId));
  if (q.blockId) conds.push(eq(buyerInvoices.blockId, q.blockId));
  if (!isPlatformStaff(actor)) conds.push(sql`(${buyerInvoices.ownerOrgId} = ${orgId} or ${buyerInvoices.buyerOrgId} = ${orgId} or exists (select 1 from access_grants g where g.resource_type = 'block' and g.resource_id = ${buyerInvoices.blockId} and g.grantee_org_id = ${orgId} and (g.expires_at is null or g.expires_at > now())))`);
  const rows = await db.select().from(buyerInvoices).where(and(...conds)).orderBy(desc(buyerInvoices.issuedAt)).limit(500);
  const orgs = rows.length ? await db.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(inArray(organizations.id, [...new Set(rows.map((r) => r.buyerOrgId))])) : [];
  const ocs = rows.length ? await db.select({ id: offtakeContracts.id, ref: offtakeContracts.ref }).from(offtakeContracts).where(inArray(offtakeContracts.id, [...new Set(rows.map((r) => r.offtakeContractId))])) : [];
  const bs = rows.length ? await db.select({ id: blocks.id, ref: blocks.ref }).from(blocks).where(inArray(blocks.id, [...new Set(rows.map((r) => r.blockId))])) : [];
  return rows.map((i) => invoiceDto(i, actor, { buyerName: orgs.find((o) => o.id === i.buyerOrgId)?.name, offtakeRef: ocs.find((o) => o.id === i.offtakeContractId)?.ref, blockRef: bs.find((b) => b.id === i.blockId)?.ref }));
}

export async function getInvoice(db: DbOrTx, actor: ActorContext, id: string) {
  const [i] = await db.select().from(buyerInvoices).where(eq(buyerInvoices.id, id));
  if (!i || !(await invoiceVisible(db, actor, i))) throw notFound('Buyer invoice');
  return i;
}

/** Operator: invoice accepted dispatches of one offtake contract (grade-adjusted amount, PDF). */
export async function createInvoice(ctx: ModuleContext, actor: ActorContext, body: { dispatchIds: string[] }) {
  const orgId = requireOrg(actor);
  const db = ctx.db;
  return db.transaction(async (tx) => {
    const ds = await tx.select().from(dispatches).where(and(inArray(dispatches.id, body.dispatchIds), eq(dispatches.ownerOrgId, orgId))).for('update');
    if (ds.length !== new Set(body.dispatchIds).size) throw notFound('Dispatch');
    const ocIds = new Set(ds.map((d) => d.offtakeContractId));
    if (ocIds.size !== 1) throw unprocessable('MIXED_OFFTAKE', 'An invoice covers dispatches of a single offtake contract');
    const notReady = ds.filter((d) => !['accepted', 'partially_accepted'].includes(d.status) || d.invoiceId);
    if (notReady.length) throw unprocessable('DISPATCH_NOT_INVOICEABLE', `Not accepted or already invoiced: ${notReady.map((d) => d.ref).join(', ')}`);
    const [oc] = await tx.select().from(offtakeContracts).where(eq(offtakeContracts.id, ds[0]!.offtakeContractId));
    const tickets = await tx.select().from(harvestDeliveries).where(inArray(harvestDeliveries.id, ds.flatMap((d) => d.deliveryIds)));
    const inv = computeInvoice({
      priceXofPerKg: oc!.priceXofPerKg,
      qualitySpec: oc!.qualitySpec,
      dispatches: ds.map((d) => ({ netKgTotal: kg(d.netKgTotal), acceptedKg: kg(d.buyerAcceptedKg), deliveries: tickets.filter((t) => t.dispatchId === d.id).map((t) => ({ netKg: kg(t.netKg), grade: t.grade })) })),
    });
    const issued = todayIso();
    const [row] = await tx
      .insert(buyerInvoices)
      .values({ ref: await nextRef(tx, 'BIN'), ownerOrgId: orgId, blockId: ds[0]!.blockId, seasonId: ds[0]!.seasonId, offtakeContractId: oc!.id, buyerOrgId: oc!.buyerOrgId, dispatchIds: ds.map((d) => d.id), acceptedKg: inv.acceptedKg.toFixed(3), amountXof: inv.amountXof, lines: inv.byGrade, dueDate: addDaysIso(issued, oc!.paymentTermsDays), createdBy: actorUserId(actor) })
      .returning();
    await tx.update(dispatches).set({ invoiceId: row!.id }).where(inArray(dispatches.id, ds.map((d) => d.id)));
    const pdfFileId = await renderInvoicePdf(ctx, tx, actor, row!);
    await tx.update(buyerInvoices).set({ pdfFileId }).where(eq(buyerInvoices.id, row!.id));
    await audit(tx, actor, { action: 'buyer_invoice.issued', resourceType: 'buyer_invoice', resourceId: row!.id, after: { ref: row!.ref, amountXof: row!.amountXof, acceptedKg: inv.acceptedKg } });
    await emit(tx, actor, 'buyer_invoice.issued', { type: 'buyer_invoice', id: row!.id }, { amountXof: row!.amountXof, buyerOrgId: oc!.buyerOrgId, dueDate: row!.dueDate }, orgId);
    await notifyOrgRoles(tx, oc!.buyerOrgId, ['buyer_rep'], { channels: ['in_app', 'email'], templateCode: 'buyer_invoice.issued', data: { ref: row!.ref, amount: formatXof(row!.amountXof), dueDate: row!.dueDate, link: link('/app/buyer/invoices') }, link: '/app/buyer/invoices' });
    return invoiceDto({ ...row!, pdfFileId }, actor, { offtakeRef: oc!.ref });
  });
}

async function renderInvoicePdf(ctx: ModuleContext, tx: DbOrTx, actor: ActorContext, i: InvoiceRow) {
  const orgs = await tx.select().from(organizations).where(inArray(organizations.id, [i.ownerOrgId, i.buyerOrgId]));
  const seller = orgs.find((o) => o.id === i.ownerOrgId)!;
  const buyer = orgs.find((o) => o.id === i.buyerOrgId)!;
  const [oc] = await tx.select({ ref: offtakeContracts.ref, cropId: offtakeContracts.cropId, escrowAccountId: offtakeContracts.escrowAccountId }).from(offtakeContracts).where(eq(offtakeContracts.id, i.offtakeContractId));
  const [crop] = await tx.select().from(crops).where(eq(crops.id, oc!.cropId));
  const [esc] = oc?.escrowAccountId ? await tx.select().from(escrowAccounts).where(eq(escrowAccounts.id, oc.escrowAccountId)) : [];
  const ds = await tx.select({ ref: dispatches.ref }).from(dispatches).where(inArray(dispatches.id, i.dispatchIds));
  const vatBps = await getSetting<number>(tx, 'billing.agri_vat_bps', 0);
  const html = renderBuyerInvoiceHtml(
    {
      ref: i.ref,
      issuedAt: i.issuedAt.toISOString().slice(0, 10),
      dueDate: i.dueDate,
      seller: { legalName: seller.legalName, ninea: seller.ninea, rccm: seller.rccm, address: seller.address },
      buyer: { legalName: buyer.legalName, ninea: buyer.ninea, rccm: buyer.rccm, address: buyer.address },
      product: crop ? `${crop.nameFr} / ${crop.nameEn}` : '—',
      offtakeRef: oc?.ref ?? '',
      dispatchRefs: ds.map((d) => d.ref),
      lines: i.lines as never,
      amountXof: i.amountXof,
      vatBps,
      escrow: esc ? { bankName: esc.bankName, accountLabel: esc.accountLabel, accountNumberMasked: esc.accountNumberMasked } : null,
    },
    seller.locale,
  );
  const f = await storeFile(ctx, tx, { ...actor, orgId: i.ownerOrgId }, { filename: `${i.ref}.pdf`, declaredMime: 'application/pdf', buffer: await pdfRenderer().render(html) }, { linkedType: 'buyer_invoice', linkedId: i.id, ownerOrgId: i.ownerOrgId });
  return f.id;
}

export async function disputeInvoice(db: Db, actor: ActorContext, id: string, reason: string) {
  return db.transaction(async (tx) => {
    const [i] = await tx.select().from(buyerInvoices).where(eq(buyerInvoices.id, id)).for('update');
    if (!i || i.buyerOrgId !== actor.orgId) throw notFound('Buyer invoice');
    if (i.status === 'paid') throw conflict('INVOICE_PAID', 'A paid invoice cannot be disputed');
    const [u] = await tx.update(buyerInvoices).set({ status: 'disputed', disputeReason: reason, version: i.version + 1 }).where(eq(buyerInvoices.id, id)).returning();
    await audit(tx, actor, { action: 'buyer_invoice.disputed', resourceType: 'buyer_invoice', resourceId: id, after: { reason } });
    await notifyOrgRoles(tx, i.ownerOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app', 'email'], templateCode: 'buyer_invoice.disputed', data: { ref: i.ref, reason, link: link(`/app/seasons/${i.seasonId}?tab=harvest`) }, link: `/app/seasons/${i.seasonId}?tab=harvest` });
    return invoiceDto(u!, actor);
  });
}

// ---------------------------------------------------------------- escrow receipts

type ReceiptRow = typeof escrowReceipts.$inferSelect;
export const receiptDto = (r: ReceiptRow, actor: ActorContext, extra: { payerName?: string; invoiceRef?: string | null } = {}) => ({
  id: r.id,
  escrowAccountId: r.escrowAccountId,
  lenderOrgId: r.lenderOrgId,
  blockId: r.blockId,
  seasonId: r.seasonId,
  amountXof: r.amountXof,
  valueDate: r.valueDate,
  payerOrgId: r.payerOrgId,
  payerName: extra.payerName ?? '',
  bankReference: r.bankReference,
  buyerInvoiceId: r.buyerInvoiceId,
  invoiceRef: extra.invoiceRef ?? null,
  recordedByOrgId: r.recordedByOrgId,
  confirmedByLenderAt: iso(r.confirmedByLenderAt),
  proofFileId: r.proofFileId,
  status: r.status,
  rejectReason: r.rejectReason,
  createdAt: r.createdAt.toISOString(),
  version: r.version,
  allowedActions: r.lenderOrgId === actor.orgId && r.status === 'recorded' ? ['confirm', 'reject'] : [],
});

export async function listReceipts(db: DbOrTx, actor: ActorContext, q: { blockId?: string; seasonId?: string; status?: string }) {
  const orgId = requireOrg(actor);
  const conds = [];
  if (q.blockId) conds.push(eq(escrowReceipts.blockId, q.blockId));
  if (q.seasonId) conds.push(eq(escrowReceipts.seasonId, q.seasonId));
  if (q.status) conds.push(eq(escrowReceipts.status, q.status as ReceiptRow['status']));
  if (!isPlatformStaff(actor)) conds.push(sql`(${escrowReceipts.lenderOrgId} = ${orgId} or ${escrowReceipts.payerOrgId} = ${orgId} or exists (select 1 from blocks b where b.id = ${escrowReceipts.blockId} and b.owner_org_id = ${orgId}))`);
  const rows = await db.select().from(escrowReceipts).where(and(...conds)).orderBy(desc(escrowReceipts.valueDate)).limit(500);
  const orgs = rows.length ? await db.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(inArray(organizations.id, [...new Set(rows.map((r) => r.payerOrgId))])) : [];
  const invIds = rows.map((r) => r.buyerInvoiceId).filter((x): x is string => Boolean(x));
  const invs = invIds.length ? await db.select({ id: buyerInvoices.id, ref: buyerInvoices.ref }).from(buyerInvoices).where(inArray(buyerInvoices.id, invIds)) : [];
  return rows.map((r) => receiptDto(r, actor, { payerName: orgs.find((o) => o.id === r.payerOrgId)?.name, invoiceRef: invs.find((i) => i.id === r.buyerInvoiceId)?.ref ?? null }));
}

/**
 * Record a payment into escrow: by the lender holding the account (confirmed at once) or by the buyer
 * (pending lender confirmation). Only confirmed receipts count in settlement (SPEC §7.14).
 */
export async function recordReceipt(db: Db, actor: ActorContext, body: { escrowAccountId: string; amountXof: number; valueDate: string; bankReference: string; buyerInvoiceId?: string | null; payerOrgId?: string | null; proofFileId?: string | null }) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(escrowAccounts).where(eq(escrowAccounts.id, body.escrowAccountId));
    if (!e) throw notFound('Escrow account');
    const lender = e.lenderOrgId === orgId;
    let inv: InvoiceRow | undefined;
    if (body.buyerInvoiceId) {
      [inv] = await tx.select().from(buyerInvoices).where(eq(buyerInvoices.id, body.buyerInvoiceId)).for('update');
      if (!inv || inv.blockId !== e.blockId) throw unprocessable('INVOICE_INVALID', 'The invoice does not belong to the escrow block', [{ path: 'body.buyerInvoiceId', message: 'invalid' }]);
    }
    if (!lender) {
      // A buyer may record only towards its own invoices on a block where it has an offtake contract.
      if (actor.orgType !== 'buyer') throw notFound('Escrow account');
      const [oc] = await tx.select({ id: offtakeContracts.id }).from(offtakeContracts).where(and(eq(offtakeContracts.blockId, e.blockId), eq(offtakeContracts.buyerOrgId, orgId))).limit(1);
      if (!oc) throw notFound('Escrow account');
      if (inv && inv.buyerOrgId !== orgId) throw unprocessable('INVOICE_INVALID', 'Not your invoice', [{ path: 'body.buyerInvoiceId', message: 'invalid' }]);
    }
    const payerOrgId = lender ? (body.payerOrgId ?? inv?.buyerOrgId ?? null) : orgId;
    if (!payerOrgId) throw badRequest('VALIDATION_FAILED', 'payerOrgId is required', [{ path: 'body.payerOrgId', message: 'required' }]);
    if (body.proofFileId) await getVisibleFile(tx, actor, body.proofFileId);
    const [dup] = await tx.select({ id: escrowReceipts.id }).from(escrowReceipts).where(and(eq(escrowReceipts.escrowAccountId, e.id), eq(escrowReceipts.bankReference, body.bankReference)));
    if (dup) throw conflict('RECEIPT_DUPLICATE', 'A receipt with this bank reference already exists on this account');
    const now = new Date();
    const [r] = await tx
      .insert(escrowReceipts)
      .values({
        escrowAccountId: e.id,
        lenderOrgId: e.lenderOrgId,
        blockId: e.blockId,
        seasonId: inv?.seasonId ?? null,
        amountXof: body.amountXof,
        valueDate: body.valueDate,
        payerOrgId,
        bankReference: body.bankReference,
        buyerInvoiceId: inv?.id ?? null,
        recordedBy: actorUserId(actor),
        recordedByOrgId: orgId,
        proofFileId: body.proofFileId ?? null,
        status: lender ? 'confirmed' : 'recorded',
        confirmedByLenderAt: lender ? now : null,
        confirmedBy: lender ? actorUserId(actor) : null,
        createdBy: actorUserId(actor),
      })
      .returning();
    await audit(tx, actor, { action: 'escrow_receipt.recorded', resourceType: 'escrow_receipt', resourceId: r!.id, after: { amountXof: r!.amountXof, bankReference: r!.bankReference, status: r!.status } });
    if (lender) await onConfirmed(tx, actor, r!);
    else await notifyOrgRoles(tx, e.lenderOrgId, ['credit_officer'], { channels: ['in_app', 'email'], templateCode: 'escrow_receipt.recorded', data: { amount: formatXof(r!.amountXof), bankReference: r!.bankReference, link: link('/app/facilities') }, link: '/app/facilities' });
    return receiptDto(r!, actor);
  });
}

async function onConfirmed(tx: DbOrTx, actor: ActorContext, r: ReceiptRow) {
  if (r.buyerInvoiceId) {
    const [i] = await tx.select().from(buyerInvoices).where(eq(buyerInvoices.id, r.buyerInvoiceId)).for('update');
    const paid = i!.paidXof + r.amountXof;
    const status = paid >= i!.amountXof ? 'paid' : i!.status === 'disputed' ? 'disputed' : 'partially_paid';
    await tx.update(buyerInvoices).set({ paidXof: paid, status, version: i!.version + 1 }).where(eq(buyerInvoices.id, i!.id));
  }
  const [b] = await tx.select({ ownerOrgId: blocks.ownerOrgId }).from(blocks).where(eq(blocks.id, r.blockId));
  await emit(tx, actor, 'escrow_receipt.confirmed', { type: 'escrow_receipt', id: r.id }, { blockId: r.blockId, amountXof: r.amountXof, buyerInvoiceId: r.buyerInvoiceId }, b?.ownerOrgId ?? null);
  if (b) await notifyOrgRoles(tx, b.ownerOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app'], templateCode: 'escrow_receipt.confirmed', data: { amount: formatXof(r.amountXof), bankReference: r.bankReference, link: link('/app') }, link: '/app' });
}

export async function actOnReceipt(db: Db, actor: ActorContext, id: string, expected: number, action: 'confirm' | 'reject', reason?: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(escrowReceipts).where(eq(escrowReceipts.id, id)).for('update');
    if (!r || r.lenderOrgId !== actor.orgId) throw notFound('Escrow receipt');
    if (r.version !== expected) throw conflict('VERSION_MISMATCH', `Current version is ${r.version}`);
    if (r.status !== 'recorded') throw conflict('INVALID_STATE_TRANSITION', `Receipt is ${r.status}`);
    if (action === 'reject' && !reason?.trim()) throw badRequest('VALIDATION_FAILED', 'A reason is required', [{ path: 'body.reason', message: 'required' }]);
    const [u] = await tx
      .update(escrowReceipts)
      .set(action === 'confirm' ? { status: 'confirmed', confirmedByLenderAt: new Date(), confirmedBy: actorUserId(actor), version: r.version + 1 } : { status: 'rejected', rejectReason: reason!.trim(), version: r.version + 1 })
      .where(eq(escrowReceipts.id, id))
      .returning();
    await audit(tx, actor, { action: `escrow_receipt.${action === 'confirm' ? 'confirmed' : 'rejected'}`, resourceType: 'escrow_receipt', resourceId: id, after: { reason } });
    if (action === 'confirm') await onConfirmed(tx, actor, u!);
    return receiptDto(u!, actor);
  });
}

/** Lender facility check: is this org a lender with a facility on the block? */
export async function isBlockLender(db: DbOrTx, orgId: string, blockId: string) {
  const [f] = await db.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.blockId, blockId), eq(facilities.lenderOrgId, orgId))).limit(1);
  return Boolean(f);
}

