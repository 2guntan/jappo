import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BillingSubscription, EventEnvelope, IdParam, InvoiceAdminActionBody, IsoDateTime, Ok, Plan, PlanUpdateBody, PlatformInvoice, SubscribeBody, WebhookCreateBody, WebhookDelivery, WebhookEndpoint } from '@jappo/contracts';
import { eq } from 'drizzle-orm';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { files } from '../../core/schema';
import { notFound } from '../../core/errors';

export async function billingRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const fileUrl = async (fileId: string) => {
    const [f] = await db.select().from(files).where(eq(files.id, fileId));
    if (!f) throw notFound('File');
    return { url: await ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300), fileId: f.id };
  };

  r.get('/billing/plans', {
    schema: { operationId: 'listPlans', tags: ['billing'], summary: 'Public price list', 'x-permission': 'public', response: { 200: z.object({ data: z.array(Plan) }) } },
    handler: async () => ({ data: await svc.listPlans(db) }),
  });
  r.get('/billing/subscription', {
    schema: { operationId: 'getSubscription', tags: ['billing'], 'x-permission': 'billing:read', response: { 200: BillingSubscription } },
    handler: async (q) => svc.getSubscription(db, q.actor),
  });
  r.post('/billing/subscription', {
    schema: { operationId: 'changeSubscription', tags: ['billing'], summary: 'Subscribe or change plan (annual seats invoiced at start)', 'x-permission': 'billing:manage', body: SubscribeBody, response: { 200: BillingSubscription } },
    handler: async (q) => svc.subscribe(ctx, q.actor, q.body.planCode),
  });
  r.get('/billing/invoices', {
    schema: { operationId: 'listPlatformInvoices', tags: ['billing'], 'x-permission': 'billing:read', response: { 200: z.object({ data: z.array(PlatformInvoice) }) } },
    handler: async (q) => ({ data: await svc.listInvoices(db, q.actor) }),
  });
  r.get('/billing/invoices/:id/pdf', {
    schema: { operationId: 'getPlatformInvoicePdf', tags: ['billing'], 'x-permission': 'billing:read', params: IdParam, response: { 200: z.object({ url: z.string(), fileId: z.string() }) } },
    handler: async (q) => fileUrl(await svc.getInvoiceFile(db, q.actor, q.params.id, false)),
  });

  // ---------------------------------------------------------------- admin
  r.get('/admin/plans', {
    schema: { operationId: 'adminListPlans', tags: ['admin'], 'x-permission': 'admin:read', response: { 200: z.object({ data: z.array(Plan) }) } },
    handler: async () => ({ data: await svc.listPlans(db, true) }),
  });
  r.patch('/admin/plans/:id', {
    schema: { operationId: 'adminUpdatePlan', tags: ['admin'], summary: 'Prices are settings, editable by the platform admin', 'x-permission': 'plan:manage', params: IdParam, body: PlanUpdateBody, response: { 200: Plan } },
    handler: async (q) => svc.updatePlan(db, q.actor, q.params.id, q.body),
  });
  r.get('/admin/invoices', {
    schema: { operationId: 'adminListInvoices', tags: ['admin'], 'x-permission': 'admin:read', response: { 200: z.object({ data: z.array(PlatformInvoice) }) } },
    handler: async (q) => ({ data: await svc.listInvoices(db, q.actor, true) }),
  });
  r.get('/admin/invoices/:id/pdf', {
    schema: { operationId: 'adminGetInvoicePdf', tags: ['admin'], 'x-permission': 'admin:read', params: IdParam, response: { 200: z.object({ url: z.string(), fileId: z.string() }) } },
    handler: async (q) => fileUrl(await svc.getInvoiceFile(db, q.actor, q.params.id, true)),
  });
  for (const action of ['mark-paid', 'void'] as const) {
    r.post(`/admin/invoices/:id/actions/${action}`, {
      schema: { operationId: action === 'mark-paid' ? 'adminMarkInvoicePaid' : 'adminVoidInvoice', tags: ['admin'], 'x-permission': 'invoice:manage', params: IdParam, body: InvoiceAdminActionBody, response: { 200: PlatformInvoice } },
      handler: async (q) => svc.adminInvoiceAction(db, q.actor, q.params.id, action, q.body),
    });
  }

  // ---------------------------------------------------------------- webhooks & events (SPEC §10.18)
  r.get('/webhooks', {
    schema: { operationId: 'listWebhooks', tags: ['webhooks'], 'x-permission': 'webhook:manage', response: { 200: z.object({ data: z.array(WebhookEndpoint) }) } },
    handler: async (q) => ({ data: await svc.listEndpoints(db, q.actor) }),
  });
  r.post('/webhooks', {
    schema: { operationId: 'createWebhook', tags: ['webhooks'], summary: 'The signing secret is returned once', 'x-permission': 'webhook:manage', body: WebhookCreateBody, response: { 201: WebhookEndpoint.extend({ secret: z.string() }) } },
    handler: async (q, reply) => reply.status(201).send(await svc.createEndpoint(db, q.actor, q.body)),
  });
  r.delete('/webhooks/:id', {
    schema: { operationId: 'deleteWebhook', tags: ['webhooks'], 'x-permission': 'webhook:manage', params: IdParam, response: { 200: Ok } },
    handler: async (q) => {
      await svc.deleteEndpoint(db, q.actor, q.params.id);
      return { ok: true as const };
    },
  });
  r.get('/webhooks/:id/deliveries', {
    schema: { operationId: 'listWebhookDeliveries', tags: ['webhooks'], 'x-permission': 'webhook:manage', params: IdParam, response: { 200: z.object({ data: z.array(WebhookDelivery) }) } },
    handler: async (q) => ({ data: await svc.listDeliveries(db, q.actor, q.params.id) }),
  });
  r.post('/webhooks/:id/actions/test', {
    schema: { operationId: 'testWebhook', tags: ['webhooks'], 'x-permission': 'webhook:manage', params: IdParam, response: { 200: z.object({ data: z.array(WebhookDelivery) }) } },
    handler: async (q) => ({ data: await svc.testEndpoint(ctx, q.actor, q.params.id) }),
  });
  r.get('/events', {
    schema: { operationId: 'listEvents', tags: ['webhooks'], summary: 'Org-scoped event feed for polling integrations', 'x-permission': 'event:read', querystring: z.object({ since: IsoDateTime.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), response: { 200: z.object({ data: z.array(EventEnvelope) }) } },
    handler: async (q) => ({ data: await svc.eventFeed(db, q.actor, q.query.since, q.query.limit) }),
  });
}
