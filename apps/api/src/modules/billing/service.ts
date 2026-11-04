import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { billingStatusFor, formatXof, invoiceTotals, nextWebhookAttempt, structuringFeeXof } from '@jappo/domain';
import { renderPlatformInvoiceHtml } from '@jappo/templates';
import type { Db, DbOrTx } from '../../db/client';
import { plans, platformInvoices, subscriptions, webhookDeliveries, webhookEndpoints } from './schema';
import { organizations } from '../identity/schema';
import { plantings, seasons } from '../planning/schema';
import { awards } from '../marketplace/schema';
import { rfps } from '../marketplace/schema';
import { eventsOutbox } from '../../core/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, requireOrg, systemActor } from '../../core/context';
import { audit } from '../../core/audit';
import { toEnvelope, type DomainEvent } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { decryptPii, encryptPii, hmacHex, randomToken } from '../../core/crypto';
import { getSetting } from '../../core/settings';
import { notifyOrgRoles } from '../../core/notify';
import { pdfRenderer } from '../../core/adapters/pdf';
import { storeFile } from '../files/service';
import type { ModuleContext } from '../../core/module';
import { env } from '../../env';

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const link = (path: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}${path}`;
type PlanRow = typeof plans.$inferSelect;
type InvoiceRow = typeof platformInvoices.$inferSelect;

// ---------------------------------------------------------------- plans & subscriptions (SPEC §15)

export const planDto = (p: PlanRow) => ({ id: p.id, code: p.code, name: p.name, orgTypes: p.orgTypes, priceModel: p.priceModel, unitPriceXof: p.unitPriceXof, structuringFeeBps: p.structuringFeeBps, includedSeats: p.includedSeats, features: p.features, active: p.active, version: p.version });

export async function listPlans(db: DbOrTx, includeInactive = false) {
  const rows = await db.select().from(plans).where(includeInactive ? undefined : eq(plans.active, true)).orderBy(asc(plans.unitPriceXof));
  return rows.map(planDto);
}

export async function updatePlan(db: Db, actor: ActorContext, id: string, body: Partial<Pick<PlanRow, 'name' | 'unitPriceXof' | 'structuringFeeBps' | 'includedSeats' | 'features' | 'active'>>) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(plans).where(eq(plans.id, id)).for('update');
    if (!p) throw notFound('Plan');
    const [u] = await tx.update(plans).set({ ...body, version: p.version + 1 }).where(eq(plans.id, id)).returning();
    await audit(tx, actor, { action: 'plan.updated', resourceType: 'plan', resourceId: id, before: planDto(p), after: body });
    return planDto(u!);
  });
}

async function activeSubscription(db: DbOrTx, orgId: string) {
  const [s] = await db.select({ s: subscriptions, p: plans }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId)).where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, 'active'))).orderBy(desc(subscriptions.startDate)).limit(1);
  return s ?? null;
}

export async function getSubscription(db: DbOrTx, actor: ActorContext) {
  const orgId = requireOrg(actor);
  const s = await activeSubscription(db, orgId);
  const [o] = await db.select({ billingStatus: organizations.billingStatus }).from(organizations).where(eq(organizations.id, orgId));
  return { subscription: s ? { id: s.s.id, startDate: s.s.startDate, endDate: s.s.endDate, status: s.s.status, plan: planDto(s.p) } : null, billingStatus: (o?.billingStatus ?? 'ok') as 'ok' | 'overdue' | 'restricted' };
}

/** Subscribe or change plan (org admin). Annual-seat plans are invoiced at subscription start. */
export async function subscribe(ctx: ModuleContext, actor: ActorContext, planCode: string) {
  const orgId = requireOrg(actor);
  const sub = await ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(plans).where(and(eq(plans.code, planCode), eq(plans.active, true)));
    if (!p) throw notFound('Plan');
    if (!actor.orgType || !p.orgTypes.includes(actor.orgType)) throw unprocessable('PLAN_NOT_FOR_ORG_TYPE', `Plan ${p.code} is not available to ${actor.orgType} organisations`);
    const cur = await activeSubscription(tx, orgId);
    if (cur?.p.id === p.id) throw conflict('ALREADY_SUBSCRIBED', 'Already subscribed to this plan');
    const today = todayIso();
    if (cur) await tx.update(subscriptions).set({ status: 'cancelled', endDate: today, version: cur.s.version + 1 }).where(eq(subscriptions.id, cur.s.id));
    const [s] = await tx.insert(subscriptions).values({ orgId, planId: p.id, startDate: today, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'subscription.changed', resourceType: 'subscription', resourceId: s!.id, before: cur ? { plan: cur.p.code } : null, after: { plan: p.code } });
    return { s: s!, p };
  });
  if (sub.p.priceModel === 'annual_seat' && sub.p.unitPriceXof > 0) {
    await issueInvoice(ctx, orgId, `subscription:${sub.s.id}:${sub.s.startDate.slice(0, 4)}`, [{ description: `${sub.p.name} — licence annuelle (${sub.p.includedSeats} sièges)`, qty: 1, unitPriceXof: sub.p.unitPriceXof }], sub.s.startDate, addDaysIso(sub.s.startDate, 364));
  }
  return getSubscription(ctx.db, actor);
}

/** Operators without a subscription are placed on the starter plan when billing first applies (no dead end). */
async function ensureOperatorSubscription(tx: DbOrTx, orgId: string) {
  const cur = await activeSubscription(tx, orgId);
  if (cur) return cur;
  const [p] = await tx.select().from(plans).where(eq(plans.code, 'operator_starter'));
  if (!p) return null;
  const [s] = await tx.insert(subscriptions).values({ orgId, planId: p.id, startDate: todayIso() }).returning();
  await audit(tx, systemActor('billing'), { action: 'subscription.defaulted', resourceType: 'subscription', resourceId: s!.id, after: { plan: p.code } });
  return { s: s!, p };
}

// ---------------------------------------------------------------- invoices

export const invoiceDto = (i: InvoiceRow) => ({
  id: i.id,
  ref: i.ref,
  orgId: i.orgId,
  periodStart: i.periodStart,
  periodEnd: i.periodEnd,
  lines: i.lines as { description: string; qty: number; unitPriceXof: number; amountXof: number }[],
  amountXof: i.amountXof,
  taxXof: i.taxXof,
  totalXof: i.totalXof,
  status: i.status,
  issuedAt: i.issuedAt?.toISOString() ?? null,
  dueDate: i.dueDate,
  hasPdf: Boolean(i.pdfFileId),
  paidAt: i.paidAt?.toISOString() ?? null,
  paymentReference: i.paymentReference,
  version: i.version,
});

/** Issue a platform invoice (idempotent per source key): totals with VAT, PDF, email to org admins. */
export async function issueInvoice(ctx: ModuleContext, orgId: string, sourceKey: string, lines: { description: string; qty: number; unitPriceXof: number }[], periodStart: string, periodEnd: string) {
  const [dup] = await ctx.db.select().from(platformInvoices).where(eq(platformInvoices.sourceKey, sourceKey));
  if (dup) return dup;
  const vatBps = await getSetting<number>(ctx.db, 'billing.vat_bps', 1800);
  const terms = await getSetting<number>(ctx.db, 'billing.payment_terms_days', 15);
  const t = invoiceTotals(lines, vatBps);
  const actor = { ...systemActor('billing'), orgId };
  return ctx.db.transaction(async (tx) => {
    const [o] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
    const ref = await nextRef(tx, 'INV');
    const issued = todayIso();
    const html = renderPlatformInvoiceHtml({ ref, issuedAt: issued, dueDate: addDaysIso(issued, terms), customer: { legalName: o!.legalName, ninea: o!.ninea, rccm: o!.rccm, address: o!.address }, lines: t.lines, amountXof: t.amountXof, vatBps, taxXof: t.taxXof, totalXof: t.totalXof, periodStart, periodEnd }, o!.locale);
    const [inv] = await tx
      .insert(platformInvoices)
      .values({ ref, orgId, periodStart, periodEnd, lines: t.lines, amountXof: t.amountXof, taxXof: t.taxXof, totalXof: t.totalXof, status: 'issued', issuedAt: new Date(), dueDate: addDaysIso(issued, terms), sourceKey })
      .returning();
    const f = await storeFile(ctx, tx, actor, { filename: `${ref}.pdf`, declaredMime: 'application/pdf', buffer: await pdfRenderer().render(html) }, { linkedType: 'platform_invoice', linkedId: inv!.id, ownerOrgId: orgId });
    await tx.update(platformInvoices).set({ pdfFileId: f.id }).where(eq(platformInvoices.id, inv!.id));
    await audit(tx, actor, { action: 'platform_invoice.issued', resourceType: 'platform_invoice', resourceId: inv!.id, after: { ref, totalXof: t.totalXof, sourceKey } });
    await notifyOrgRoles(tx, orgId, ['org_admin'], { channels: ['in_app', 'email'], templateCode: 'billing.invoice_issued', data: { ref, amount: formatXof(t.totalXof), dueDate: addDaysIso(issued, terms), link: link('/app/settings/billing') }, link: '/app/settings/billing' });
    return { ...inv!, pdfFileId: f.id };
  });
}

export async function listInvoices(db: DbOrTx, actor: ActorContext, all = false) {
  const rows = await db.select().from(platformInvoices).where(all ? undefined : eq(platformInvoices.orgId, requireOrg(actor))).orderBy(desc(platformInvoices.createdAt)).limit(500);
  return rows.map(invoiceDto);
}

export async function getInvoiceFile(db: DbOrTx, actor: ActorContext, id: string, staff: boolean) {
  const [i] = await db.select().from(platformInvoices).where(eq(platformInvoices.id, id));
  if (!i || (!staff && i.orgId !== actor.orgId) || !i.pdfFileId) throw notFound('Invoice');
  return i.pdfFileId;
}

export async function adminInvoiceAction(db: Db, actor: ActorContext, id: string, action: 'mark-paid' | 'void', body: { reference?: string; reason?: string }) {
  const inv = await db.transaction(async (tx) => {
    const [i] = await tx.select().from(platformInvoices).where(eq(platformInvoices.id, id)).for('update');
    if (!i) throw notFound('Invoice');
    if (i.status !== 'issued') throw conflict('INVALID_STATE_TRANSITION', `Invoice is ${i.status}`);
    if (action === 'mark-paid' && !body.reference?.trim()) throw badRequest('VALIDATION_FAILED', 'A payment reference is required', [{ path: 'body.reference', message: 'required' }]);
    if (action === 'void' && !body.reason?.trim()) throw badRequest('VALIDATION_FAILED', 'A reason is required', [{ path: 'body.reason', message: 'required' }]);
    const [u] = await tx
      .update(platformInvoices)
      .set(action === 'mark-paid' ? { status: 'paid', paidAt: new Date(), paymentReference: body.reference!.trim(), version: i.version + 1 } : { status: 'void', voidReason: body.reason!.trim(), version: i.version + 1 })
      .where(eq(platformInvoices.id, id))
      .returning();
    await audit(tx, actor, { action: `platform_invoice.${action === 'mark-paid' ? 'paid' : 'voided'}`, resourceType: 'platform_invoice', resourceId: id, after: body });
    return u!;
  });
  await refreshBillingStatus(db, inv.orgId);
  return invoiceDto(inv);
}

// ---------------------------------------------------------------- invoicing jobs (event handlers)

/** `season.started` → per-ha fee on planted hectares (operator per_ha_season plans). */
export async function onSeasonStarted(ctx: ModuleContext, e: DomainEvent) {
  const [s] = await ctx.db.select().from(seasons).where(eq(seasons.id, e.aggregate.id));
  if (!s) return;
  const sub = await ctx.db.transaction((tx) => ensureOperatorSubscription(tx, s.ownerOrgId));
  if (!sub || sub.p.priceModel !== 'per_ha_season' || sub.p.unitPriceXof <= 0) return;
  const [{ ha } = { ha: '0' }] = await ctx.db.select({ ha: sql<string>`coalesce(sum(${plantings.areaHa}), 0)` }).from(plantings).where(eq(plantings.seasonId, s.id));
  const hectares = Math.round(Number(ha) * 100) / 100;
  if (hectares <= 0) return;
  await issueInvoice(ctx, s.ownerOrgId, `season:${s.id}`, [{ description: `${sub.p.name} — ${s.name} (${hectares} ha × ${formatXof(sub.p.unitPriceXof)})`, qty: hectares, unitPriceXof: sub.p.unitPriceXof }], s.startDate, s.endDate);
}

/** `award.accepted` → structuring fee on the awarded amount (operator plan bps). */
export async function onAwardAccepted(ctx: ModuleContext, e: DomainEvent) {
  const [a] = await ctx.db.select({ a: awards, ownerOrgId: rfps.ownerOrgId, ref: rfps.ref }).from(awards).innerJoin(rfps, eq(rfps.id, awards.rfpId)).where(eq(awards.id, e.aggregate.id));
  if (!a) return;
  const sub = await ctx.db.transaction((tx) => ensureOperatorSubscription(tx, a.ownerOrgId));
  if (!sub || sub.p.structuringFeeBps <= 0) return;
  const fee = structuringFeeXof(a.a.amountXof, sub.p.structuringFeeBps);
  if (fee <= 0) return;
  const today = todayIso();
  await issueInvoice(ctx, a.ownerOrgId, `award:${a.a.id}`, [{ description: `Frais de structuration ${a.ref} — ${sub.p.structuringFeeBps / 100} % de ${formatXof(a.a.amountXof)}`, qty: 1, unitPriceXof: fee }], today, today);
}

/** Daily: annual seat renewals and billing status (banner / read-only) from overdue invoices. */
export async function runBilling(ctx: ModuleContext, asOf = todayIso()) {
  const subs = await ctx.db.select({ s: subscriptions, p: plans }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId)).where(and(eq(subscriptions.status, 'active'), eq(plans.priceModel, 'annual_seat')));
  for (const { s, p } of subs) {
    const years = Math.floor((Date.parse(asOf) - Date.parse(s.startDate)) / (365 * 86400_000));
    const start = addDaysIso(s.startDate, years * 365);
    if (p.unitPriceXof > 0) await issueInvoice(ctx, s.orgId, `subscription:${s.id}:${start.slice(0, 4)}`, [{ description: `${p.name} — licence annuelle`, qty: 1, unitPriceXof: p.unitPriceXof }], start, addDaysIso(start, 364));
  }
  const orgs = await ctx.db.selectDistinct({ id: platformInvoices.orgId }).from(platformInvoices);
  for (const o of orgs) await refreshBillingStatus(ctx.db, o.id, asOf);
  return { orgs: orgs.length };
}

export async function refreshBillingStatus(db: DbOrTx, orgId: string, asOf = todayIso()) {
  const open = await db.select({ dueDate: platformInvoices.dueDate }).from(platformInvoices).where(and(eq(platformInvoices.orgId, orgId), eq(platformInvoices.status, 'issued'), lte(platformInvoices.dueDate, asOf)));
  const maxDays = open.reduce((m, i) => Math.max(m, Math.floor((Date.parse(asOf) - Date.parse(i.dueDate)) / 86400_000)), 0);
  const status = billingStatusFor(maxDays, await getSetting<number>(db, 'billing.banner_days', 30), await getSetting<number>(db, 'billing.read_only_days', 60));
  await db.update(organizations).set({ billingStatus: status }).where(eq(organizations.id, orgId));
  return status;
}

// ---------------------------------------------------------------- webhooks (SPEC §11.2)

export const endpointDto = (w: typeof webhookEndpoints.$inferSelect) => ({ id: w.id, url: w.url, eventTypes: w.eventTypes, active: w.active, createdAt: w.createdAt.toISOString() });

export async function listEndpoints(db: DbOrTx, actor: ActorContext) {
  return (await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.orgId, requireOrg(actor))).orderBy(desc(webhookEndpoints.createdAt))).map(endpointDto);
}

export async function createEndpoint(db: Db, actor: ActorContext, body: { url: string; eventTypes: string[] }) {
  const orgId = requireOrg(actor);
  const u = new URL(body.url);
  if (u.protocol !== 'https:' && env().NODE_ENV === 'production') throw badRequest('VALIDATION_FAILED', 'Webhook URLs must use HTTPS', [{ path: 'body.url', message: 'https required' }]);
  const secret = `whsec_${randomToken(24)}`;
  return db.transaction(async (tx) => {
    const [w] = await tx.insert(webhookEndpoints).values({ orgId, url: body.url, secretEnc: encryptPii(secret), eventTypes: body.eventTypes, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'webhook.created', resourceType: 'webhook_endpoint', resourceId: w!.id, after: { url: body.url, eventTypes: body.eventTypes } });
    return { ...endpointDto(w!), secret };
  });
}

async function ownEndpoint(db: DbOrTx, actor: ActorContext, id: string) {
  const [w] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  if (!w || w.orgId !== actor.orgId) throw notFound('Webhook');
  return w;
}

export async function deleteEndpoint(db: Db, actor: ActorContext, id: string) {
  await db.transaction(async (tx) => {
    const w = await ownEndpoint(tx, actor, id);
    await tx.update(webhookEndpoints).set({ active: false, version: w.version + 1 }).where(eq(webhookEndpoints.id, id));
    await audit(tx, actor, { action: 'webhook.deleted', resourceType: 'webhook_endpoint', resourceId: id });
  });
}

export async function listDeliveries(db: DbOrTx, actor: ActorContext, id: string) {
  const w = await ownEndpoint(db, actor, id);
  const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, w.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(200);
  return rows.map((d) => ({ id: d.id, eventId: d.eventId, eventType: d.eventType, status: d.status, attempts: d.attempts, lastStatusCode: d.lastStatusCode, lastError: d.lastError, nextAttemptAt: d.status === 'pending' ? d.nextAttemptAt.toISOString() : null, deliveredAt: d.deliveredAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString() }));
}

/** Outbox `*` handler: queue a delivery for every active endpoint of the event's organisation subscribed to its type. */
export async function queueWebhooks(ctx: ModuleContext, e: DomainEvent) {
  if (!e.orgId) return;
  const eps = await ctx.db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.orgId, e.orgId), eq(webhookEndpoints.active, true)));
  for (const w of eps) {
    if (!w.eventTypes.includes('*') && !w.eventTypes.includes(e.type)) continue;
    await ctx.db.insert(webhookDeliveries).values({ endpointId: w.id, eventId: e.id, eventType: e.type, payload: e as unknown as Record<string, unknown> }).onConflictDoNothing();
  }
}

export async function testEndpoint(ctx: ModuleContext, actor: ActorContext, id: string) {
  const w = await ownEndpoint(ctx.db, actor, id);
  const now = new Date().toISOString();
  const e: DomainEvent = { id: crypto.randomUUID(), type: 'webhook.test', version: 1, occurredAt: now, orgId: w.orgId, aggregate: { type: 'webhook_endpoint', id: w.id }, actor: { type: 'user', id: actorUserId(actor) }, data: { message: 'Jappo webhook test' } };
  await ctx.db.insert(webhookDeliveries).values({ endpointId: w.id, eventId: e.id, eventType: e.type, payload: e as unknown as Record<string, unknown> });
  await deliverWebhooks(ctx);
  return listDeliveries(ctx.db, actor, id);
}

/** Send due deliveries with `Jappo-Signature: t=<unix>,v1=<HMAC-SHA256(secret, t.body)>`; backoff then `failed`. */
export async function deliverWebhooks(ctx: ModuleContext, now = new Date()) {
  const due = await ctx.db.select({ d: webhookDeliveries, w: webhookEndpoints }).from(webhookDeliveries).innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId)).where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, now))).limit(100);
  let sent = 0;
  for (const { d, w } of due) {
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(now.getTime() / 1000);
    const sig = hmacHex(decryptPii(w.secretEnc), `${ts}.${body}`);
    let code: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(w.url, { method: 'POST', headers: { 'content-type': 'application/json', 'Jappo-Signature': `t=${ts},v1=${sig}`, 'Jappo-Event-Id': d.eventId, 'Jappo-Event-Type': d.eventType }, body, signal: AbortSignal.timeout(10_000) });
      code = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 500);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await ctx.db.update(webhookDeliveries).set({ status: 'delivered', attempts, lastStatusCode: code, lastError: null, deliveredAt: now }).where(eq(webhookDeliveries.id, d.id));
      sent++;
    } else {
      const next = nextWebhookAttempt(attempts, now);
      await ctx.db.update(webhookDeliveries).set({ status: next ? 'pending' : 'failed', attempts, lastStatusCode: code, lastError: error, nextAttemptAt: next ?? d.nextAttemptAt }).where(eq(webhookDeliveries.id, d.id));
    }
  }
  return { attempted: due.length, sent };
}

/** Org-scoped event feed for polling integrations (`GET /events?since=`). */
export async function eventFeed(db: DbOrTx, actor: ActorContext, since?: string, limit = 100) {
  const orgId = requireOrg(actor);
  const rows = await db.select().from(eventsOutbox).where(and(eq(eventsOutbox.orgId, orgId), since ? sql`${eventsOutbox.occurredAt} > ${new Date(since)}` : undefined)).orderBy(asc(eventsOutbox.occurredAt)).limit(Math.min(limit, 500));
  return rows.map(toEnvelope);
}

