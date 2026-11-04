import { sql } from 'drizzle-orm';
import { bigint, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, jsonb } from 'drizzle-orm/pg-core';
import { appendCols, geometry, stdCols, tstz } from '../../db/columns';

export const sexEnum = pgEnum('sex', ['F', 'M']);
export const nationalIdType = pgEnum('national_id_type', ['cni', 'passport', 'other', 'none']);
export const walletProvider = pgEnum('mobile_wallet_provider', ['wave', 'orange_money', 'free_money', 'other', 'none']);
export const farmerKycStatus = pgEnum('farmer_kyc_status', ['pending', 'verified', 'rejected']);
export const farmerStatus = pgEnum('farmer_status', ['active', 'inactive']);
export const groupMemberRole = pgEnum('group_member_role', ['member', 'president', 'treasurer', 'secretary']);
export const farmerFlagType = pgEnum('farmer_flag_type', ['duplicate_suspected', 'arrears', 'fraud_suspected']);

export const farmers = pgTable(
  'farmers',
  {
    ...stdCols(),
    ownerOrgId: uuid().notNull(),
    code: text().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    sex: sexEnum().notNull(),
    birthYear: integer(),
    phone: text(),
    locale: text().notNull().default('fr'),
    nationalIdType: nationalIdType().notNull().default('none'),
    nationalIdNumberEnc: text(),
    nationalIdHash: text(),
    nationalIdLast4: text(),
    photoFileId: uuid(),
    idPhotoFileId: uuid(),
    village: text(),
    commune: text(),
    homeLocation: geometry('home_location', 'Point'),
    householdSize: integer(),
    baselineIncomeXof: bigint({ mode: 'number' }),
    mobileWalletProvider: walletProvider().notNull().default('none'),
    mobileWalletNumberEnc: text(),
    mobileWalletHash: text(),
    mobileWalletLast4: text(),
    walletVerifiedAt: tstz('wallet_verified_at'),
    consentDataAt: tstz('consent_data_at'),
    consentCreditBureauAt: tstz('consent_credit_bureau_at'),
    consentTextVersion: text(),
    kycStatus: farmerKycStatus().notNull().default('pending'),
    kycVerifiedBy: uuid(),
    kycVerifiedAt: tstz('kyc_verified_at'),
    status: farmerStatus().notNull().default('active'),
    pseudonymisedAt: tstz('pseudonymised_at'),
  },
  (t) => [
    uniqueIndex().on(t.ownerOrgId, t.code),
    uniqueIndex('farmers_owner_national_id_uq').on(t.ownerOrgId, t.nationalIdHash).where(sql`national_id_hash is not null`),
    uniqueIndex('farmers_owner_phone_uq').on(t.ownerOrgId, t.phone).where(sql`phone is not null`),
    index().on(t.nationalIdHash),
    index().on(t.ownerOrgId, t.status),
    index('farmers_home_gix').using('gist', t.homeLocation),
  ],
);

export const farmerGroupMembers = pgTable(
  'farmer_group_members',
  {
    ...stdCols(),
    groupOrgId: uuid().notNull(),
    farmerId: uuid().notNull().references(() => farmers.id),
    role: groupMemberRole().notNull().default('member'),
    joinedAt: date({ mode: 'string' }),
  },
  (t) => [uniqueIndex().on(t.groupOrgId, t.farmerId)],
);

export const farmerFlags = pgTable(
  'farmer_flags',
  {
    ...appendCols(),
    farmerId: uuid().notNull().references(() => farmers.id),
    type: farmerFlagType().notNull(),
    detail: text(),
    data: jsonb(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.farmerId)],
);
