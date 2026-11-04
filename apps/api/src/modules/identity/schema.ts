import { boolean, index, integer, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appendCols, pk, stdCols, tstz, createdAt } from '../../db/columns';
import { KYC_DOC_TYPES, KYC_STATUSES, LEGAL_FORMS, LENDER_KINDS, ORG_STATUSES, ORG_TYPES, USER_STATUSES, DOC_REVIEW_STATUSES } from '@jappo/contracts';

export const orgType = pgEnum('org_type', ORG_TYPES);
export const legalForm = pgEnum('legal_form', LEGAL_FORMS);
export const kycStatus = pgEnum('kyc_status', KYC_STATUSES);
export const orgStatus = pgEnum('org_status', ORG_STATUSES);
export const lenderKind = pgEnum('lender_kind', LENDER_KINDS);
export const kycDocType = pgEnum('kyc_doc_type', KYC_DOC_TYPES);
export const docReviewStatus = pgEnum('doc_review_status', DOC_REVIEW_STATUSES);
export const userStatus = pgEnum('user_status', USER_STATUSES);
export const otpPurpose = pgEnum('otp_purpose', ['login', 'farmer_login', 'signature', 'wallet_verify', 'delivery_ack']);

export const organizations = pgTable(
  'organizations',
  {
    ...stdCols(),
    type: orgType().notNull(),
    legalName: text().notNull(),
    tradeName: text(),
    legalForm: legalForm().notNull(),
    ninea: text(),
    rccm: text(),
    country: text().notNull().default('SN'),
    region: text(),
    address: text(),
    phone: text(),
    email: text(),
    logoFileId: uuid(),
    locale: text().notNull().default('fr'),
    kycStatus: kycStatus().notNull().default('pending'),
    status: orgStatus().notNull().default('active'),
    lenderKind: lenderKind(),
    bceaoApprovalNo: text(),
    planId: uuid(),
    /** SPEC §15: `overdue` → banner, `restricted` → read-only except settlement and statements. */
    billingStatus: text().notNull().default('ok'),
    annualVolumeKgEstimate: numeric({ precision: 14, scale: 3 }),
    yearsInBusiness: integer(),
    bankReferenceFileId: uuid(),
  },
  (t) => [index().on(t.type, t.kycStatus)],
);

export const orgKycDocuments = pgTable(
  'org_kyc_documents',
  {
    ...stdCols(),
    orgId: uuid().notNull().references(() => organizations.id),
    docType: kycDocType().notNull(),
    fileId: uuid().notNull(),
    status: docReviewStatus().notNull().default('submitted'),
    reviewedBy: uuid(),
    reviewedAt: tstz('reviewed_at'),
    comment: text(),
  },
  (t) => [index().on(t.orgId)],
);

export const users = pgTable('users', {
  ...stdCols(),
  email: text().unique(),
  phone: text().unique(),
  fullName: text().notNull(),
  passwordHash: text(),
  locale: text().notNull().default('fr'),
  status: userStatus().notNull().default('active'),
  lastLoginAt: tstz('last_login_at'),
  emailVerifiedAt: tstz('email_verified_at'),
  mfaTotpSecret: text(),
  mfaEnabledAt: tstz('mfa_enabled_at'),
  failedLoginCount: integer().notNull().default(0),
  lockedUntil: tstz('locked_until'),
});

export const memberships = pgTable(
  'memberships',
  {
    ...stdCols(),
    userId: uuid().notNull().references(() => users.id),
    orgId: uuid().notNull().references(() => organizations.id),
    roles: text().array().notNull(),
    status: text().notNull().default('active'),
  },
  (t) => [uniqueIndex().on(t.userId, t.orgId), index().on(t.orgId)],
);

export const invitations = pgTable(
  'invitations',
  {
    ...appendCols(),
    orgId: uuid().notNull().references(() => organizations.id),
    email: text(),
    phone: text(),
    roles: text().array().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    acceptedAt: tstz('accepted_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [index().on(t.orgId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: pk(),
    createdAt: createdAt(),
    userId: uuid().notNull().references(() => users.id),
    tokenHash: text().notNull().unique(),
    familyId: uuid().notNull(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    replacedById: uuid(),
    mfa: boolean().notNull().default(false),
    userAgent: text(),
    ip: text(),
  },
  (t) => [index().on(t.familyId), index().on(t.userId)],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: pk(),
    createdAt: createdAt(),
    phone: text().notNull(),
    purpose: otpPurpose().notNull(),
    subjectId: uuid(),
    codeHash: text().notNull(),
    expiresAt: tstz('expires_at').notNull(),
    attempts: integer().notNull().default(0),
    consumedAt: tstz('consumed_at'),
  },
  (t) => [index().on(t.phone, t.purpose, t.createdAt)],
);

export const userTokens = pgTable(
  'user_tokens',
  {
    id: pk(),
    createdAt: createdAt(),
    userId: uuid().notNull().references(() => users.id),
    purpose: text().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    consumedAt: tstz('consumed_at'),
  },
  (t) => [index().on(t.userId, t.purpose)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    ...stdCols(),
    orgId: uuid().notNull().references(() => organizations.id),
    name: text().notNull(),
    prefix: text().notNull().unique(),
    keyHash: text().notNull(),
    roles: text().array().notNull(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [index().on(t.orgId)],
);
