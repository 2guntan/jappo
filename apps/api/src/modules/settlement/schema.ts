import { bigint, boolean, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';
import { SETTLEMENT_STATES } from '@jappo/domain';

export const settlementStatus = pgEnum('settlement_status', SETTLEMENT_STATES);
export const payoutBeneficiary = pgEnum('payout_beneficiary_type', ['lender', 'operator', 'farmer', 'supplier']);
export const payoutChannel = pgEnum('payout_channel', ['bank_transfer', 'mobile_money']);
export const payoutStatus = pgEnum('payout_status', ['pending', 'exported', 'sent', 'confirmed', 'failed']);
export const arrearsBucket = pgEnum('arrears_bucket', ['seasonal_debt', 'investment_fee', 'operator_fees']);
export const arrearsStatus = pgEnum('arrears_status', ['open', 'settled', 'written_off', 'claimed_guarantee']);

export const settlementRuns = pgTable(
  'settlement_runs',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    ownerOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    status: settlementStatus().notNull().default('draft'),
    receiptsTotalXof: bigint({ mode: 'number' }).notNull().default(0),
    inputs: jsonb().notNull(),
    outputs: jsonb().notNull(),
    engineVersion: text().notNull(),
    computedAt: tstz('computed_at'),
    approvedOperatorBy: uuid(),
    approvedOperatorAt: tstz('approved_operator_at'),
    instructedAt: tstz('instructed_at'),
    executedAt: tstz('executed_at'),
    reconciledAt: tstz('reconciled_at'),
  },
  (t) => [index().on(t.seasonId), uniqueIndex('settlement_runs_one_per_season_uq').on(t.seasonId)],
);

export const settlementLenderApprovals = pgTable(
  'settlement_lender_approvals',
  {
    ...stdCols(),
    runId: uuid().notNull().references(() => settlementRuns.id),
    lenderOrgId: uuid().notNull(),
    approvedBy: uuid().notNull(),
    approvedAt: tstz('approved_at').notNull().defaultNow(),
    voidedAt: tstz('voided_at'),
  },
  (t) => [index().on(t.runId)],
);

export const settlementLines = pgTable(
  'settlement_lines',
  {
    ...stdCols(),
    runId: uuid().notNull().references(() => settlementRuns.id),
    farmerId: uuid().notNull(),
    grossCreditXof: bigint({ mode: 'number' }).notNull(),
    seasonalDebtPaidXof: bigint({ mode: 'number' }).notNull(),
    investmentFeePaidXof: bigint({ mode: 'number' }).notNull(),
    operatorFeesPaidXof: bigint({ mode: 'number' }).notNull(),
    otherDeductionsXof: bigint({ mode: 'number' }).notNull(),
    solidarityContributionXof: bigint({ mode: 'number' }).notNull(),
    solidarityReceivedXof: bigint({ mode: 'number' }).notNull(),
    payoutXof: bigint({ mode: 'number' }).notNull(),
    arrearsCreatedXof: jsonb().$type<{ seasonalDebtXof: number; investmentFeeXof: number; operatorFeesXof: number }>().notNull(),
  },
  (t) => [uniqueIndex().on(t.runId, t.farmerId)],
);

export const payoutInstructions = pgTable(
  'payout_instructions',
  {
    ...stdCols(),
    runId: uuid().notNull().references(() => settlementRuns.id),
    ref: text().notNull(),
    beneficiaryType: payoutBeneficiary().notNull(),
    beneficiaryId: uuid().notNull(),
    beneficiaryName: text().notNull(),
    facilityId: uuid(),
    channel: payoutChannel().notNull(),
    destinationMasked: text().notNull(),
    heldForFarmer: boolean().notNull().default(false),
    amountXof: bigint({ mode: 'number' }).notNull(),
    status: payoutStatus().notNull().default('pending'),
    provider: text().notNull(),
    providerRef: text(),
    confirmedAt: tstz('confirmed_at'),
    failureReason: text(),
  },
  (t) => [index().on(t.runId), uniqueIndex().on(t.runId, t.ref)],
);

export const farmerArrears = pgTable(
  'farmer_arrears',
  {
    ...stdCols(),
    farmerId: uuid().notNull(),
    blockId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    originRunId: uuid().notNull(),
    bucket: arrearsBucket().notNull(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    facilityId: uuid(),
    remainingXof: bigint({ mode: 'number' }).notNull(),
    status: arrearsStatus().notNull().default('open'),
  },
  (t) => [index().on(t.farmerId, t.status), index().on(t.originRunId)],
);

export const farmerStatements = pgTable(
  'farmer_statements',
  {
    ...stdCols(),
    runId: uuid().notNull().references(() => settlementRuns.id),
    farmerId: uuid().notNull(),
    pdfFileId: uuid(),
    smsText: text().notNull(),
    sentAt: tstz('sent_at'),
  },
  (t) => [uniqueIndex().on(t.runId, t.farmerId)],
);
