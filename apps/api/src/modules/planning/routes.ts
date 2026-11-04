import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BudgetLine, BudgetLineCreateBody, BudgetLineUpdateBody, BudgetSummary, BulkAssignBody, CapexCreateBody, CapexItem, FeePolicy, FeePolicyBody, GenerateBudgetBody, IdParam, Ok,
  OpexCreateBody, OpexItem, Planting, PlantingCreateBody, PlantingUpdateBody, Season, SeasonCancelBody, SeasonCreateBody, SeasonStartBody, SeasonUpdateBody, SupplierQuote,
  SupplierQuoteCreateBody, Uuid,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch, setEtag } from '../../core/etag';

/** Hook so later modules (facilities) can tell whether a confirmed disbursement exists (SPEC §8.2 guard). */
export const seasonStartGuards: { hasConfirmedDisbursement?: Parameters<typeof svc.startSeason>[5] } = {};

export async function planningRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const list = <T>(data: T[]) => ({ data });
  const seasonReply = async (reply: { header: (k: string, v: string) => unknown }, actor: Parameters<typeof svc.seasonOut>[1], id: string) => {
    const s = await svc.seasonOut(db, actor, id);
    reply.header('ETag', `"${s.version}"`);
    return s;
  };

  // ---------------------------------------------------------- seasons
  r.get('/blocks/:id/seasons', {
    schema: { operationId: 'listSeasons', tags: ['planning'], 'x-permission': 'season:read', params: IdParam, response: { 200: z.object({ data: z.array(Season) }) } },
    handler: async (req) => list(await svc.listSeasons(db, req.actor, req.params.id)),
  });
  r.post('/blocks/:id/seasons', {
    schema: { operationId: 'createSeason', tags: ['planning'], 'x-permission': 'season:create', params: IdParam, body: SeasonCreateBody, response: { 201: Season } },
    handler: async (req, reply) => reply.status(201).send(await seasonReply(reply, req.actor, await svc.createSeason(db, req.actor, req.params.id, req.body))),
  });
  r.get('/seasons/:id', {
    schema: { operationId: 'getSeason', tags: ['planning'], 'x-permission': 'season:read', params: IdParam, response: { 200: Season } },
    handler: async (req, reply) => seasonReply(reply, req.actor, req.params.id),
  });
  r.patch('/seasons/:id', {
    schema: { operationId: 'updateSeason', tags: ['planning'], 'x-permission': 'season:update', params: IdParam, body: SeasonUpdateBody, response: { 200: Season } },
    handler: async (req, reply) => {
      await svc.updateSeason(db, req.actor, req.params.id, requireIfMatch(req), req.body);
      return seasonReply(reply, req.actor, req.params.id);
    },
  });
  r.post('/seasons/:id/actions/start', {
    schema: { operationId: 'startSeason', tags: ['planning'], summary: 'Start the season (confirmed disbursement or self-financed)', 'x-permission': 'season:start', params: IdParam, body: SeasonStartBody, response: { 200: Season } },
    handler: async (req, reply) => {
      await svc.startSeason(db, req.actor, req.params.id, requireIfMatch(req), req.body.selfFinanced, seasonStartGuards.hasConfirmedDisbursement);
      return seasonReply(reply, req.actor, req.params.id);
    },
  });
  r.post('/seasons/:id/actions/cancel', {
    schema: { operationId: 'cancelSeason', tags: ['planning'], 'x-permission': 'season:cancel', params: IdParam, body: SeasonCancelBody, response: { 200: Season } },
    handler: async (req, reply) => {
      await svc.cancelSeason(db, req.actor, req.params.id, requireIfMatch(req), req.body.reason);
      return seasonReply(reply, req.actor, req.params.id);
    },
  });

  // ---------------------------------------------------------- plantings
  r.get('/seasons/:id/plantings', {
    schema: { operationId: 'listPlantings', tags: ['planning'], 'x-permission': 'season:read', params: IdParam, response: { 200: z.object({ data: z.array(Planting) }) } },
    handler: async (req) => list(await svc.listPlantings(db, req.actor, req.params.id)),
  });
  r.post('/seasons/:id/plantings', {
    schema: { operationId: 'createPlanting', tags: ['planning'], 'x-permission': 'planting:manage', params: IdParam, body: PlantingCreateBody, response: { 201: Planting } },
    handler: async (req, reply) => {
      const id = await db.transaction((tx) => svc.createPlanting(tx, req.actor, req.params.id, req.body));
      return reply.status(201).send(await svc.plantingOut(db, req.actor, id));
    },
  });
  r.post('/seasons/:id/plantings/actions/bulk-assign', {
    schema: { operationId: 'bulkAssignPlantings', tags: ['planning'], summary: 'Plant one crop on many plots (full plot area); plots already planted are skipped', 'x-permission': 'planting:manage', params: IdParam, body: BulkAssignBody, response: { 201: z.object({ data: z.array(Planting), created: z.number().int() }) } },
    handler: async (req, reply) => {
      const created = await svc.bulkAssign(db, req.actor, req.params.id, req.body);
      return reply.status(201).send({ data: await svc.listPlantings(db, req.actor, req.params.id), created: created.length });
    },
  });
  r.patch('/plantings/:id', {
    schema: { operationId: 'updatePlanting', tags: ['planning'], 'x-permission': 'planting:manage', params: IdParam, body: PlantingUpdateBody, response: { 200: Planting } },
    handler: async (req) => {
      await svc.updatePlanting(db, req.actor, req.params.id, requireIfMatch(req), req.body);
      return svc.plantingOut(db, req.actor, req.params.id);
    },
  });
  r.delete('/plantings/:id', {
    schema: { operationId: 'deletePlanting', tags: ['planning'], 'x-permission': 'planting:manage', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      await svc.deletePlanting(db, req.actor, req.params.id);
      return { ok: true as const };
    },
  });

  // ---------------------------------------------------------- budget
  r.get('/seasons/:id/budget-lines', {
    schema: { operationId: 'listBudgetLines', tags: ['planning'], 'x-permission': 'budget:read', params: IdParam, response: { 200: z.object({ data: z.array(BudgetLine) }) } },
    handler: async (req) => list(await svc.listBudgetLines(db, req.actor, req.params.id)),
  });
  r.post('/seasons/:id/budget-lines', {
    schema: { operationId: 'createBudgetLine', tags: ['planning'], 'x-permission': 'budget:manage', params: IdParam, body: BudgetLineCreateBody, response: { 201: BudgetLine } },
    handler: async (req, reply) => {
      const id = await svc.createBudgetLine(db, req.actor, req.params.id, req.body);
      return reply.status(201).send((await svc.listBudgetLines(db, req.actor, req.params.id)).find((l) => l.id === id)!);
    },
  });
  r.post('/seasons/:id/budget-lines/actions/generate-from-templates', {
    schema: { operationId: 'generateBudgetFromTemplates', tags: ['planning'], 'x-permission': 'budget:manage', params: IdParam, body: GenerateBudgetBody, response: { 201: z.object({ data: z.array(BudgetLine), created: z.number().int() }) } },
    handler: async (req, reply) => {
      const created = await svc.generateFromTemplates(db, req.actor, req.params.id, req.body);
      return reply.status(201).send({ data: await svc.listBudgetLines(db, req.actor, req.params.id), created });
    },
  });
  r.get('/seasons/:id/budget-summary', {
    schema: { operationId: 'getBudgetSummary', tags: ['planning'], summary: 'Budget totals by payer, per ha and per farmer (SPEC §9.1.3 allocation)', 'x-permission': 'budget:read', params: IdParam, response: { 200: BudgetSummary } },
    handler: async (req) => {
      const { lineTotals: _l, ...rest } = await svc.budgetSummary(db, req.actor, req.params.id);
      return rest;
    },
  });
  r.patch('/budget-lines/:id', {
    schema: { operationId: 'updateBudgetLine', tags: ['planning'], 'x-permission': 'budget:manage', params: IdParam, body: BudgetLineUpdateBody, response: { 200: BudgetLine } },
    handler: async (req) => {
      const seasonId = await svc.updateBudgetLine(db, req.actor, req.params.id, requireIfMatch(req), req.body);
      return (await svc.listBudgetLines(db, req.actor, seasonId)).find((l) => l.id === req.params.id)!;
    },
  });
  r.delete('/budget-lines/:id', {
    schema: { operationId: 'deleteBudgetLine', tags: ['planning'], 'x-permission': 'budget:manage', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      await svc.deleteBudgetLine(db, req.actor, req.params.id);
      return { ok: true as const };
    },
  });

  // ---------------------------------------------------------- quotes
  r.get('/supplier-quotes', {
    schema: { operationId: 'listSupplierQuotes', tags: ['planning'], 'x-permission': 'quote:read', querystring: z.object({ serviceId: Uuid.optional() }), response: { 200: z.object({ data: z.array(SupplierQuote) }) } },
    handler: async (req) => list(await svc.listQuotes(db, req.actor, req.query.serviceId)),
  });
  r.post('/supplier-quotes', {
    schema: { operationId: 'createSupplierQuote', tags: ['planning'], 'x-permission': 'quote:manage', body: SupplierQuoteCreateBody, response: { 201: SupplierQuote } },
    handler: async (req, reply) => reply.status(201).send(await svc.createQuote(db, req.actor, req.body)),
  });

  // ---------------------------------------------------------- capex, opex, fee policy
  r.get('/blocks/:id/capex-items', {
    schema: { operationId: 'listCapexItems', tags: ['planning'], 'x-permission': 'budget:read', params: IdParam, response: { 200: z.object({ data: z.array(CapexItem) }) } },
    handler: async (req) => list(await svc.listCapex(db, req.actor, req.params.id)),
  });
  r.post('/blocks/:id/capex-items', {
    schema: { operationId: 'createCapexItem', tags: ['planning'], 'x-permission': 'capex:manage', params: IdParam, body: CapexCreateBody, response: { 201: CapexItem } },
    handler: async (req, reply) => reply.status(201).send(await svc.createCapex(db, req.actor, req.params.id, req.body)),
  });
  r.delete('/capex-items/:id', {
    schema: { operationId: 'deleteCapexItem', tags: ['planning'], 'x-permission': 'capex:manage', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      await svc.deleteCapex(db, req.actor, req.params.id);
      return { ok: true as const };
    },
  });
  r.get('/blocks/:id/operator-opex', {
    schema: { operationId: 'listOperatorOpex', tags: ['planning'], 'x-permission': 'budget:read', params: IdParam, response: { 200: z.object({ data: z.array(OpexItem) }) } },
    handler: async (req) => list(await svc.listOpex(db, req.actor, req.params.id)),
  });
  r.post('/blocks/:id/operator-opex', {
    schema: { operationId: 'createOperatorOpex', tags: ['planning'], 'x-permission': 'opex:manage', params: IdParam, body: OpexCreateBody, response: { 201: OpexItem } },
    handler: async (req, reply) => reply.status(201).send(await svc.createOpex(db, req.actor, req.params.id, req.body)),
  });
  r.delete('/operator-opex/:id', {
    schema: { operationId: 'deleteOperatorOpex', tags: ['planning'], 'x-permission': 'opex:manage', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      await svc.deleteOpex(db, req.actor, req.params.id);
      return { ok: true as const };
    },
  });
  r.get('/blocks/:id/fee-policy', {
    schema: { operationId: 'getFeePolicy', tags: ['planning'], 'x-permission': 'budget:read', params: IdParam, response: { 200: FeePolicy } },
    handler: async (req) => svc.getFeePolicy(db, req.actor, req.params.id),
  });
  r.put('/blocks/:id/fee-policy', {
    schema: { operationId: 'putFeePolicy', tags: ['planning'], 'x-permission': 'fee_policy:manage', params: IdParam, body: FeePolicyBody, response: { 200: FeePolicy } },
    handler: async (req, reply) => {
      const f = await svc.putFeePolicy(db, req.actor, req.params.id, req.body);
      setEtag(reply, f.version);
      return f;
    },
  });
}
