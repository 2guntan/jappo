import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, desc, eq, ilike, lt, ne, or, type SQL } from 'drizzle-orm';
import { AdminKycAction, AuditEntry, AuditVerifyResult, IdParam, KycDocument, KycStatus, OrgType, Organization, PageQuery, page } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import { organizations } from '../identity/schema';
import { auditLog } from '../../core/schema';
import * as identity from '../identity/service';
import { decodeCursor, toPage } from '../../core/pagination';
import { audit, verifyAuditChain } from '../../core/audit';
import { notFound } from '../../core/errors';

const AdminOrg = Organization.extend({ kycDocuments: z.array(KycDocument) });

export async function adminRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;

  r.get('/admin/orgs', {
    schema: {
      operationId: 'adminListOrgs',
      tags: ['admin'],
      summary: 'Organisations (KYC queue with filter[kycStatus]=submitted)',
      'x-permission': 'admin:read',
      querystring: PageQuery.extend({ 'filter[kycStatus]': KycStatus.optional(), 'filter[type]': OrgType.optional() }),
      response: { 200: page(Organization) },
    },
    handler: async (req) => {
      const q = req.query;
      const conds: SQL[] = [ne(organizations.type, 'platform')];
      if (q['filter[kycStatus]']) conds.push(eq(organizations.kycStatus, q['filter[kycStatus]']));
      if (q['filter[type]']) conds.push(eq(organizations.type, q['filter[type]']));
      if (q.q) conds.push(or(ilike(organizations.legalName, `%${q.q}%`), ilike(organizations.tradeName, `%${q.q}%`))!);
      const c = decodeCursor(q.cursor);
      if (c) conds.push(lt(organizations.id, c.id));
      const rows = await db.select().from(organizations).where(and(...conds)).orderBy(desc(organizations.id)).limit(q.limit + 1);
      return toPage(rows, q.limit, (o) => identity.orgDto(o, req.actor));
    },
  });

  r.get('/admin/orgs/:id', {
    schema: { operationId: 'adminGetOrg', tags: ['admin'], 'x-permission': 'admin:read', params: IdParam, response: { 200: AdminOrg } },
    handler: async (req) => {
      const o = await identity.getOrg(db, req.params.id);
      return { ...identity.orgDto(o, req.actor), kycDocuments: await identity.listKycDocs(db, o.id) };
    },
  });

  for (const decision of ['verify', 'reject'] as const) {
    r.post(`/admin/orgs/:id/kyc/actions/${decision}`, {
      schema: {
        operationId: decision === 'verify' ? 'adminVerifyOrgKyc' : 'adminRejectOrgKyc',
        tags: ['admin'],
        'x-permission': 'admin:kyc_review',
        params: IdParam,
        body: AdminKycAction,
        response: { 200: Organization },
      },
      handler: async (req) => identity.orgDto(await identity.reviewKyc(db, req.actor, req.params.id, decision, req.body.comment), req.actor),
    });
  }

  for (const action of ['suspend', 'reactivate'] as const) {
    r.post(`/admin/orgs/:id/actions/${action}`, {
      schema: { operationId: action === 'suspend' ? 'adminSuspendOrg' : 'adminReactivateOrg', tags: ['admin'], 'x-permission': 'admin:orgs', params: IdParam, body: AdminKycAction, response: { 200: Organization } },
      handler: async (req) => {
        const o = await db.transaction(async (tx) => {
          const before = await identity.getOrg(tx, req.params.id);
          if (before.type === 'platform') throw notFound('Organisation');
          const status = action === 'suspend' ? ('suspended' as const) : ('active' as const);
          const [after] = await tx.update(organizations).set({ status, version: before.version + 1 }).where(eq(organizations.id, before.id)).returning();
          await audit(tx, req.actor, { action: `org.${action}ed`, resourceType: 'organization', resourceId: before.id, before: { status: before.status }, after: { status, comment: req.body.comment } });
          return after!;
        });
        return identity.orgDto(o, req.actor);
      },
    });
  }

  r.get('/admin/audit', {
    schema: {
      operationId: 'adminListAudit',
      tags: ['admin'],
      'x-permission': 'admin:read',
      querystring: PageQuery.extend({ 'filter[resourceType]': z.string().optional(), 'filter[resourceId]': z.string().optional(), 'filter[orgId]': z.uuid().optional() }),
      response: { 200: page(AuditEntry) },
    },
    handler: async (req) => {
      const q = req.query;
      const conds: SQL[] = [];
      if (q['filter[resourceType]']) conds.push(eq(auditLog.resourceType, q['filter[resourceType]']));
      if (q['filter[resourceId]']) conds.push(eq(auditLog.resourceId, q['filter[resourceId]']));
      if (q['filter[orgId]']) conds.push(eq(auditLog.orgId, q['filter[orgId]']));
      const c = decodeCursor(q.cursor);
      if (c) conds.push(lt(auditLog.seq, Number(c.v)));
      const rows = await db.select().from(auditLog).where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLog.seq)).limit(q.limit + 1);
      return toPage(
        rows,
        q.limit,
        (a) => ({ id: a.id, seq: a.seq, at: a.at.toISOString(), actorType: a.actorType, actorId: a.actorId, orgId: a.orgId, action: a.action, resourceType: a.resourceType, resourceId: a.resourceId, hash: a.hash }),
        (a) => a.seq,
      );
    },
  });

  r.post('/admin/audit/actions/verify', {
    schema: { operationId: 'adminVerifyAuditChain', tags: ['admin'], summary: 'Verify the audit hash chain', 'x-permission': 'admin:read', response: { 200: AuditVerifyResult } },
    handler: async () => verifyAuditChain(db),
  });

}
