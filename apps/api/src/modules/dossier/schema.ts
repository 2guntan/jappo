import { bigint, index, integer, jsonb, numeric, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';

export const dossierStatus = pgEnum('dossier_status', ['draft', 'frozen', 'superseded']);
export const riskCoverType = pgEnum('risk_cover_type', ['guarantee', 'index_insurance', 'indemnity_insurance', 'first_loss']);
export const riskCoverStatus = pgEnum('risk_cover_status', ['proposed', 'committed', 'active', 'expired']);

export const dossiers = pgTable(
  'dossiers',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    dossierVersion: integer().notNull(),
    status: dossierStatus().notNull().default('draft'),
    readinessScore: integer().notNull(),
    grade: text().notNull(),
    gates: jsonb().notNull(),
    scoreBreakdown: jsonb().notNull(),
    modelRunId: uuid().notNull(),
    snapshot: jsonb().notNull(),
    contentSha256: text().notNull(),
    pdfFileId: uuid(),
    pdfStatus: text().notNull().default('pending'),
    dataRoomManifest: jsonb().$type<{ fileId: string; label: string; category: string }[]>().notNull().default([]),
    frozenAt: tstz('frozen_at'),
  },
  (t) => [index().on(t.seasonId, t.dossierVersion)],
);

export const riskCovers = pgTable(
  'risk_covers',
  {
    ...stdCols(),
    trancheId: uuid(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    type: riskCoverType().notNull(),
    providerOrgId: uuid(),
    providerName: text().notNull(),
    coveragePct: numeric({ precision: 7, scale: 4 }).notNull(),
    capXof: bigint({ mode: 'number' }),
    premiumXof: bigint({ mode: 'number' }),
    status: riskCoverStatus().notNull().default('proposed'),
    fileId: uuid(),
  },
  (t) => [index().on(t.blockId)],
);
