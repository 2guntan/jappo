import { index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appendCols, tstz } from '../../db/columns';

export const syncOpStatus = pgEnum('sync_op_status', ['applied', 'rejected']);

/** Idempotency ledger for PWA sync operations (SPEC §10.13): one row per client operation id. */
export const fieldSyncOps = pgTable(
  'field_sync_ops',
  {
    ...appendCols(),
    orgId: uuid().notNull(),
    clientId: text().notNull(),
    type: text().notNull(),
    userId: uuid(),
    clientCreatedAt: tstz('client_created_at'),
    status: syncOpStatus().notNull(),
    entityId: uuid(),
    error: jsonb(),
  },
  (t) => [uniqueIndex().on(t.orgId, t.clientId), index().on(t.orgId, t.createdAt)],
);
