import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';
import type { InvestmentTrancheTerms, SeasonalTrancheTerms } from '@jappo/domain';

/**
 * Financing assumptions used to model a season before a financing request exists (DECISIONS D-038).
 * The financing request (P5) defaults its tranches from these.
 */
export const financingAssumptions = pgTable(
  'financing_assumptions',
  {
    ...stdCols(),
    seasonId: uuid().notNull(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    seasonal: jsonb().$type<SeasonalTrancheTerms & { borrowerType: 'operator' | 'farmers' | 'farmer_group' }>(),
    investment: jsonb().$type<InvestmentTrancheTerms>(),
    seasonsPerYear: integer().notNull().default(1),
    discountRateBps: integer().notNull().default(1200),
  },
  (t) => [uniqueIndex().on(t.seasonId)],
);

export const modelRuns = pgTable(
  'model_runs',
  {
    ...stdCols(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    financingRequestId: uuid(),
    engineVersion: text().notNull(),
    inputsHash: text().notNull(),
    inputs: jsonb().notNull(),
    outputs: jsonb().notNull(),
    computedAt: tstz('computed_at').notNull().defaultNow(),
    computedBy: uuid(),
  },
  (t) => [index().on(t.seasonId, t.computedAt)],
);
