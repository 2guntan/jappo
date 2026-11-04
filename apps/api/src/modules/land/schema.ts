import { sql } from 'drizzle-orm';
import { boolean, date, index, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { geometry, stdCols, tstz } from '../../db/columns';
import { BLOCK_STATES } from '@jappo/domain';
import { farmers } from '../farmers/schema';

export const blockStatus = pgEnum('block_status', BLOCK_STATES);
export const waterSource = pgEnum('water_source', ['borehole', 'river', 'canal', 'rainfed', 'other']);
export const irrigationType = pgEnum('irrigation_type', ['none', 'drip', 'sprinkler', 'furrow', 'pivot']);
export const tenureType = pgEnum('tenure_type', ['title_foncier', 'bail', 'deliberation', 'customary_agreement']);
export const solidarityMode = pgEnum('solidarity_mode', ['none', 'group']);
export const landDocType = pgEnum('land_doc_type', ['title_foncier', 'bail', 'deliberation', 'approval_prefect', 'community_agreement', 'cahier_des_charges', 'survey_plan', 'other']);
export const landDocStatus = pgEnum('land_doc_status', ['submitted', 'verified', 'rejected', 'expired']);
export const plotStatus = pgEnum('plot_status', ['available', 'allocated', 'fallow', 'excluded']);
export const allocationStatus = pgEnum('allocation_status', ['active', 'ended']);
export const assetType = pgEnum('asset_type', ['borehole', 'solar_pump', 'irrigation_network', 'fence', 'storage', 'equipment', 'building', 'other']);
export const grievanceStatus = pgEnum('grievance_status', ['open', 'in_progress', 'resolved', 'closed']);

export const blocks = pgTable(
  'blocks',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    ownerOrgId: uuid().notNull(),
    name: text().notNull(),
    region: text().notNull(),
    department: text(),
    commune: text(),
    village: text(),
    boundary: geometry('boundary', 'MultiPolygon'),
    areaHa: numeric({ precision: 12, scale: 4 }),
    centroid: geometry('centroid', 'Point'),
    waterSource: waterSource().notNull().default('rainfed'),
    irrigationType: irrigationType().notNull().default('none'),
    tenureType: tenureType().notNull(),
    farmerGroupOrgId: uuid(),
    solidarityMode: solidarityMode().notNull().default('none'),
    solidarityCapPct: numeric({ precision: 7, scale: 4 }).notNull().default('20'),
    status: blockStatus().notNull().default('draft'),
    description: text(),
    archivedAt: tstz('archived_at'),
  },
  (t) => [index().on(t.ownerOrgId, t.status), index('blocks_boundary_gix').using('gist', t.boundary)],
);

export const landDocuments = pgTable(
  'land_documents',
  {
    ...stdCols(),
    blockId: uuid().notNull().references(() => blocks.id),
    ownerOrgId: uuid().notNull(),
    docType: landDocType().notNull(),
    number: text(),
    issuedBy: text(),
    issueDate: date({ mode: 'string' }),
    expiryDate: date({ mode: 'string' }),
    fileId: uuid().notNull(),
    status: landDocStatus().notNull().default('submitted'),
    verifiedBy: uuid(),
    verifiedAt: tstz('verified_at'),
    comment: text(),
  },
  (t) => [index().on(t.blockId), index().on(t.status)],
);

export const plots = pgTable(
  'plots',
  {
    ...stdCols(),
    blockId: uuid().notNull().references(() => blocks.id),
    ownerOrgId: uuid().notNull(),
    code: text().notNull(),
    geometry: geometry('geometry', 'Polygon').notNull(),
    areaHa: numeric({ precision: 12, scale: 4 }).notNull(),
    soilType: text(),
    irrigated: boolean().notNull().default(false),
    status: plotStatus().notNull().default('available'),
    archivedAt: tstz('archived_at'),
  },
  (t) => [
    uniqueIndex('plots_block_code_uq').on(t.blockId, t.code).where(sql`archived_at is null`),
    index().on(t.blockId),
    index('plots_geometry_gix').using('gist', t.geometry),
  ],
);

export const plotAllocations = pgTable(
  'plot_allocations',
  {
    ...stdCols(),
    plotId: uuid().notNull().references(() => plots.id),
    farmerId: uuid().notNull().references(() => farmers.id),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }),
    sharePct: numeric({ precision: 7, scale: 4 }).notNull().default('100'),
    contractId: uuid(),
    status: allocationStatus().notNull().default('active'),
  },
  (t) => [
    index().on(t.plotId, t.status),
    index().on(t.farmerId),
    uniqueIndex('plot_allocations_active_uq').on(t.plotId, t.farmerId).where(sql`status = 'active'`),
  ],
);

export const blockAssets = pgTable(
  'block_assets',
  {
    ...stdCols(),
    blockId: uuid().notNull().references(() => blocks.id),
    ownerOrgId: uuid().notNull(),
    type: assetType().notNull(),
    description: text().notNull(),
    capexItemId: uuid(),
    location: geometry('location', 'Point'),
    commissionedAt: date({ mode: 'string' }),
  },
  (t) => [index().on(t.blockId)],
);

export const communityGrievances = pgTable(
  'community_grievances',
  {
    ...stdCols(),
    blockId: uuid().notNull().references(() => blocks.id),
    ownerOrgId: uuid().notNull(),
    reportedAt: tstz('reported_at').notNull().defaultNow(),
    reporter: text().notNull(),
    category: text().notNull(),
    description: text().notNull(),
    status: grievanceStatus().notNull().default('open'),
    resolution: text(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [index().on(t.blockId, t.status)],
);
