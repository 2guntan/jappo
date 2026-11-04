import { bigint, boolean, date, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';

export const priceModel = pgEnum('plan_price_model', ['per_ha_season', 'annual_seat', 'free']);
export const subscriptionStatus = pgEnum('subscription_status', ['active', 'cancelled']);
export const platformInvoiceStatus = pgEnum('platform_invoice_status', ['draft', 'issued', 'paid', 'void']);
export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', ['pending', 'delivered', 'failed']);

export const plans = pgTable('plans', {
  ...stdCols(),
  code: text().notNull().unique(),
  name: text().notNull(),
  orgTypes: text().array().notNull(),
  priceModel: priceModel().notNull(),
  unitPriceXof: bigint({ mode: 'number' }).notNull().default(0),
  structuringFeeBps: integer().notNull().default(0),
  includedSeats: integer().notNull().default(0),
  features: text().array().notNull().default([]),
  active: boolean().notNull().default(true),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    ...stdCols(),
    orgId: uuid().notNull(),
    planId: uuid().notNull().references(() => plans.id),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }),
    status: subscriptionStatus().notNull().default('active'),
  },
  (t) => [index().on(t.orgId, t.status)],
);

export const platformInvoices = pgTable(
  'platform_invoices',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    orgId: uuid().notNull(),
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    lines: jsonb().notNull(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    taxXof: bigint({ mode: 'number' }).notNull(),
    totalXof: bigint({ mode: 'number' }).notNull(),
    status: platformInvoiceStatus().notNull().default('issued'),
    issuedAt: tstz('issued_at'),
    dueDate: date({ mode: 'string' }).notNull(),
    pdfFileId: uuid(),
    paidAt: tstz('paid_at'),
    paymentReference: text(),
    voidReason: text(),
    /** What generated the invoice (dedupe): e.g. `season:<id>`, `award:<id>`, `subscription:<id>:<year>`. */
    sourceKey: text().notNull(),
  },
  (t) => [uniqueIndex().on(t.sourceKey), index().on(t.orgId, t.status)],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    ...stdCols(),
    orgId: uuid().notNull(),
    url: text().notNull(),
    secretEnc: text().notNull(),
    eventTypes: text().array().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [index().on(t.orgId)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    ...stdCols(),
    endpointId: uuid().notNull().references(() => webhookEndpoints.id),
    eventId: uuid().notNull(),
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    status: webhookDeliveryStatus().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    lastStatusCode: integer(),
    lastError: text(),
    nextAttemptAt: tstz('next_attempt_at').notNull().defaultNow(),
    deliveredAt: tstz('delivered_at'),
  },
  (t) => [uniqueIndex().on(t.endpointId, t.eventId), index().on(t.status, t.nextAttemptAt)],
);
