import { bigint, boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';

export const priceType = pgEnum('price_type', ['fixed', 'floor_plus_market', 'formula']);
export const offtakeStatus = pgEnum('offtake_status', ['draft', 'loi', 'signed', 'terminated', 'expired']);

export interface QualityGrade {
  grade: string;
  adjustmentPct: number;
}

export const offtakeContracts = pgTable(
  'offtake_contracts',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    seasonId: uuid(),
    buyerOrgId: uuid().notNull(),
    cropId: uuid().notNull(),
    minVolumeKg: numeric({ precision: 14, scale: 3 }).notNull(),
    maxVolumeKg: numeric({ precision: 14, scale: 3 }).notNull(),
    priceType: priceType().notNull(),
    priceXofPerKg: bigint({ mode: 'number' }).notNull(),
    floorXofPerKg: bigint({ mode: 'number' }),
    formulaText: text(),
    qualitySpec: jsonb().$type<QualityGrade[]>().notNull().default([]),
    paymentTermsDays: integer().notNull(),
    paysIntoEscrow: boolean().notNull().default(true),
    escrowAccountId: uuid(),
    status: offtakeStatus().notNull().default('draft'),
    fileId: uuid(),
    signedAt: tstz('signed_at'),
    terminatedAt: tstz('terminated_at'),
  },
  (t) => [index().on(t.blockId), index().on(t.buyerOrgId)],
);
