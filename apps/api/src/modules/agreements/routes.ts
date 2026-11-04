import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Contract, ContractCreateBody, ContractListQuery, ContractTemplate, ContractTemplateUpdateBody, ContractUpdateBody, ContractVoidBody, GeneratePackBody, IdParam, SignatureOtpBody,
  SignatureOtpResult, SignBody, CONTRACT_TYPES,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch, setEtag } from '../../core/etag';
import { conflict } from '../../core/errors';
import { audit } from '../../core/audit';
import { getVisibleFile } from '../files/service';

export async function agreementRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const out = async (actor: Parameters<typeof svc.contractDto>[1], id: string) => svc.contractDto(db, actor, await svc.loadContract(db, actor, id));

  r.get('/contract-templates', {
    schema: { operationId: 'listContractTemplates', tags: ['agreements'], 'x-permission': 'contract:read', querystring: z.object({ code: z.enum(CONTRACT_TYPES).optional(), locale: z.enum(['fr', 'en']).optional(), includeInactive: z.coerce.boolean().optional() }), response: { 200: z.object({ data: z.array(ContractTemplate) }) } },
    handler: async (q) => ({ data: await svc.listTemplates(db, q.query) }),
  });
  r.patch('/contract-templates/:id', {
    schema: { operationId: 'reviseContractTemplate', tags: ['agreements'], summary: 'Platform admin: creates a new active template version. Template text must be reviewed by counsel before production use.', 'x-permission': 'contract_template:manage', params: IdParam, body: ContractTemplateUpdateBody, response: { 200: ContractTemplate } },
    handler: async (q) => svc.reviseTemplate(db, q.actor, q.params.id, requireIfMatch(q), q.body),
  });

  r.get('/contracts', {
    schema: { operationId: 'listContracts', tags: ['agreements'], 'x-permission': 'contract:read', querystring: ContractListQuery, response: { 200: z.object({ data: z.array(Contract) }) } },
    handler: async (q) => ({ data: await svc.listContracts(db, q.actor, q.query) }),
  });
  r.post('/contracts', {
    schema: { operationId: 'createContract', tags: ['agreements'], summary: 'Type + related entity; data assembled from block, season, award, offtake', 'x-permission': 'contract:manage', body: ContractCreateBody, response: { 201: Contract } },
    handler: async (q, reply) => reply.status(201).send(await svc.contractDto(db, q.actor, await svc.createContract(db, q.actor, q.body))),
  });
  r.get('/contracts/:id', {
    schema: { operationId: 'getContract', tags: ['agreements'], 'x-permission': 'contract:read', params: IdParam, response: { 200: Contract } },
    handler: async (q, reply) => {
      const c = await out(q.actor, q.params.id);
      setEtag(reply, c.version);
      return c;
    },
  });
  r.patch('/contracts/:id', {
    schema: { operationId: 'updateContract', tags: ['agreements'], summary: 'Draft only: editable clauses; `refresh` re-assembles data from source entities', 'x-permission': 'contract:manage', params: IdParam, body: ContractUpdateBody, response: { 200: Contract } },
    handler: async (q) => {
      await svc.updateContract(db, q.actor, q.params.id, requireIfMatch(q), q.body);
      return out(q.actor, q.params.id);
    },
  });
  r.get('/contracts/:id/pdf', {
    schema: { operationId: 'getContractPdf', tags: ['agreements'], summary: 'Signed URL of the contract PDF (signed version once fully signed)', 'x-permission': 'contract:read', params: IdParam, response: { 200: z.object({ url: z.string(), fileId: z.string(), signed: z.boolean() }) } },
    handler: async (q) => {
      const c = await svc.loadContract(db, q.actor, q.params.id);
      const fileId = c.signedPdfFileId ?? c.pdfFileId;
      if (!fileId) throw conflict('PDF_NOT_AVAILABLE', 'The PDF is produced when the contract is sent for signature');
      const f = await getVisibleFile(db, q.actor, fileId);
      if (f.ownerOrgId !== q.actor.orgId) await db.transaction((tx) => audit(tx, q.actor, { action: 'contract.pdf_downloaded', resourceType: 'contract', resourceId: c.id }));
      return { url: await ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300), fileId: f.id, signed: Boolean(c.signedPdfFileId) };
    },
  });
  r.post('/contracts/:id/actions/send', {
    schema: { operationId: 'sendContract', tags: ['agreements'], summary: 'Render, fix the content hash, store the PDF, notify signatories', 'x-permission': 'contract:manage', params: IdParam, response: { 200: Contract } },
    handler: async (q) => {
      await svc.sendContract(ctx, q.actor, q.params.id, requireIfMatch(q));
      return out(q.actor, q.params.id);
    },
  });
  r.post('/contracts/:id/actions/void', {
    schema: { operationId: 'voidContract', tags: ['agreements'], 'x-permission': 'contract:manage', params: IdParam, body: ContractVoidBody, response: { 200: Contract } },
    handler: async (q) => {
      await svc.voidContract(db, q.actor, q.params.id, requireIfMatch(q), q.body.reason);
      return out(q.actor, q.params.id);
    },
  });
  r.post('/contracts/:id/signatures/actions/request-otp', {
    schema: { operationId: 'requestSignatureOtp', tags: ['agreements'], summary: "Send a signature code to the current principal's party (or a farmer party, for field agents)", 'x-permission': 'contract:read', params: IdParam, body: SignatureOtpBody, response: { 202: SignatureOtpResult } },
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    handler: async (q, reply) => reply.status(202).send(await svc.requestSignatureOtp(db, q.actor, q.params.id, q.body)),
  });
  r.post('/contracts/:id/signatures', {
    schema: { operationId: 'signContract', tags: ['agreements'], summary: 'Sign with the OTP code; or in person (field agent witness + photo) for farmers', 'x-permission': 'contract:read', params: IdParam, body: SignBody, response: { 200: Contract } },
    handler: async (q) => {
      await svc.signContract(ctx, q.actor, q.params.id, q.body);
      return out(q.actor, q.params.id);
    },
  });
  r.post('/blocks/:id/contracts/actions/generate-pack', {
    schema: { operationId: 'generateContractPack', tags: ['agreements'], summary: 'Framework, plot contracts for allocated farmers, offtake, loan contracts from facilities, escrow mandate', 'x-permission': 'contract:manage', params: IdParam, body: GeneratePackBody, response: { 200: z.object({ created: z.number().int(), data: z.array(Contract) }) } },
    handler: async (q) => {
      const ids = await svc.generatePack(ctx, q.actor, q.params.id, q.body);
      return { created: ids.length, data: await svc.listContracts(db, q.actor, { blockId: q.params.id, seasonId: q.body.seasonId }) };
    },
  });
}
