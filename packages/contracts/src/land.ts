import { z } from 'zod';
import { AllowedActions, IsoDate, IsoDateTime, Pct, Uuid } from './common';
import { GeoArea, GeoMultiPolygon, GeoPoint, GeoPolygon } from './geo';

export const WATER_SOURCES = ['borehole', 'river', 'canal', 'rainfed', 'other'] as const;
export const IRRIGATION_TYPES = ['none', 'drip', 'sprinkler', 'furrow', 'pivot'] as const;
export const TENURE_TYPES = ['title_foncier', 'bail', 'deliberation', 'customary_agreement'] as const;
export const LAND_DOC_TYPES = ['title_foncier', 'bail', 'deliberation', 'approval_prefect', 'community_agreement', 'cahier_des_charges', 'survey_plan', 'other'] as const;
export const LAND_DOC_STATUSES = ['submitted', 'verified', 'rejected', 'expired'] as const;
export const PLOT_STATUSES = ['available', 'allocated', 'fallow', 'excluded'] as const;
export const ASSET_TYPES = ['borehole', 'solar_pump', 'irrigation_network', 'fence', 'storage', 'equipment', 'building', 'other'] as const;
export const GRIEVANCE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const BLOCK_STATUSES = ['draft', 'documenting', 'ready', 'in_financing', 'financed', 'active', 'archived'] as const;

const BlockFields = z.object({
  name: z.string().trim().min(2).max(200),
  region: z.string().trim().min(2).max(100),
  department: z.string().max(100).nullable(),
  commune: z.string().max(100).nullable(),
  village: z.string().max(100).nullable(),
  waterSource: z.enum(WATER_SOURCES),
  irrigationType: z.enum(IRRIGATION_TYPES),
  tenureType: z.enum(TENURE_TYPES),
  farmerGroupOrgId: Uuid.nullable(),
  solidarityMode: z.enum(['none', 'group']),
  solidarityCapPct: Pct,
  description: z.string().max(5000).nullable(),
});
export const BlockCreateBody = BlockFields.partial().required({ name: true, region: true, tenureType: true });
export const BlockUpdateBody = BlockFields.partial();

export const Block = z
  .object({
    id: Uuid,
    ref: z.string(),
    ownerOrgId: Uuid,
    name: z.string(),
    region: z.string(),
    department: z.string().nullable(),
    commune: z.string().nullable(),
    village: z.string().nullable(),
    boundary: GeoMultiPolygon.nullable(),
    areaHa: z.number().nullable(),
    centroid: GeoPoint.nullable(),
    waterSource: z.enum(WATER_SOURCES),
    irrigationType: z.enum(IRRIGATION_TYPES),
    tenureType: z.enum(TENURE_TYPES),
    farmerGroupOrgId: Uuid.nullable(),
    solidarityMode: z.enum(['none', 'group']),
    solidarityCapPct: z.number(),
    status: z.enum(BLOCK_STATUSES),
    description: z.string().nullable(),
    stats: z.object({ plots: z.number().int(), plotsAreaHa: z.number(), farmers: z.number().int(), womenFarmers: z.number().int(), landDocsVerified: z.number().int() }),
    version: z.number().int(),
    createdAt: IsoDateTime,
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Block' });
export type Block = z.infer<typeof Block>;

export const BoundaryBody = z.union([z.object({ geometry: GeoArea }), z.object({ fileId: Uuid })]);

export const LandDocument = z
  .object({
    id: Uuid,
    blockId: Uuid,
    blockName: z.string().optional(),
    ownerOrgId: Uuid,
    docType: z.enum(LAND_DOC_TYPES),
    number: z.string().nullable(),
    issuedBy: z.string().nullable(),
    issueDate: IsoDate.nullable(),
    expiryDate: IsoDate.nullable(),
    fileId: Uuid,
    status: z.enum(LAND_DOC_STATUSES),
    verifiedAt: IsoDateTime.nullable(),
    comment: z.string().nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'LandDocument' });
export const LandDocumentCreateBody = z.object({
  docType: z.enum(LAND_DOC_TYPES),
  fileId: Uuid,
  number: z.string().max(100).nullable().optional(),
  issuedBy: z.string().max(200).nullable().optional(),
  issueDate: IsoDate.nullable().optional(),
  expiryDate: IsoDate.nullable().optional(),
});

export const Plot = z
  .object({
    id: Uuid,
    blockId: Uuid,
    code: z.string(),
    geometry: GeoPolygon,
    areaHa: z.number(),
    soilType: z.string().nullable(),
    irrigated: z.boolean(),
    status: z.enum(PLOT_STATUSES),
    allocatedPct: z.number(),
    farmers: z.array(z.object({ farmerId: Uuid, name: z.string(), sharePct: z.number(), allocationId: Uuid })),
    version: z.number().int(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'Plot' });
export const PlotCreateBody = z.object({ code: z.string().trim().min(1).max(30).optional(), geometry: GeoPolygon, soilType: z.string().max(100).nullable().optional(), irrigated: z.boolean().optional() });
export const PlotUpdateBody = z.object({ code: z.string().trim().min(1).max(30), geometry: GeoPolygon, soilType: z.string().max(100).nullable(), irrigated: z.boolean(), status: z.enum(['available', 'fallow', 'excluded']) }).partial();
export const AutoGridBody = z
  .object({ count: z.number().int().min(1).max(500).optional(), targetAreaHa: z.number().positive().max(1000).optional(), codePrefix: z.string().max(10).default('P-'), irrigated: z.boolean().optional(), soilType: z.string().max(100).nullable().optional() })
  .refine((v) => v.count || v.targetAreaHa, { message: 'count or targetAreaHa is required' });

export const Allocation = z
  .object({ id: Uuid, plotId: Uuid, farmerId: Uuid, farmerName: z.string(), farmerCode: z.string(), startDate: IsoDate, endDate: IsoDate.nullable(), sharePct: z.number(), status: z.enum(['active', 'ended']), contractId: Uuid.nullable() })
  .meta({ id: 'Allocation' });
export const AllocationCreateBody = z.object({ farmerId: Uuid, sharePct: z.number().gt(0).max(100).default(100), startDate: IsoDate.optional() });
export const AllocationEndBody = z.object({ endDate: IsoDate.optional() });

export const BlockAsset = z.object({ id: Uuid, blockId: Uuid, type: z.enum(ASSET_TYPES), description: z.string(), capexItemId: Uuid.nullable(), location: GeoPoint.nullable(), commissionedAt: IsoDate.nullable(), createdAt: IsoDateTime });
export const BlockAssetCreateBody = z.object({ type: z.enum(ASSET_TYPES), description: z.string().min(2).max(500), capexItemId: Uuid.nullable().optional(), location: GeoPoint.nullable().optional(), commissionedAt: IsoDate.nullable().optional() });

export const Grievance = z.object({ id: Uuid, blockId: Uuid, reportedAt: IsoDateTime, reporter: z.string(), category: z.string(), description: z.string(), status: z.enum(GRIEVANCE_STATUSES), resolution: z.string().nullable(), resolvedAt: IsoDateTime.nullable(), version: z.number().int() });
export const GrievanceCreateBody = z.object({ reporter: z.string().min(2).max(200), category: z.string().min(2).max(100), description: z.string().min(2).max(5000), reportedAt: IsoDateTime.optional() });
export const GrievanceUpdateBody = z.object({ status: z.enum(GRIEVANCE_STATUSES), resolution: z.string().max(5000).nullable() }).partial();

export const LandDocReviewBody = z.object({ comment: z.string().max(2000).optional() });

// ---- Field PWA sync (SPEC §10.13)
export const SYNC_OP_TYPES = ['farmer.create', 'farmer.update', 'plot.create', 'plot.updateGeometry', 'allocation.create', 'photo.attach'] as const;
export const SyncOp = z.object({ clientId: z.string().min(8).max(100), type: z.string(), payload: z.record(z.string(), z.unknown()), createdAt: IsoDateTime });
export const SyncBody = z.object({ syncToken: z.string().optional(), blockIds: z.array(Uuid).max(50).default([]), ops: z.array(SyncOp).max(500) });
export const SyncResult = z.object({
  results: z.array(z.object({ clientId: z.string(), status: z.enum(['applied', 'duplicate', 'rejected']), entityId: Uuid.nullable(), error: z.object({ code: z.string(), message: z.string() }).nullable() })),
  syncToken: z.string(),
  changes: z.object({ farmers: z.array(z.record(z.string(), z.unknown())), plots: z.array(z.record(z.string(), z.unknown())), allocations: z.array(z.record(z.string(), z.unknown())) }),
});
export const FieldBootstrap = z.object({
  syncToken: z.string(),
  blocks: z.array(z.record(z.string(), z.unknown())),
  plots: z.array(z.record(z.string(), z.unknown())),
  farmers: z.array(z.record(z.string(), z.unknown())),
  allocations: z.array(z.record(z.string(), z.unknown())),
  plantings: z.array(z.record(z.string(), z.unknown())),
  budgetLines: z.array(z.record(z.string(), z.unknown())),
  templates: z.array(z.record(z.string(), z.unknown())),
  lastVisits: z.array(z.record(z.string(), z.unknown())),
});
