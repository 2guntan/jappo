import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appendCols, pk, stdCols, tstz, createdAt } from '../db/columns';

export const fileVisibility = pgEnum('file_visibility', ['private', 'shared_via_grant']);
export const grantScope = pgEnum('grant_scope', ['read', 'comment', 'act']);

export const files = pgTable(
  'files',
  {
    ...stdCols(),
    ownerOrgId: uuid().notNull(),
    bucket: text().notNull(),
    objectKey: text().notNull(),
    filename: text().notNull(),
    mime: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    sha256: text().notNull(),
    visibility: fileVisibility().notNull().default('private'),
    linkedType: text(),
    linkedId: uuid(),
    uploadedBy: uuid(),
  },
  (t) => [index().on(t.ownerOrgId), index().on(t.linkedType, t.linkedId)],
);

export const accessGrants = pgTable(
  'access_grants',
  {
    ...appendCols(),
    resourceType: text().notNull(),
    resourceId: uuid().notNull(),
    granteeOrgId: uuid().notNull(),
    scope: grantScope().notNull(),
    grantedByEvent: text().notNull(),
    expiresAt: tstz('expires_at'),
  },
  (t) => [
    index().on(t.granteeOrgId, t.resourceType),
    uniqueIndex().on(t.resourceType, t.resourceId, t.granteeOrgId, t.scope),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    seq: bigserial({ mode: 'number' }).notNull().unique(),
    at: tstz('at').notNull().defaultNow(),
    actorType: text().notNull(),
    actorId: text(),
    orgId: uuid(),
    action: text().notNull(),
    resourceType: text().notNull(),
    resourceId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    requestId: text(),
    prevHash: text().notNull(),
    hash: text().notNull(),
  },
  (t) => [index().on(t.resourceType, t.resourceId), index().on(t.orgId, t.at)],
);

export const eventsOutbox = pgTable(
  'events_outbox',
  {
    id: pk(),
    type: text().notNull(),
    version: integer().notNull().default(1),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    orgId: uuid(),
    actor: jsonb().notNull(),
    payload: jsonb().notNull(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    dispatchedAt: tstz('dispatched_at'),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [index('events_outbox_pending_idx').on(t.occurredAt).where(sql`dispatched_at is null`), index().on(t.orgId, t.occurredAt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: pk(),
    key: text().notNull(),
    principalId: text().notNull(),
    route: text().notNull(),
    requestHash: text().notNull(),
    responseStatus: integer(),
    responseBody: jsonb(),
    createdAt: createdAt(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [uniqueIndex().on(t.key, t.principalId, t.route)],
);

export const refSequences = pgTable(
  'ref_sequences',
  { prefix: text().notNull(), year: integer().notNull(), last: integer().notNull().default(0) },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
);

export const featureFlags = pgTable(
  'feature_flags',
  { ...stdCols(), orgId: uuid(), key: text().notNull(), enabled: boolean().notNull().default(false) },
  (t) => [uniqueIndex().on(t.orgId, t.key)],
);

export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid(),
});

export const holidays = pgTable('holidays', {
  ...stdCols(),
  date: date({ mode: 'string' }).notNull().unique(),
  name: text().notNull(),
  movable: boolean().notNull().default(false),
});

export const roles = pgTable('roles', {
  code: text().primaryKey(),
  orgTypes: text().array().notNull(),
  description: text().notNull(),
});
