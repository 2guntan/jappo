import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BlockDashboard, GuarantorDashboard, IdParam, KpiQuery, KpiSeries, LenderDashboard, OperatorDashboard, Report, ReportCreateBody } from '@jappo/contracts';
import { eq } from 'drizzle-orm';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { conflict } from '../../core/errors';
import { files } from '../../core/schema';

export async function monitoringRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/dashboards/operator', {
    schema: { operationId: 'getOperatorDashboard', tags: ['monitoring'], summary: 'KPIs, blocks by status, open alerts, tasks', 'x-permission': 'dashboard:read', response: { 200: OperatorDashboard } },
    handler: async (q) => svc.operatorDashboard(db, q.actor),
  });
  r.get('/dashboards/lender', {
    schema: { operationId: 'getLenderDashboard', tags: ['monitoring'], summary: 'Portfolio KPIs (outstanding, PAR, repayment rate) and pending approvals', 'x-permission': 'dashboard:read', response: { 200: LenderDashboard } },
    handler: async (q) => svc.lenderDashboard(db, q.actor),
  });
  r.get('/dashboards/block/:id', {
    schema: { operationId: 'getBlockDashboard', tags: ['monitoring'], 'x-permission': 'dashboard:read', params: IdParam, response: { 200: BlockDashboard } },
    handler: async (q) => svc.blockDashboard(db, q.actor, q.params.id),
  });
  r.get('/dashboards/guarantor', {
    schema: { operationId: 'getGuarantorDashboard', tags: ['monitoring'], summary: 'Covered facilities, exposure, PAR, claim candidates', 'x-permission': 'dashboard:read', response: { 200: GuarantorDashboard } },
    handler: async (q) => svc.guarantorDashboard(db, q.actor),
  });
  r.get('/kpis', {
    schema: { operationId: 'listKpis', tags: ['monitoring'], summary: 'Nightly KPI snapshots for a scope', 'x-permission': 'kpi:read', querystring: KpiQuery, response: { 200: KpiSeries } },
    handler: async (q) => ({ data: await svc.listKpis(db, q.actor, q.query) }),
  });
  r.get('/reports', {
    schema: { operationId: 'listReports', tags: ['monitoring'], 'x-permission': 'report:read', response: { 200: z.object({ data: z.array(Report) }) } },
    handler: async (q) => ({ data: await svc.listReports(db, q.actor) }),
  });
  r.post('/reports', {
    schema: { operationId: 'createReport', tags: ['monitoring'], summary: 'Generate a PDF report (lender monthly, season close, guarantor portfolio)', 'x-permission': 'report:create', body: ReportCreateBody, response: { 201: Report } },
    handler: async (q, reply) => reply.status(201).send(await svc.createReport(ctx, q.actor, q.body)),
  });
  r.get('/reports/:id', {
    schema: { operationId: 'getReport', tags: ['monitoring'], 'x-permission': 'report:read', params: IdParam, response: { 200: Report.extend({ url: z.string().nullable() }) } },
    handler: async (q) => {
      const rep = await svc.getReport(db, q.actor, q.params.id);
      if (!rep.pdfFileId) throw conflict('REPORT_PENDING', 'The report is being generated');
      const [f] = await db.select().from(files).where(eq(files.id, rep.pdfFileId));
      return { ...svc.reportDto(rep), url: f ? await ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300) : null };
    },
  });
}
