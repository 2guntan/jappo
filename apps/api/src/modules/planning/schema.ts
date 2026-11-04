import { bigint, boolean, date, index, integer, numeric, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';
import { SEASON_STATES } from '@jappo/domain';
import { serviceUnit } from '../catalogue/schema';

export const seasonKind = pgEnum('season_kind', ['rainy', 'cold_dry', 'hot_dry']);
export const seasonStatus = pgEnum('season_status', SEASON_STATES);
export const budgetScope = pgEnum('budget_scope', ['block', 'plot', 'per_ha_all', 'per_ha_crop']);
export const budgetPayer = pgEnum('budget_payer', ['farmer_credit', 'farmer_cash', 'operator', 'grant']);
export const budgetTranche = pgEnum('budget_tranche', ['seasonal', 'none']);
export const capexTranche = pgEnum('capex_tranche', ['investment', 'equity', 'grant']);
export const opexKind = pgEnum('opex_kind', ['staff', 'fuel', 'maintenance', 'security', 'insurance', 'admin', 'other']);

export const seasons = pgTable(
  'seasons',
  {
    ...stdCols(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    name: text().notNull(),
    kind: seasonKind().notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }).notNull(),
    status: seasonStatus().notNull().default('planning'),
    planVersion: integer().notNull().default(1),
    selfFinanced: boolean().notNull().default(false),
    startedAt: tstz('started_at'),
  },
  (t) => [index().on(t.blockId), index().on(t.ownerOrgId, t.status)],
);

export const plantings = pgTable(
  'plantings',
  {
    ...stdCols(),
    seasonId: uuid().notNull().references(() => seasons.id),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    plotId: uuid().notNull(),
    cropId: uuid().notNull(),
    varietyId: uuid(),
    templateId: uuid(),
    areaHa: numeric({ precision: 12, scale: 4 }).notNull(),
    plannedSowingDate: date({ mode: 'string' }),
    plannedHarvestDate: date({ mode: 'string' }),
    yieldBaseTHa: numeric({ precision: 10, scale: 3 }),
    yieldStressTHa: numeric({ precision: 10, scale: 3 }),
    postHarvestLossPct: numeric({ precision: 7, scale: 4 }),
    deliveryRatePct: numeric({ precision: 7, scale: 4 }),
    priceXofPerKgBase: bigint({ mode: 'number' }),
    priceXofPerKgStress: bigint({ mode: 'number' }),
  },
  (t) => [index().on(t.seasonId), index().on(t.plotId)],
);

export const supplierQuotes = pgTable(
  'supplier_quotes',
  {
    ...stdCols(),
    ownerOrgId: uuid().notNull(),
    supplierOrgId: uuid(),
    supplierName: text().notNull(),
    serviceId: uuid().notNull(),
    unit: serviceUnit().notNull(),
    unitPriceXof: bigint({ mode: 'number' }).notNull(),
    minQty: numeric({ precision: 14, scale: 3 }),
    validUntil: date({ mode: 'string' }).notNull(),
    fileId: uuid(),
    private: boolean().notNull().default(false),
  },
  (t) => [index().on(t.ownerOrgId, t.serviceId)],
);

export const budgetLines = pgTable(
  'budget_lines',
  {
    ...stdCols(),
    seasonId: uuid().notNull().references(() => seasons.id),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    scope: budgetScope().notNull(),
    plotId: uuid(),
    cropId: uuid(),
    serviceId: uuid().notNull(),
    qty: numeric({ precision: 14, scale: 3 }).notNull(),
    unit: serviceUnit().notNull(),
    unitPriceXof: bigint({ mode: 'number' }).notNull(),
    quoteId: uuid(),
    payer: budgetPayer().notNull(),
    tranche: budgetTranche().notNull().default('none'),
    plannedDate: date({ mode: 'string' }),
    notes: text(),
    source: text().notNull().default('manual'),
  },
  (t) => [index().on(t.seasonId)],
);

export const capexItems = pgTable(
  'capex_items',
  {
    ...stdCols(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    description: text().notNull(),
    assetType: text().notNull(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    usefulLifeYears: integer().notNull(),
    quoteId: uuid(),
    tranche: capexTranche().notNull(),
    plannedDate: date({ mode: 'string' }).notNull(),
  },
  (t) => [index().on(t.blockId)],
);

export const operatorOpex = pgTable(
  'operator_opex',
  {
    ...stdCols(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    description: text().notNull(),
    kind: opexKind().notNull(),
    amountXofPerMonth: bigint({ mode: 'number' }).notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }),
  },
  (t) => [index().on(t.blockId)],
);

export const feePolicies = pgTable(
  'fee_policies',
  {
    ...stdCols(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    operatorServiceFeeXofPerFarmerSeason: bigint({ mode: 'number' }).notNull(),
    landFeeXofPerHaSeason: bigint({ mode: 'number' }).notNull(),
    investmentRecoveryFeeXofPerHaSeason: bigint({ mode: 'number' }).notNull(),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    supersededAt: tstz('superseded_at'),
  },
  (t) => [index().on(t.blockId)],
);
