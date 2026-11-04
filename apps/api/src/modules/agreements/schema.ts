import { boolean, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appendCols, geometry, stdCols, tstz } from '../../db/columns';
import { CONTRACT_STATES } from '@jappo/domain';

export const contractStatus = pgEnum('contract_status', CONTRACT_STATES);
export const partyType = pgEnum('contract_party_type', ['org', 'farmer']);
export const signatureMethod = pgEnum('signature_method', ['otp_sms', 'otp_email', 'in_person_witnessed']);

export const contractTemplates = pgTable(
  'contract_templates',
  {
    ...stdCols(),
    code: text().notNull(),
    locale: text().notNull(),
    templateVersion: integer().notNull().default(1),
    title: text().notNull(),
    bodyHbs: text().notNull(),
    variablesSchema: jsonb().$type<{ name: string; editable?: boolean; description?: string }[]>().notNull().default([]),
    active: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex().on(t.code, t.locale, t.templateVersion)],
);

export const contracts = pgTable(
  'contracts',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    templateId: uuid().notNull(),
    type: text().notNull(),
    blockId: uuid().notNull(),
    seasonId: uuid(),
    ownerOrgId: uuid().notNull(),
    relatedType: text().notNull(),
    relatedId: uuid().notNull(),
    locale: text().notNull().default('fr'),
    data: jsonb().notNull(),
    bodyRendered: text(),
    status: contractStatus().notNull().default('draft'),
    pdfFileId: uuid(),
    signedPdfFileId: uuid(),
    contentSha256: text(),
    sentAt: tstz('sent_at'),
    signedAt: tstz('signed_at'),
    voidedAt: tstz('voided_at'),
    voidReason: text(),
  },
  (t) => [index().on(t.blockId, t.type), index().on(t.relatedType, t.relatedId)],
);

export const contractParties = pgTable(
  'contract_parties',
  {
    ...stdCols(),
    contractId: uuid().notNull().references(() => contracts.id),
    partyType: partyType().notNull(),
    orgId: uuid(),
    farmerId: uuid(),
    roleLabel: text().notNull(),
    signerUserId: uuid(),
    signerPhone: text(),
    signOrder: integer().notNull().default(1),
    signedAt: tstz('signed_at'),
    signatureId: uuid(),
  },
  (t) => [index().on(t.contractId), index().on(t.orgId), index().on(t.farmerId)],
);

export const signatures = pgTable(
  'signatures',
  {
    ...appendCols(),
    contractId: uuid().notNull().references(() => contracts.id),
    partyId: uuid().notNull().references(() => contractParties.id),
    method: signatureMethod().notNull(),
    signerName: text().notNull(),
    signerIdentifier: text().notNull(),
    ip: text(),
    userAgent: text(),
    geo: geometry('geo', 'Point'),
    contentSha256: text().notNull(),
    signedAt: tstz('signed_at').notNull().defaultNow(),
    witnessUserId: uuid(),
    evidenceFileId: uuid(),
  },
  (t) => [index().on(t.contractId)],
);
