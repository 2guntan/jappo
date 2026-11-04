import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Disbursement, DisbursementActionBody, DisbursementCreateBody, EscrowAccount, EscrowAccountCreateBody, Facility, FacilityDefaultBody, FacilityListQuery, FacilityRestructureBody, FacilityUpdateBody,
  IdParam, Repayment, Uuid,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch, setEtag } from '../../core/etag';

export async function facilityRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const out = async (actor: Parameters<typeof svc.loadFacility>[1], id: string) => {
    const { f, role } = await svc.loadFacility(db, actor, id);
    return svc.facilityDto(db, actor, f, role, true);
  };

  r.get('/facilities', {
    schema: { operationId: 'listFacilities', tags: ['facilities'], 'x-permission': 'facility:read', querystring: FacilityListQuery, response: { 200: z.object({ data: z.array(Facility) }) } },
    handler: async (q) => ({ data: await svc.listFacilities(db, q.actor, q.query) }),
  });
  r.get('/facilities/:id', {
    schema: { operationId: 'getFacility', tags: ['facilities'], summary: 'Facility with schedule, farmer allocations and CP checklist', 'x-permission': 'facility:read', params: IdParam, response: { 200: Facility } },
    handler: async (q, reply) => {
      const f = await out(q.actor, q.params.id);
      setEtag(reply, f.version);
      return f;
    },
  });
  r.patch('/facilities/:id', {
    schema: { operationId: 'updateFacility', tags: ['facilities'], summary: 'Lender: core-banking loan reference, escrow account', 'x-permission': 'facility:manage', params: IdParam, body: FacilityUpdateBody, response: { 200: Facility } },
    handler: async (q) => {
      await svc.updateFacility(db, q.actor, q.params.id, requireIfMatch(q), q.body);
      return out(q.actor, q.params.id);
    },
  });
  r.post('/facilities/:id/actions/confirm-cp', {
    schema: { operationId: 'confirmFacilityCp', tags: ['facilities'], summary: 'Conditions precedent met → active; schedule dated from today', 'x-permission': 'facility:manage', params: IdParam, response: { 200: Facility } },
    handler: async (q) => {
      await svc.confirmCp(db, q.actor, q.params.id, requireIfMatch(q));
      return out(q.actor, q.params.id);
    },
  });
  r.post('/facilities/:id/actions/mark-default', {
    schema: { operationId: 'markFacilityDefault', tags: ['facilities'], 'x-permission': 'facility:manage', params: IdParam, body: FacilityDefaultBody, response: { 200: Facility } },
    handler: async (q) => {
      await svc.markDefault(db, q.actor, q.params.id, requireIfMatch(q), q.body.reason);
      return out(q.actor, q.params.id);
    },
  });
  r.post('/facilities/:id/actions/restructure', {
    schema: { operationId: 'restructureFacility', tags: ['facilities'], 'x-permission': 'facility:manage', params: IdParam, body: FacilityRestructureBody, response: { 200: Facility } },
    handler: async (q) => {
      await svc.restructure(db, q.actor, q.params.id, requireIfMatch(q), q.body);
      return out(q.actor, q.params.id);
    },
  });

  r.get('/escrow-accounts', {
    schema: { operationId: 'listEscrowAccounts', tags: ['facilities'], summary: 'Masked accounts: lender (own), operator (its blocks), buyer (blocks it buys from)', 'x-permission': 'escrow_receipt:read', querystring: z.object({ blockId: Uuid.optional() }), response: { 200: z.object({ data: z.array(EscrowAccount) }) } },
    handler: async (q) => ({ data: await svc.listEscrowAccounts(db, q.actor, q.query.blockId) }),
  });
  r.post('/escrow-accounts', {
    schema: { operationId: 'createEscrowAccount', tags: ['facilities'], summary: "Lender: block escrow account; linked to the lender's facilities and the block's offtake contracts", 'x-permission': 'escrow_account:manage', body: EscrowAccountCreateBody, response: { 201: EscrowAccount } },
    handler: async (q, reply) => reply.status(201).send(await svc.createEscrowAccount(db, q.actor, q.body)),
  });

  r.get('/facilities/:id/disbursements', {
    schema: { operationId: 'listDisbursements', tags: ['facilities'], 'x-permission': 'disbursement:read', params: IdParam, response: { 200: z.object({ data: z.array(Disbursement) }) } },
    handler: async (q) => ({ data: await svc.listDisbursements(db, q.actor, q.params.id) }),
  });
  r.post('/facilities/:id/disbursements', {
    schema: { operationId: 'requestDisbursement', tags: ['facilities'], 'x-permission': 'disbursement:request', params: IdParam, body: DisbursementCreateBody, response: { 201: Disbursement } },
    handler: async (q, reply) => reply.status(201).send(await svc.requestDisbursement(db, q.actor, q.params.id, q.body)),
  });
  r.get('/disbursements/pending', {
    schema: { operationId: 'listPendingDisbursements', tags: ['facilities'], summary: 'Requested, approved or executed disbursements of the current organisation', 'x-permission': 'disbursement:read', response: { 200: z.object({ data: z.array(Disbursement) }) } },
    handler: async (q) => ({ data: await svc.listPendingDisbursements(db, q.actor) }),
  });
  const perm = { approve: 'disbursement:approve', reject: 'disbursement:approve', execute: 'disbursement:execute', confirm: 'disbursement:approve' } as const;
  for (const action of ['approve', 'reject', 'execute', 'confirm'] as const) {
    r.post(`/disbursements/:id/actions/${action}`, {
      schema: { operationId: `${action}Disbursement`, tags: ['facilities'], summary: action === 'execute' ? 'Four-eyes: a different credit officer than the approver when the lender has ≥ 2' : undefined, 'x-permission': perm[action], params: IdParam, body: DisbursementActionBody, response: { 200: Disbursement } },
      handler: async (q) => svc.actOnDisbursement(db, q.actor, q.params.id, requireIfMatch(q), action, q.body),
    });
  }
  r.get('/facilities/:id/repayments', {
    schema: { operationId: 'listRepayments', tags: ['facilities'], 'x-permission': 'facility:read', params: IdParam, response: { 200: z.object({ data: z.array(Repayment) }) } },
    handler: async (q) => ({ data: await svc.listRepayments(db, q.actor, q.params.id) }),
  });
}
