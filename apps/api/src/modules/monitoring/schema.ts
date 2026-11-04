import { date, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';

export const kpiScope = pgEnum('kpi_scope_type', ['block', 'season', 'lender_portfolio', 'platform']);
export const reportType = pgEnum('report_type', ['lender_monthly', 'season_close', 'guarantor_portfolio']);

export const kpiSnapshots = pgTable(
  'kpi_snapshots',
  {
    ...stdCols(),
    scopeType: kpiScope().notNull(),
    /** Platform scope uses the nil UUID so (scope, id, date) stays unique. */
    scopeId: uuid().notNull(),
    date: date({ mode: 'string' }).notNull(),
    metrics: jsonb().notNull(),
  },
  (t) => [uniqueIndex('kpi_snapshots_scope_date_uq').on(t.scopeType, t.scopeId, t.date), index().on(t.scopeType, t.scopeId)],
);

export const reports = pgTable(
  'reports',
  {
    ...stdCols(),
    ownerOrgId: uuid().notNull(),
    type: reportType().notNull(),
    scopeId: uuid(),
    period: text().notNull(),
    status: text().notNull().default('generating'),
    pdfFileId: uuid(),
    generatedAt: tstz('generated_at'),
  },
  (t) => [index().on(t.ownerOrgId)],
);
