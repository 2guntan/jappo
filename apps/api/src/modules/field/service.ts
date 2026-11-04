import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { FarmerCreateBody, FarmerUpdateBody, GeoPolygon, type SYNC_OP_TYPES } from '@jappo/contracts';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { fieldSyncOps } from './schema';
import { farmers } from '../farmers/schema';
import { blocks, plotAllocations, plots } from '../land/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, requireOrg } from '../../core/context';
import { AppError } from '../../core/errors';
import { asGeoJson } from '../../core/geo';
import { hasPermission } from '../../core/authz/permissions';
import * as farmerSvc from '../farmers/service';
import * as landSvc from '../land/service';

type Op = { clientId: string; type: string; payload: Record<string, unknown>; createdAt: string };
type Result = { clientId: string; status: 'applied' | 'duplicate' | 'rejected'; entityId: string | null; error: { code: string; message: string } | null };

const OP_PERMISSIONS: Record<(typeof SYNC_OP_TYPES)[number], string> = {
  'farmer.create': 'farmer:create',
  'farmer.update': 'farmer:update',
  'plot.create': 'plot:create',
  'plot.updateGeometry': 'plot:update',
  'allocation.create': 'allocation:manage',
  'photo.attach': 'farmer:update',
};

const FarmerCreateOp = FarmerCreateBody.extend({ clientRef: z.string().optional() });
const FarmerUpdateOp = z.object({ farmerId: z.uuid(), baseVersion: z.number().int(), changes: FarmerUpdateBody });
const PlotCreateOp = z.object({ blockId: z.uuid(), code: z.string().optional(), geometry: GeoPolygon, soilType: z.string().nullable().optional() });
const PlotGeomOp = z.object({ plotId: z.uuid(), baseVersion: z.number().int(), geometry: GeoPolygon });
/** Ops may reference entities created earlier in the same batch by their clientId (`farmerClientId`). */
const AllocationOp = z.object({ plotId: z.uuid(), farmerId: z.uuid().optional(), farmerClientId: z.string().optional(), sharePct: z.number().gt(0).max(100).default(100) });
const PhotoOp = z.object({ farmerId: z.uuid().optional(), farmerClientId: z.string().optional(), fileId: z.uuid(), kind: z.enum(['photo', 'id_photo']) });

/** Rows for offline use; PII is masked (SPEC §10.13). */
async function snapshot(db: Db, actor: ActorContext, blockIds: string[], since?: Date) {
  const orgId = requireOrg(actor);
  const changed = (col: typeof farmers.updatedAt | typeof plots.updatedAt | typeof plotAllocations.updatedAt) => (since ? gt(col, since) : undefined);
  const bs = blockIds.length
    ? await db.select({ id: blocks.id, ref: blocks.ref, name: blocks.name, village: blocks.village, status: blocks.status, boundary: asGeoJson(blocks.boundary), version: blocks.version }).from(blocks).where(and(inArray(blocks.id, blockIds), eq(blocks.ownerOrgId, orgId)))
    : [];
  const ids = bs.map((b) => b.id);
  const ps = ids.length
    ? await db.select({ id: plots.id, blockId: plots.blockId, code: plots.code, areaHa: plots.areaHa, status: plots.status, geometry: asGeoJson(plots.geometry), version: plots.version, archivedAt: plots.archivedAt }).from(plots).where(and(inArray(plots.blockId, ids), changed(plots.updatedAt)))
    : [];
  const fs = await db
    .select({ f: farmers })
    .from(farmers)
    .where(and(eq(farmers.ownerOrgId, orgId), isNull(farmers.pseudonymisedAt), changed(farmers.updatedAt)));
  const as = ids.length ? await db.select().from(plotAllocations).where(and(inArray(plotAllocations.blockId, ids), changed(plotAllocations.updatedAt))) : [];
  return {
    blocks: bs,
    plots: ps.map((p) => ({ ...p, areaHa: Number(p.areaHa), archived: p.archivedAt !== null, archivedAt: undefined })),
    farmers: fs.map(({ f }) => ({
      id: f.id,
      code: f.code,
      firstName: f.firstName,
      lastName: f.lastName,
      sex: f.sex,
      birthYear: f.birthYear,
      phone: f.phone,
      village: f.village,
      kycStatus: f.kycStatus,
      walletVerified: f.walletVerifiedAt !== null,
      mobileWalletNumberMasked: f.mobileWalletLast4 ? `**** ${f.mobileWalletLast4}` : null,
      status: f.status,
      version: f.version,
    })),
    allocations: as.map((a) => ({ id: a.id, plotId: a.plotId, farmerId: a.farmerId, sharePct: Number(a.sharePct), status: a.status, version: a.version })),
  };
}

export async function bootstrap(db: Db, actor: ActorContext, blockIds: string[]) {
  const syncToken = new Date().toISOString();
  const s = await snapshot(db, actor, blockIds);
  return { syncToken, ...s, plantings: [], budgetLines: [], templates: [], lastVisits: [] };
}

function rejected(clientId: string, code: string, message: string): Result {
  return { clientId, status: 'rejected', entityId: null, error: { code, message } };
}

/** Apply a batch of offline operations; idempotent by clientId (SPEC §10.13, §12.8 conflict policy). */
export async function sync(db: Db, actor: ActorContext, body: { syncToken?: string; blockIds: string[]; ops: Op[] }) {
  const orgId = requireOrg(actor);
  const results: Result[] = [];
  const createdByClientId = new Map<string, string>();
  const syncStart = new Date();
  for (const op of body.ops) {
    const [prev] = await db.select().from(fieldSyncOps).where(and(eq(fieldSyncOps.orgId, orgId), eq(fieldSyncOps.clientId, op.clientId)));
    if (prev) {
      if (prev.entityId) createdByClientId.set(op.clientId, prev.entityId);
      results.push({ clientId: op.clientId, status: prev.status === 'applied' ? 'duplicate' : 'rejected', entityId: prev.entityId, error: (prev.error as Result['error']) ?? null });
      continue;
    }
    let res: Result;
    const perm = OP_PERMISSIONS[op.type as keyof typeof OP_PERMISSIONS];
    if (!perm) res = rejected(op.clientId, 'UNSUPPORTED_OP', `Unsupported operation ${op.type}`);
    else if (!hasPermission(actor.permissions, perm)) res = rejected(op.clientId, 'FORBIDDEN', `Missing permission ${perm}`);
    else {
      try {
        const entityId = await db.transaction(async (tx) => {
          const resolveFarmer = (p: { farmerId?: string; farmerClientId?: string }) => {
            const id = p.farmerId ?? (p.farmerClientId ? createdByClientId.get(p.farmerClientId) : undefined);
            if (!id) throw new AppError(422, 'DEPENDENCY_MISSING', 'Unprocessable', 'Referenced farmer was not created');
            return id;
          };
          switch (op.type) {
            case 'farmer.create':
              return farmerSvc.createFarmer(tx, actor, FarmerCreateOp.parse(op.payload));
            case 'farmer.update': {
              const p = FarmerUpdateOp.parse(op.payload);
              const [f] = await tx.select({ version: farmers.version }).from(farmers).where(and(eq(farmers.id, p.farmerId), eq(farmers.ownerOrgId, orgId)));
              if (!f) throw new AppError(404, 'NOT_FOUND', 'Not Found', 'Farmer not found');
              // Server wins when office users edited the record after the client's base version.
              if (f.version !== p.baseVersion) throw new AppError(409, 'SYNC_CONFLICT', 'Conflict', `Server version ${f.version} differs from base ${p.baseVersion}`);
              await farmerSvc.updateFarmer(tx, actor, p.farmerId, p.baseVersion, p.changes);
              return p.farmerId;
            }
            case 'plot.create': {
              const p = PlotCreateOp.parse(op.payload);
              return landSvc.createPlot(tx, actor, p.blockId, p);
            }
            case 'plot.updateGeometry': {
              const p = PlotGeomOp.parse(op.payload);
              const { p: plot } = await landSvc.loadPlot(tx, actor, p.plotId, true);
              if (plot.version !== p.baseVersion) throw new AppError(409, 'SYNC_CONFLICT', 'Conflict', `Server version ${plot.version} differs from base ${p.baseVersion}`);
              await landSvc.updatePlot(tx, actor, p.plotId, p.baseVersion, { geometry: p.geometry });
              return p.plotId;
            }
            case 'allocation.create': {
              const p = AllocationOp.parse(op.payload);
              return (await landSvc.allocate(tx, actor, p.plotId, { farmerId: resolveFarmer(p), sharePct: p.sharePct })).id;
            }
            case 'photo.attach': {
              const p = PhotoOp.parse(op.payload);
              const farmerId = resolveFarmer(p);
              const [f] = await tx.select().from(farmers).where(and(eq(farmers.id, farmerId), eq(farmers.ownerOrgId, orgId)));
              if (!f) throw new AppError(404, 'NOT_FOUND', 'Not Found', 'Farmer not found');
              await farmerSvc.updateFarmer(tx, actor, farmerId, f.version, p.kind === 'photo' ? { photoFileId: p.fileId } : { idPhotoFileId: p.fileId });
              return farmerId;
            }
            default:
              throw new AppError(422, 'UNSUPPORTED_OP', 'Unprocessable', op.type);
          }
        });
        res = { clientId: op.clientId, status: 'applied', entityId, error: null };
      } catch (e) {
        const err = e instanceof AppError ? { code: e.code, message: e.detail ?? e.title } : e instanceof z.ZodError ? { code: 'VALIDATION_FAILED', message: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } : { code: 'INTERNAL', message: 'Operation failed' };
        res = rejected(op.clientId, err.code, err.message);
      }
    }
    if (res.entityId) createdByClientId.set(op.clientId, res.entityId);
    await db
      .insert(fieldSyncOps)
      .values({ orgId, clientId: op.clientId, type: op.type, userId: actorUserId(actor), clientCreatedAt: new Date(op.createdAt), status: res.status === 'rejected' ? 'rejected' : 'applied', entityId: res.entityId, error: res.error })
      .onConflictDoNothing();
    results.push(res);
  }
  const since = body.syncToken && !Number.isNaN(Date.parse(body.syncToken)) ? new Date(body.syncToken) : undefined;
  const changes = await snapshot(db, actor, body.blockIds, since);
  return { results, syncToken: syncStart.toISOString(), changes: { farmers: changes.farmers, plots: changes.plots, allocations: changes.allocations } };
}
