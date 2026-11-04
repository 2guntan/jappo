import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { asc, desc, eq } from 'drizzle-orm';
import { IdParam, IsoDate, IsoDateTime, Ok } from '@jappo/contracts';
import { renderContractBody, renderContractHtml } from '@jappo/templates';
import type { ModuleContext } from '../../core/module';
import { holidays, settings } from '../../core/schema';
import { webhookDeliveries, webhookEndpoints } from '../billing/schema';
import { organizations } from '../identity/schema';
import { audit } from '../../core/audit';
import { actorUserId } from '../../core/context';
import { badRequest, notFound } from '../../core/errors';

const Setting = z.object({ key: z.string(), value: z.unknown(), updatedAt: IsoDateTime }).meta({ id: 'Setting' });
const Holiday = z.object({ id: z.string(), date: IsoDate, name: z.string(), movable: z.boolean() }).meta({ id: 'Holiday' });

/** Platform admin console endpoints (SPEC §12.7): settings, holidays, template preview, webhook monitor. */
export async function adminConsoleRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/admin/settings', {
    schema: { operationId: 'adminListSettings', tags: ['admin'], 'x-permission': 'admin:read', response: { 200: z.object({ data: z.array(Setting) }) } },
    handler: async () => ({ data: (await db.select().from(settings).orderBy(asc(settings.key))).map((s) => ({ key: s.key, value: s.value, updatedAt: s.updatedAt.toISOString() })) }),
  });
  r.put('/admin/settings/:key', {
    schema: { operationId: 'adminUpdateSetting', tags: ['admin'], summary: 'Scoring weights, gate thresholds, RFP defaults, VAT, legal texts…', 'x-permission': 'settings:manage', params: z.object({ key: z.string().regex(/^[a-z0-9_.]+$/) }), body: z.object({ value: z.unknown() }), response: { 200: Setting } },
    handler: async (q) => {
      const [cur] = await db.select().from(settings).where(eq(settings.key, q.params.key));
      if (!cur) throw notFound('Setting');
      if (typeof cur.value !== typeof q.body.value && !(cur.value !== null && typeof cur.value === 'object' && typeof q.body.value === 'object')) throw badRequest('VALIDATION_FAILED', `Expected a ${typeof cur.value}`, [{ path: 'body.value', message: 'type mismatch' }]);
      return db.transaction(async (tx) => {
        const [u] = await tx.update(settings).set({ value: q.body.value as object, updatedAt: new Date(), updatedBy: actorUserId(q.actor) }).where(eq(settings.key, q.params.key)).returning();
        await audit(tx, q.actor, { action: 'setting.updated', resourceType: 'setting', resourceId: q.params.key, before: { value: cur.value }, after: { value: q.body.value } });
        return { key: u!.key, value: u!.value, updatedAt: u!.updatedAt.toISOString() };
      });
    },
  });
  r.get('/admin/holidays', {
    schema: { operationId: 'adminListHolidays', tags: ['admin'], 'x-permission': 'admin:read', response: { 200: z.object({ data: z.array(Holiday) }) } },
    handler: async () => ({ data: (await db.select().from(holidays).orderBy(asc(holidays.date))).map((h) => ({ id: h.id, date: h.date, name: h.name, movable: h.movable })) }),
  });
  r.post('/admin/holidays', {
    schema: { operationId: 'adminAddHoliday', tags: ['admin'], summary: 'Movable religious holidays (Tabaski, Korité, …) are entered here', 'x-permission': 'settings:manage', body: z.object({ date: IsoDate, name: z.string().min(2).max(100) }), response: { 201: Holiday } },
    handler: async (q, reply) => {
      const h = await db.transaction(async (tx) => {
        const [row] = await tx.insert(holidays).values({ date: q.body.date, name: q.body.name, movable: true }).onConflictDoUpdate({ target: holidays.date, set: { name: q.body.name } }).returning();
        await audit(tx, q.actor, { action: 'holiday.added', resourceType: 'holiday', resourceId: row!.id, after: q.body });
        return row!;
      });
      return reply.status(201).send({ id: h.id, date: h.date, name: h.name, movable: h.movable });
    },
  });
  r.delete('/admin/holidays/:id', {
    schema: { operationId: 'adminDeleteHoliday', tags: ['admin'], 'x-permission': 'settings:manage', params: IdParam, response: { 200: Ok } },
    handler: async (q) => {
      await db.transaction(async (tx) => {
        const [h] = await tx.delete(holidays).where(eq(holidays.id, q.params.id)).returning();
        if (!h) throw notFound('Holiday');
        await audit(tx, q.actor, { action: 'holiday.deleted', resourceType: 'holiday', resourceId: h.id, before: { date: h.date, name: h.name } });
      });
      return { ok: true as const };
    },
  });
  r.post('/admin/contract-templates/preview', {
    schema: { operationId: 'adminPreviewContractTemplate', tags: ['admin'], summary: 'Render template text with sample data (HTML)', 'x-permission': 'contract_template:manage', body: z.object({ bodyHbs: z.string().min(1).max(200_000), locale: z.enum(['fr', 'en']).default('fr') }), response: { 200: z.object({ html: z.string() }) } },
    handler: async (q) => {
      const sample = { ref: 'CTR-2026-0001', date: '2026-11-15', block: { ref: 'BLK-2026-0001', name: 'Bloc de Niaguis', areaHa: 12.5, region: 'Ziguinchor', commune: 'Niaguis' }, season: { code: 'Contre-saison 2026-27', startDate: '2026-11-15', endDate: '2027-04-30' }, operator: { legalName: 'Ferme Commune Kawral SARL', ninea: '000000000', rccm: 'SN-ZIG-2026-B-0001', address: 'Ziguinchor' }, lenders: [{ legalName: 'Mutuelle Alpha SFD', amountXof: 3_000_000 }], buyers: [{ legalName: 'Agro-Négoce Zeta SA' }], farmer: { name: 'Awa Diatta', code: 'F-000001', village: 'Niaguis' }, plots: [{ ref: 'P-001', areaHa: 1, sharePct: 100 }], crops: [{ name: 'Maïs', areaHa: 1 }], creditXof: 1_200_000, waterfall: ['…'], solidarity: { mode: 'none' }, reportingFrequency: 'mensuel', farmerCount: 3, clauses: { disputeResolution: 'CCJA', specialConditions: '' } };
      let body: string;
      try {
        body = renderContractBody(q.body.bodyHbs, sample, q.body.locale);
      } catch (e) {
        throw badRequest('TEMPLATE_INVALID', `Template does not compile: ${(e as Error).message}`, [{ path: 'body.bodyHbs', message: 'invalid Handlebars' }]);
      }
      return { html: renderContractHtml({ ref: sample.ref, title: 'Preview', bodyHtml: body, contentSha256: null, status: 'draft', signatures: [] }, q.body.locale) };
    },
  });
  r.get('/admin/webhook-deliveries', {
    schema: {
      operationId: 'adminListWebhookDeliveries',
      tags: ['admin'],
      summary: 'Delivery monitor across organisations (failed and pending first)',
      'x-permission': 'admin:read',
      response: { 200: z.object({ data: z.array(z.object({ id: z.string(), orgName: z.string(), url: z.string(), eventType: z.string(), status: z.string(), attempts: z.number().int(), lastStatusCode: z.number().int().nullable(), lastError: z.string().nullable(), createdAt: IsoDateTime })) }) },
    },
    handler: async () => {
      const rows = await db
        .select({ d: webhookDeliveries, url: webhookEndpoints.url, orgName: organizations.legalName })
        .from(webhookDeliveries)
        .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
        .innerJoin(organizations, eq(organizations.id, webhookEndpoints.orgId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(300);
      const rank = { failed: 0, pending: 1, delivered: 2 } as const;
      return { data: rows.sort((a, b) => rank[a.d.status] - rank[b.d.status]).map((r) => ({ id: r.d.id, orgName: r.orgName, url: r.url, eventType: r.d.eventType, status: r.d.status, attempts: r.d.attempts, lastStatusCode: r.d.lastStatusCode, lastError: r.d.lastError, createdAt: r.d.createdAt.toISOString() })) };
    },
  });
}
