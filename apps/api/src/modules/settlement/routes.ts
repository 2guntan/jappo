import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  FarmerArrear, FarmerOtpRequestBody, FarmerOtpVerifyBody, FarmerStatement, FarmerToken, IdParam, ImportConfirmationsBody, ImportConfirmationsResult, InstructionActionBody, MeFarmer, MeFarmerPlot, MeFarmerStatement,
  Ok, PayoutInstruction, SettlementRun,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import * as portal from './farmer-portal';
import { requireIfMatch, setEtag } from '../../core/etag';
import { notFound } from '../../core/errors';
import { farmerStatements } from './schema';
import { files } from '../../core/schema';
import { and, eq } from 'drizzle-orm';

const AUTH_RATE = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function settlementRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const out = async (actor: Parameters<typeof svc.loadRun>[1], id: string) => {
    const { run, role } = await svc.loadRun(db, actor, id);
    return svc.runDto(db, actor, run, role);
  };

  r.get('/settlement-runs', {
    schema: { operationId: 'listVisibleSettlementRuns', tags: ['settlement'], 'x-permission': 'settlement:read', response: { 200: z.object({ data: z.array(SettlementRun) }) } },
    handler: async (q) => ({ data: await svc.listVisibleRuns(db, q.actor) }),
  });
  r.get('/seasons/:id/settlement-runs', {
    schema: { operationId: 'listSettlementRuns', tags: ['settlement'], 'x-permission': 'settlement:read', params: IdParam, response: { 200: z.object({ data: z.array(SettlementRun) }) } },
    handler: async (q) => ({ data: await svc.listRuns(db, q.actor, q.params.id) }),
  });
  r.post('/seasons/:id/settlement-runs', {
    schema: { operationId: 'computeSettlementRun', tags: ['settlement'], summary: 'Compute the waterfall (SPEC §9.6) from confirmed receipts and accepted deliveries; season → settlement', 'x-permission': 'settlement:compute', params: IdParam, response: { 201: SettlementRun } },
    handler: async (q, reply) => reply.status(201).send(await out(q.actor, (await svc.createRun(db, q.actor, q.params.id)).id)),
  });
  r.get('/settlement-runs/:id', {
    schema: { operationId: 'getSettlementRun', tags: ['settlement'], summary: 'With lines and distribution', 'x-permission': 'settlement:read', params: IdParam, response: { 200: SettlementRun } },
    handler: async (q, reply) => {
      const run = await out(q.actor, q.params.id);
      setEtag(reply, run.version);
      return run;
    },
  });
  const ACTIONS = {
    recompute: { op: 'recomputeSettlementRun', perm: 'settlement:compute' },
    'approve-operator': { op: 'approveSettlementOperator', perm: 'settlement:approve_operator' },
    'approve-lender': { op: 'approveSettlementLender', perm: 'settlement:approve_lender' },
    instruct: { op: 'instructSettlementRun', perm: 'settlement:instruct' },
    'mark-executed': { op: 'markSettlementExecuted', perm: 'settlement:reconcile' },
    reconcile: { op: 'reconcileSettlementRun', perm: 'settlement:reconcile' },
  } as const;
  for (const [action, def] of Object.entries(ACTIONS) as [keyof typeof ACTIONS, (typeof ACTIONS)[keyof typeof ACTIONS]][]) {
    r.post(`/settlement-runs/:id/actions/${action}`, {
      schema: { operationId: def.op, tags: ['settlement'], 'x-permission': def.perm, params: IdParam, response: { 200: SettlementRun } },
      handler: async (q) => {
        const id = q.params.id;
        if (action === 'approve-lender') await svc.approveLender(db, q.actor, id);
        else {
          const v = requireIfMatch(q);
          if (action === 'recompute') await svc.recompute(db, q.actor, id, v);
          else if (action === 'approve-operator') await svc.approveOperator(db, q.actor, id, v);
          else if (action === 'instruct') await svc.instruct(ctx, q.actor, id, v);
          else if (action === 'mark-executed') await svc.markExecuted(db, q.actor, id, v);
          else await svc.reconcile(db, q.actor, id, v);
        }
        return out(q.actor, id);
      },
    });
  }
  r.get('/settlement-runs/:id/instructions', {
    schema: {
      operationId: 'listPayoutInstructions',
      tags: ['settlement'],
      summary: '`?format=generic|wave|orange_money` returns the CSV export (operator) and marks rows exported',
      'x-permission': 'settlement:read',
      params: IdParam,
      querystring: z.object({ format: z.enum(svc.EXPORT_FORMATS).optional() }),
      response: { 200: z.union([z.object({ data: z.array(PayoutInstruction) }), z.string()]) },
    },
    handler: async (q, reply) => {
      if (q.query.format) {
        const csv = await svc.exportInstructions(db, q.actor, q.params.id, q.query.format);
        return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="instructions-${q.query.format}.csv"`).send(csv);
      }
      return { data: await svc.listInstructions(db, q.actor, q.params.id) };
    },
  });
  for (const action of ['confirm', 'fail'] as const) {
    r.post(`/payout-instructions/:id/actions/${action}`, {
      schema: { operationId: action === 'confirm' ? 'confirmPayoutInstruction' : 'failPayoutInstruction', tags: ['settlement'], summary: 'Operator for farmer/operator payouts; the receiving lender for its own lines (posts the repayment)', 'x-permission': 'payout:confirm', params: IdParam, body: InstructionActionBody, response: { 200: PayoutInstruction } },
      handler: async (q) => svc.actOnInstruction(db, q.actor, q.params.id, action, q.body),
    });
  }
  r.post('/settlement-runs/:id/instructions/actions/import-confirmations', {
    schema: { operationId: 'importPayoutConfirmations', tags: ['settlement'], summary: 'CSV `reference,status,provider_ref,reason` from the bank or mobile-money provider', 'x-permission': 'payout:confirm', params: IdParam, body: ImportConfirmationsBody, response: { 200: ImportConfirmationsResult } },
    handler: async (q) => svc.importConfirmations(db, q.actor, q.params.id, q.body.csv),
  });
  r.get('/settlement-runs/:id/statements', {
    schema: { operationId: 'listFarmerStatements', tags: ['settlement'], 'x-permission': 'statement:read', params: IdParam, response: { 200: z.object({ data: z.array(FarmerStatement) }) } },
    handler: async (q) => ({ data: await svc.listStatements(db, q.actor, q.params.id) }),
  });
  r.get('/farmer-statements/:id/pdf', {
    schema: { operationId: 'getFarmerStatementPdf', tags: ['settlement'], 'x-permission': 'statement:read', params: IdParam, response: { 200: z.object({ url: z.string(), fileId: z.string() }) } },
    handler: async (q) => {
      const [s] = await db.select().from(farmerStatements).where(eq(farmerStatements.id, q.params.id));
      if (!s?.pdfFileId) throw notFound('Statement');
      await svc.listStatements(db, q.actor, s.runId); // visibility (operator / staff)
      const [f] = await db.select().from(files).where(and(eq(files.id, s.pdfFileId)));
      return { url: await ctx.storage.signedUrl(f!.objectKey, f!.filename, f!.id, 300), fileId: f!.id };
    },
  });
  r.post('/settlement-runs/:id/statements/actions/send', {
    schema: { operationId: 'sendFarmerStatements', tags: ['settlement'], summary: 'SMS summary to every farmer (PDF available in the farmer portal)', 'x-permission': 'statement:send', params: IdParam, response: { 200: z.object({ sent: z.number().int() }) } },
    handler: async (q) => svc.sendStatements(db, q.actor, q.params.id),
  });
  r.get('/farmers/:id/arrears', {
    schema: { operationId: 'listFarmerArrears', tags: ['settlement'], 'x-permission': 'farmer:read', params: IdParam, response: { 200: z.object({ data: z.array(FarmerArrear) }) } },
    handler: async (q) => ({ data: await svc.farmerArrearsList(db, q.actor, q.params.id) }),
  });

  // ---------------------------------------------------------------- farmer self-service (SPEC §10.16)
  r.post('/auth/farmer/otp/request', {
    config: AUTH_RATE,
    schema: { operationId: 'requestFarmerLoginOtp', tags: ['farmer-portal'], 'x-permission': 'public', body: FarmerOtpRequestBody, response: { 202: Ok } },
    handler: async (q, reply) => {
      await portal.requestFarmerOtp(db, q.body.phone);
      return reply.status(202).send({ ok: true as const });
    },
  });
  r.post('/auth/farmer/otp/verify', {
    config: AUTH_RATE,
    schema: { operationId: 'verifyFarmerLoginOtp', tags: ['farmer-portal'], summary: 'Short-lived farmer token (1 h, no refresh)', 'x-permission': 'public', body: FarmerOtpVerifyBody, response: { 200: FarmerToken } },
    handler: async (q) => portal.verifyFarmerOtp(db, q.actor, q.body.phone, q.body.code),
  });
  r.get('/me/farmer', {
    schema: { operationId: 'getMeFarmer', tags: ['farmer-portal'], 'x-permission': 'farmer', response: { 200: MeFarmer } },
    handler: async (q) => portal.meFarmer(db, q.actor),
  });
  r.get('/me/farmer/plots', {
    schema: { operationId: 'listMeFarmerPlots', tags: ['farmer-portal'], 'x-permission': 'farmer', response: { 200: z.object({ data: z.array(MeFarmerPlot) }) } },
    handler: async (q) => ({ data: await portal.mePlots(db, q.actor) }),
  });
  r.get('/me/farmer/statements', {
    schema: { operationId: 'listMeFarmerStatements', tags: ['farmer-portal'], 'x-permission': 'farmer', response: { 200: z.object({ data: z.array(MeFarmerStatement) }) } },
    handler: async (q) => ({ data: await portal.meStatements(db, q.actor) }),
  });
  r.get('/me/farmer/statements/:id/pdf', {
    schema: { operationId: 'getMeFarmerStatementPdf', tags: ['farmer-portal'], 'x-permission': 'farmer', params: IdParam, response: { 200: z.object({ url: z.string(), fileId: z.string() }) } },
    handler: async (q) => {
      const f = await portal.meStatementFile(db, q.actor, q.params.id);
      return { url: await ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300), fileId: f.id };
    },
  });
}
