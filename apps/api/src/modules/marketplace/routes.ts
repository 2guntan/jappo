import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AnswerBody, Award, AwardBody, AwardResponseBody, Bid, BidCreateBody, BidPreview, BidPreviewBody, BidUpdateBody, Evaluation, FinancingRequest, FinancingRequestCreateBody,
  FinancingRequestUpdateBody, IdParam, LenderMatch, LenderProfile, LenderProfileCreateBody, LenderProfileUpdateBody, Ok, Opportunity, Question, QuestionCreateBody, Rfp,
  RfpActionBody, RfpCreateBody, Uuid,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as req from './requests';
import * as rfp from './rfp';
import { requireIfMatch, setEtag } from '../../core/etag';
import { notFound } from '../../core/errors';

export async function marketplaceRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const rfpOut = async (actor: Parameters<typeof rfp.rfpDto>[1], id: string) => {
    const { rfp: row, role } = await rfp.loadRfp(db, actor, id);
    return rfp.rfpDto(db, actor, row, role);
  };

  // ---------------------------------------------------------- lender profiles
  r.get('/lender-profiles', {
    schema: { operationId: 'listLenderProfiles', tags: ['marketplace'], 'x-permission': 'lender_profile:read', response: { 200: z.object({ data: z.array(LenderProfile) }) } },
    handler: async (q) => ({ data: await req.listProfiles(db, q.actor) }),
  });
  r.post('/lender-profiles', {
    schema: { operationId: 'createLenderProfile', tags: ['marketplace'], 'x-permission': 'lender_profile:manage', body: LenderProfileCreateBody, response: { 201: LenderProfile } },
    handler: async (q, reply) => reply.status(201).send(await req.createProfile(db, q.actor, q.body)),
  });
  r.patch('/lender-profiles/:id', {
    schema: { operationId: 'updateLenderProfile', tags: ['marketplace'], 'x-permission': 'lender_profile:manage', params: IdParam, body: LenderProfileUpdateBody, response: { 200: LenderProfile } },
    handler: async (q) => req.updateProfile(db, q.actor, q.params.id, requireIfMatch(q), q.body),
  });
  r.get('/lender-profiles/:id/preview', {
    schema: { operationId: 'previewLenderProfile', tags: ['marketplace'], summary: 'How many open financing requests this profile matches', 'x-permission': 'lender_profile:read', params: IdParam, response: { 200: z.object({ matchingRequests: z.number().int(), openRequests: z.number().int() }) } },
    handler: async (q) => req.profilePreview(db, q.actor, q.params.id),
  });

  // ---------------------------------------------------------- financing requests (operator)
  r.get('/financing-requests', {
    schema: { operationId: 'listFinancingRequests', tags: ['marketplace'], 'x-permission': 'financing_request:read', querystring: z.object({ seasonId: Uuid.optional() }), response: { 200: z.object({ data: z.array(FinancingRequest) }) } },
    handler: async (q) => ({ data: await req.listRequests(db, q.actor, q.query.seasonId) }),
  });
  r.post('/financing-requests', {
    schema: { operationId: 'createFinancingRequest', tags: ['marketplace'], summary: 'From a frozen dossier; tranches default from the model assumptions', 'x-permission': 'financing_request:manage', body: FinancingRequestCreateBody, response: { 201: FinancingRequest } },
    handler: async (q, reply) => reply.status(201).send(await req.requestDto(db, q.actor, await req.createRequest(db, q.actor, q.body))),
  });
  r.get('/financing-requests/:id', {
    schema: { operationId: 'getFinancingRequest', tags: ['marketplace'], 'x-permission': 'financing_request:read', params: IdParam, response: { 200: FinancingRequest } },
    handler: async (q, reply) => {
      const fr = await req.loadRequest(db, q.actor, q.params.id);
      setEtag(reply, fr.version);
      return req.requestDto(db, q.actor, fr);
    },
  });
  r.patch('/financing-requests/:id', {
    schema: { operationId: 'updateFinancingRequest', tags: ['marketplace'], 'x-permission': 'financing_request:manage', params: IdParam, body: FinancingRequestUpdateBody, response: { 200: FinancingRequest } },
    handler: async (q) => req.requestDto(db, q.actor, await req.updateRequest(db, q.actor, q.params.id, requireIfMatch(q), q.body.tranches)),
  });
  r.post('/financing-requests/:id/actions/submit', {
    schema: { operationId: 'submitFinancingRequest', tags: ['marketplace'], 'x-permission': 'financing_request:submit', params: IdParam, response: { 200: FinancingRequest } },
    handler: async (q) => req.requestDto(db, q.actor, await req.submitRequest(db, q.actor, q.params.id, requireIfMatch(q))),
  });
  r.post('/financing-requests/:id/actions/cancel', {
    schema: { operationId: 'cancelFinancingRequest', tags: ['marketplace'], 'x-permission': 'financing_request:manage', params: IdParam, body: RfpActionBody, response: { 200: FinancingRequest } },
    handler: async (q) => req.requestDto(db, q.actor, await req.cancelRequest(db, q.actor, q.params.id, requireIfMatch(q), q.body.reason)),
  });
  r.get('/financing-requests/:id/matches', {
    schema: { operationId: 'getFinancingRequestMatches', tags: ['marketplace'], 'x-permission': 'financing_request:read', params: IdParam, response: { 200: z.object({ data: z.array(LenderMatch) }) } },
    handler: async (q) => ({ data: await req.matches(db, q.actor, q.params.id) }),
  });

  // ---------------------------------------------------------- RFPs
  r.post('/rfps', {
    schema: { operationId: 'createRfp', tags: ['marketplace'], summary: 'Create a draft RFP; invitees default to all matching lenders', 'x-permission': 'rfp:manage', body: RfpCreateBody, response: { 201: Rfp } },
    handler: async (q, reply) => reply.status(201).send(await rfpOut(q.actor, (await rfp.createRfp(db, q.actor, q.body)).id)),
  });
  r.get('/rfps/:id', {
    schema: { operationId: 'getRfp', tags: ['marketplace'], 'x-permission': 'rfp:read', params: IdParam, response: { 200: Rfp } },
    handler: async (q, reply) => {
      const out = await rfpOut(q.actor, q.params.id);
      setEtag(reply, out.version);
      return out;
    },
  });
  for (const action of ['open', 'extend', 'close-early', 'cancel'] as const) {
    r.post(`/rfps/:id/actions/${action}`, {
      schema: { operationId: { open: 'openRfp', extend: 'extendRfp', 'close-early': 'closeRfpEarly', cancel: 'cancelRfp' }[action], tags: ['marketplace'], 'x-permission': 'rfp:manage', params: IdParam, body: RfpActionBody, response: { 200: Rfp } },
      handler: async (q) => {
        const id = q.params.id;
        if (action === 'open') await rfp.openRfp(db, q.actor, id, requireIfMatch(q));
        else if (action === 'extend') await rfp.extendRfp(db, q.actor, id, requireIfMatch(q), q.body.workingDays);
        else if (action === 'cancel') await rfp.cancelRfp(db, q.actor, id, requireIfMatch(q), q.body.reason);
        else {
          const { role } = await rfp.loadRfp(db, q.actor, id);
          if (role !== 'operator') throw notFound('RFP');
          await rfp.closeRfp(db, q.actor, id, 'close_early');
        }
        return rfpOut(q.actor, id);
      },
    });
  }
  for (const action of ['view', 'decline'] as const) {
    r.post(`/rfps/:id/actions/${action}`, {
      schema: { operationId: action === 'view' ? 'viewRfp' : 'declineRfp', tags: ['marketplace'], 'x-permission': 'rfp:respond', params: IdParam, body: RfpActionBody, response: { 200: Rfp } },
      handler: async (q) => {
        await rfp.respondInvitation(db, q.actor, q.params.id, action, q.body.reason);
        return rfpOut(q.actor, q.params.id);
      },
    });
  }
  r.get('/lender/opportunities', {
    schema: { operationId: 'listOpportunities', tags: ['marketplace'], summary: 'Invitations of the current lender with RFP summary', 'x-permission': 'rfp:read', response: { 200: z.object({ data: z.array(Opportunity) }) } },
    handler: async (q) => ({ data: await rfp.opportunities(db, q.actor) }),
  });

  // ---------------------------------------------------------- Q&A
  r.get('/rfps/:id/questions', {
    schema: { operationId: 'listRfpQuestions', tags: ['marketplace'], 'x-permission': 'rfp:read', params: IdParam, response: { 200: z.object({ data: z.array(Question) }) } },
    handler: async (q) => ({ data: await rfp.listQuestions(db, q.actor, q.params.id) }),
  });
  r.post('/rfps/:id/questions', {
    schema: { operationId: 'askRfpQuestion', tags: ['marketplace'], 'x-permission': 'rfp_question:ask', params: IdParam, body: QuestionCreateBody, response: { 201: z.object({ data: z.array(Question) }) } },
    handler: async (q, reply) => {
      await rfp.askQuestion(db, q.actor, q.params.id, q.body.question);
      return reply.status(201).send({ data: await rfp.listQuestions(db, q.actor, q.params.id) });
    },
  });
  r.post('/rfps/:id/questions/:qid/answer', {
    schema: { operationId: 'answerRfpQuestion', tags: ['marketplace'], 'x-permission': 'rfp_question:answer', params: z.object({ id: Uuid, qid: Uuid }), body: AnswerBody, response: { 200: z.object({ data: z.array(Question) }) } },
    handler: async (q) => {
      await rfp.answerQuestion(db, q.actor, q.params.id, q.params.qid, q.body.answer, q.body.publish);
      return { data: await rfp.listQuestions(db, q.actor, q.params.id) };
    },
  });

  // ---------------------------------------------------------- bids
  r.get('/rfps/:id/bids', {
    schema: { operationId: 'listRfpBids', tags: ['marketplace'], summary: 'Lenders: own bids. Operator: all bids, only after close (sealed)', 'x-permission': 'bid:read', params: IdParam, response: { 200: z.object({ data: z.array(Bid) }) } },
    handler: async (q) => ({ data: await rfp.listBids(db, q.actor, q.params.id) }),
  });
  r.post('/rfps/:id/bids', {
    schema: { operationId: 'createBid', tags: ['marketplace'], 'x-permission': 'bid:draft', params: IdParam, body: BidCreateBody, response: { 201: Bid } },
    handler: async (q, reply) => reply.status(201).send(await rfp.bidOut(db, q.actor, await rfp.createBid(db, q.actor, q.params.id, q.body))),
  });
  r.post('/bids/preview', {
    schema: { operationId: 'previewBid', tags: ['marketplace'], summary: 'Live EAR and schedule for bid terms', 'x-permission': 'bid:draft', body: BidPreviewBody, response: { 200: BidPreview } },
    handler: async (q) => rfp.previewBid(q.body),
  });
  r.get('/bids/:id', {
    schema: { operationId: 'getBid', tags: ['marketplace'], 'x-permission': 'bid:read', params: IdParam, response: { 200: Bid } },
    handler: async (q) => rfp.bidOut(db, q.actor, q.params.id),
  });
  r.patch('/bids/:id', {
    schema: { operationId: 'updateBid', tags: ['marketplace'], 'x-permission': 'bid:draft', params: IdParam, body: BidUpdateBody, response: { 200: Bid } },
    handler: async (q) => {
      await rfp.updateBid(db, q.actor, q.params.id, requireIfMatch(q), q.body);
      return rfp.bidOut(db, q.actor, q.params.id);
    },
  });
  for (const action of ['submit', 'withdraw'] as const) {
    r.post(`/bids/:id/actions/${action}`, {
      schema: { operationId: action === 'submit' ? 'submitBid' : 'withdrawBid', tags: ['marketplace'], 'x-permission': 'bid:submit', params: IdParam, response: { 200: Bid } },
      handler: async (q) => {
        if (action === 'submit') await rfp.submitBid(db, q.actor, q.params.id, requireIfMatch(q));
        else await rfp.withdrawBid(db, q.actor, q.params.id, requireIfMatch(q));
        return rfp.bidOut(db, q.actor, q.params.id);
      },
    });
  }

  // ---------------------------------------------------------- evaluation & awards
  r.get('/rfps/:id/evaluation', {
    schema: { operationId: 'getRfpEvaluation', tags: ['marketplace'], summary: 'Scores, ranks, suggested allocation (after close)', 'x-permission': 'rfp:manage', params: IdParam, response: { 200: Evaluation } },
    handler: async (q) => rfp.evaluation(db, q.actor, q.params.id),
  });
  r.post('/rfps/:id/actions/award', {
    schema: { operationId: 'awardRfp', tags: ['marketplace'], 'x-permission': 'award:decide', params: IdParam, body: AwardBody, response: { 200: Rfp } },
    handler: async (q) => {
      await rfp.award(db, q.actor, q.params.id, requireIfMatch(q), q.body.awards);
      return rfpOut(q.actor, q.params.id);
    },
  });
  r.get('/rfps/:id/awards', {
    schema: { operationId: 'listRfpAwards', tags: ['marketplace'], 'x-permission': 'rfp:read', params: IdParam, response: { 200: z.object({ data: z.array(Award) }) } },
    handler: async (q) => ({ data: await rfp.listAwards(db, q.actor, q.params.id) }),
  });
  r.get('/lender/awards', {
    schema: { operationId: 'listLenderAwards', tags: ['marketplace'], 'x-permission': 'rfp:read', response: { 200: z.object({ data: z.array(Award) }) } },
    handler: async (q) => ({ data: await rfp.listAwards(db, q.actor) }),
  });
  for (const action of ['accept', 'decline'] as const) {
    r.post(`/awards/:id/actions/${action}`, {
      schema: { operationId: action === 'accept' ? 'acceptAward' : 'declineAward', tags: ['marketplace'], 'x-permission': 'award:respond', params: IdParam, body: AwardResponseBody, response: { 200: Ok } },
      handler: async (q) => {
        await rfp.respondAward(db, q.actor, q.params.id, action, q.body.reason);
        return { ok: true as const };
      },
    });
  }
}
