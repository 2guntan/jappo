import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BuyerInvoice, BuyerInvoiceCreateBody, Dispatch, DispatchAcceptBody, DispatchCreateBody, EscrowReceipt, EscrowReceiptCreateBody, HarvestDelivery, HarvestDeliveryCreateBody, IdParam, ReceiptActionBody, Uuid,
  VoidBody,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch } from '../../core/etag';
import { conflict } from '../../core/errors';
import { eq } from 'drizzle-orm';
import { files } from '../../core/schema';

export async function harvestRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/seasons/:id/harvest-deliveries', {
    schema: { operationId: 'listHarvestDeliveries', tags: ['harvest'], 'x-permission': 'harvest:read', params: IdParam, querystring: z.object({ farmerId: Uuid.optional() }), response: { 200: z.object({ data: z.array(HarvestDelivery) }) } },
    handler: async (q) => ({ data: await svc.listHarvest(db, q.actor, q.params.id, q.query.farmerId) }),
  });
  r.post('/seasons/:id/harvest-deliveries', {
    schema: { operationId: 'recordHarvestDelivery', tags: ['harvest'], summary: 'Weighing ticket (net = gross − tare); grade from the offtake quality spec; idempotent by offlineClientId', 'x-permission': 'harvest:record', params: IdParam, body: HarvestDeliveryCreateBody, response: { 201: HarvestDelivery } },
    handler: async (q, reply) => reply.status(201).send(await svc.recordHarvest(db, q.actor, q.params.id, q.body)),
  });
  r.post('/harvest-deliveries/:id/actions/void', {
    schema: { operationId: 'voidHarvestDelivery', tags: ['harvest'], 'x-permission': 'harvest:record', params: IdParam, body: VoidBody, response: { 200: HarvestDelivery } },
    handler: async (q) => svc.voidHarvest(db, q.actor, q.params.id, requireIfMatch(q), q.body.reason),
  });
  r.get('/dispatches', {
    schema: { operationId: 'listDispatches', tags: ['harvest'], summary: 'Operator: by season. Buyer: its own dispatches', 'x-permission': 'dispatch:read', querystring: z.object({ seasonId: Uuid.optional() }), response: { 200: z.object({ data: z.array(Dispatch) }) } },
    handler: async (q) => ({ data: await svc.listDispatches(db, q.actor, q.query) }),
  });
  r.get('/seasons/:id/dispatches', {
    schema: { operationId: 'listSeasonDispatches', tags: ['harvest'], 'x-permission': 'dispatch:read', params: IdParam, response: { 200: z.object({ data: z.array(Dispatch) }) } },
    handler: async (q) => ({ data: await svc.listDispatches(db, q.actor, { seasonId: q.params.id }) }),
  });
  r.post('/seasons/:id/dispatches', {
    schema: { operationId: 'createDispatch', tags: ['harvest'], 'x-permission': 'dispatch:create', params: IdParam, body: DispatchCreateBody, response: { 201: Dispatch } },
    handler: async (q, reply) => reply.status(201).send(await svc.createDispatch(db, q.actor, q.params.id, q.body)),
  });
  r.post('/dispatches/:id/actions/accept', {
    schema: { operationId: 'acceptDispatch', tags: ['harvest'], summary: 'Buyer: accepted and rejected kg', 'x-permission': 'dispatch:accept', params: IdParam, body: DispatchAcceptBody, response: { 200: Dispatch } },
    handler: async (q) => svc.acceptDispatch(db, q.actor, q.params.id, requireIfMatch(q), q.body),
  });
  r.get('/buyer-invoices', {
    schema: { operationId: 'listBuyerInvoices', tags: ['harvest'], 'x-permission': 'buyer_invoice:read', querystring: z.object({ seasonId: Uuid.optional(), blockId: Uuid.optional() }), response: { 200: z.object({ data: z.array(BuyerInvoice) }) } },
    handler: async (q) => ({ data: await svc.listInvoices(db, q.actor, q.query) }),
  });
  r.post('/buyer-invoices', {
    schema: { operationId: 'createBuyerInvoice', tags: ['harvest'], summary: 'From accepted dispatches of one offtake contract; Σ accepted kg × price × grade adjustment', 'x-permission': 'buyer_invoice:create', body: BuyerInvoiceCreateBody, response: { 201: BuyerInvoice } },
    handler: async (q, reply) => reply.status(201).send(await svc.createInvoice(ctx, q.actor, q.body)),
  });
  r.get('/buyer-invoices/:id/pdf', {
    schema: { operationId: 'getBuyerInvoicePdf', tags: ['harvest'], 'x-permission': 'buyer_invoice:read', params: IdParam, response: { 200: z.object({ url: z.string(), fileId: z.string() }) } },
    handler: async (q) => {
      const i = await svc.getInvoice(db, q.actor, q.params.id);
      if (!i.pdfFileId) throw conflict('PDF_NOT_AVAILABLE', 'The invoice PDF is not available');
      // Visibility already checked on the invoice (operator, buyer, lenders with a block grant).
      const [f] = await db.select().from(files).where(eq(files.id, i.pdfFileId));
      if (!f) throw conflict('PDF_NOT_AVAILABLE', 'The invoice PDF is not available');
      return { url: await ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300), fileId: f.id };
    },
  });
  r.post('/buyer-invoices/:id/actions/dispute', {
    schema: { operationId: 'disputeBuyerInvoice', tags: ['harvest'], 'x-permission': 'dispatch:accept', params: IdParam, body: VoidBody, response: { 200: BuyerInvoice } },
    handler: async (q) => svc.disputeInvoice(db, q.actor, q.params.id, q.body.reason),
  });
  r.get('/escrow-receipts', {
    schema: { operationId: 'listEscrowReceipts', tags: ['harvest'], 'x-permission': 'escrow_receipt:read', querystring: z.object({ blockId: Uuid.optional(), seasonId: Uuid.optional(), status: z.enum(['recorded', 'confirmed', 'rejected']).optional() }), response: { 200: z.object({ data: z.array(EscrowReceipt) }) } },
    handler: async (q) => ({ data: await svc.listReceipts(db, q.actor, q.query) }),
  });
  r.post('/escrow-receipts', {
    schema: { operationId: 'recordEscrowReceipt', tags: ['harvest'], summary: 'Lender (confirmed at once) or buyer (pending lender confirmation)', 'x-permission': 'escrow_receipt:record', body: EscrowReceiptCreateBody, response: { 201: EscrowReceipt } },
    handler: async (q, reply) => reply.status(201).send(await svc.recordReceipt(db, q.actor, q.body)),
  });
  for (const action of ['confirm', 'reject'] as const) {
    r.post(`/escrow-receipts/:id/actions/${action}`, {
      schema: { operationId: action === 'confirm' ? 'confirmEscrowReceipt' : 'rejectEscrowReceipt', tags: ['harvest'], 'x-permission': 'escrow_receipt:confirm', params: IdParam, body: ReceiptActionBody, response: { 200: EscrowReceipt } },
      handler: async (q) => svc.actOnReceipt(db, q.actor, q.params.id, requireIfMatch(q), action, q.body.reason),
    });
  }
}
