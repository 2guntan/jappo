import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appendCols, geometry, stdCols, tstz } from '../../db/columns';

export const ackMethod = pgEnum('farmer_ack_method', ['otp', 'signature_photo', 'none']);
export const cropStage = pgEnum('crop_stage', ['land_prep', 'sowing', 'emergence', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested', 'failed']);
export const alertSeverity = pgEnum('alert_severity', ['info', 'warning', 'critical']);
export const alertSource = pgEnum('alert_source', ['rule', 'manual']);
export const alertStatus = pgEnum('alert_status', ['open', 'acknowledged', 'resolved']);

export const serviceDeliveries = pgTable(
  'service_deliveries',
  {
    ...appendCols(),
    ownerOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    budgetLineId: uuid().notNull(),
    plotId: uuid(),
    farmerId: uuid(),
    qty: numeric({ precision: 14, scale: 3 }).notNull(),
    unit: text().notNull(),
    deliveredAt: tstz('delivered_at').notNull(),
    supplierName: text(),
    deliveredByUserId: uuid(),
    photoFileId: uuid(),
    farmerAckMethod: ackMethod().notNull().default('none'),
    farmerAckAt: tstz('farmer_ack_at'),
    geo: geometry('geo', 'Point'),
    offlineClientId: text(),
  },
  (t) => [index().on(t.seasonId), index().on(t.budgetLineId), uniqueIndex().on(t.ownerOrgId, t.offlineClientId)],
);

export const fieldVisits = pgTable(
  'field_visits',
  {
    ...appendCols(),
    ownerOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    plotId: uuid().notNull(),
    plantingId: uuid(),
    agentUserId: uuid(),
    visitedAt: tstz('visited_at').notNull(),
    geo: geometry('geo', 'Point'),
    cropStage: cropStage().notNull(),
    healthScore: integer().notNull(),
    estimatedYieldTHa: numeric({ precision: 10, scale: 3 }),
    issues: text().array().notNull().default([]),
    notes: text(),
    photoFileIds: uuid().array().notNull().default([]),
    offlineClientId: text(),
  },
  (t) => [index().on(t.plotId, t.visitedAt), index().on(t.blockId), uniqueIndex().on(t.ownerOrgId, t.offlineClientId)],
);

export const alertRules = pgTable('alert_rules', {
  ...stdCols(),
  code: text().notNull().unique(),
  enabled: boolean().notNull().default(true),
  params: jsonb().$type<Record<string, number>>().notNull().default({}),
  description: text().notNull(),
});

export const alerts = pgTable(
  'alerts',
  {
    ...stdCols(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    seasonId: uuid(),
    type: text().notNull(),
    severity: alertSeverity().notNull(),
    source: alertSource().notNull(),
    ruleCode: text(),
    dedupeKey: text(),
    message: text().notNull(),
    data: jsonb().notNull().default({}),
    status: alertStatus().notNull().default('open'),
    acknowledgedBy: uuid(),
    acknowledgedAt: tstz('acknowledged_at'),
    resolvedBy: uuid(),
    resolvedAt: tstz('resolved_at'),
    resolutionNote: text(),
  },
  (t) => [index().on(t.blockId, t.status), index().on(t.dedupeKey, t.status)],
);
