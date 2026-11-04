import { index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';

export const notificationChannel = pgEnum('notification_channel', ['in_app', 'email', 'sms']);
export const notificationStatus = pgEnum('notification_status', ['pending', 'sent', 'failed', 'read']);

export const notifications = pgTable(
  'notifications',
  {
    ...stdCols(),
    recipientType: text().notNull(),
    recipientId: uuid().notNull(),
    orgId: uuid(),
    channel: notificationChannel().notNull(),
    destination: text(),
    templateCode: text().notNull(),
    locale: text().notNull().default('fr'),
    data: jsonb().notNull(),
    subject: text(),
    body: text(),
    link: text(),
    status: notificationStatus().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    sentAt: tstz('sent_at'),
    readAt: tstz('read_at'),
    provider: text(),
    providerRef: text(),
    error: text(),
  },
  (t) => [index().on(t.recipientType, t.recipientId, t.channel), index().on(t.status, t.channel)],
);

export const notificationPreferences = pgTable('notification_preferences', {
  ...stdCols(),
  userId: uuid().notNull(),
  eventType: text().notNull(),
  channels: text().array().notNull(),
});
