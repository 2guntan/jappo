import { bigint, date, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';
import { DISBURSEMENT_STATES, FACILITY_STATES } from '@jappo/domain';
import { borrowerType, graceType, rateMethod, repaymentProfile } from '../marketplace/schema';

export const facilityStatus = pgEnum('facility_status', FACILITY_STATES);
export const disbursementStatus = pgEnum('disbursement_status', DISBURSEMENT_STATES);
export const scheduleLineStatus = pgEnum('schedule_line_status', ['due', 'paid', 'partial', 'overdue']);
export const beneficiaryType = pgEnum('disbursement_beneficiary_type', ['supplier', 'operator', 'farmer']);
export const repaymentSource = pgEnum('repayment_source', ['settlement', 'direct', 'guarantee_call', 'insurance']);

export const escrowAccounts = pgTable(
  'escrow_accounts',
  {
    ...stdCols(),
    lenderOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    bankName: text().notNull(),
    accountLabel: text().notNull(),
    accountNumberMasked: text().notNull(),
    ibanEnc: text(),
    status: text().notNull().default('active'),
  },
  (t) => [index().on(t.blockId), index().on(t.lenderOrgId)],
);

export const facilities = pgTable(
  'facilities',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    awardId: uuid().notNull().unique(),
    trancheId: uuid().notNull(),
    trancheType: text().notNull(),
    lenderOrgId: uuid().notNull(),
    operatorOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    borrowerType: borrowerType().notNull(),
    borrowerOrgId: uuid(),
    principalXof: bigint({ mode: 'number' }).notNull(),
    rateBps: integer().notNull(),
    rateMethod: rateMethod().notNull(),
    upfrontFeeBps: integer().notNull(),
    tenorMonths: integer().notNull(),
    graceMonths: integer().notNull(),
    graceType: graceType().notNull(),
    repaymentProfile: repaymentProfile().notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    maturityDate: date({ mode: 'string' }).notNull(),
    escrowAccountId: uuid(),
    status: facilityStatus().notNull().default('pending_cp'),
    lenderLoanRef: text(),
    activatedAt: tstz('activated_at'),
  },
  (t) => [index().on(t.blockId), index().on(t.lenderOrgId, t.status)],
);

export const facilityFarmerAllocations = pgTable(
  'facility_farmer_allocations',
  {
    ...stdCols(),
    facilityId: uuid().notNull().references(() => facilities.id),
    farmerId: uuid().notNull(),
    principalXof: bigint({ mode: 'number' }).notNull(),
    interestXof: bigint({ mode: 'number' }).notNull(),
    feesXof: bigint({ mode: 'number' }).notNull().default(0),
    dueXof: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex().on(t.facilityId, t.farmerId)],
);

export const scheduleLines = pgTable(
  'schedule_lines',
  {
    ...stdCols(),
    facilityId: uuid().notNull().references(() => facilities.id),
    seq: integer().notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    principalXof: bigint({ mode: 'number' }).notNull(),
    interestXof: bigint({ mode: 'number' }).notNull(),
    feesXof: bigint({ mode: 'number' }).notNull().default(0),
    totalXof: bigint({ mode: 'number' }).notNull(),
    paidXof: bigint({ mode: 'number' }).notNull().default(0),
    status: scheduleLineStatus().notNull().default('due'),
  },
  (t) => [uniqueIndex().on(t.facilityId, t.seq)],
);

export const disbursements = pgTable(
  'disbursements',
  {
    ...stdCols(),
    facilityId: uuid().notNull().references(() => facilities.id),
    ref: text().notNull().unique(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    purpose: text().notNull(),
    beneficiaryType: beneficiaryType().notNull(),
    beneficiaryOrgId: uuid(),
    beneficiaryFarmerId: uuid(),
    beneficiaryName: text().notNull(),
    budgetLineIds: uuid().array().notNull().default([]),
    capexItemIds: uuid().array().notNull().default([]),
    status: disbursementStatus().notNull().default('requested'),
    requestedBy: uuid(),
    approvedBy: uuid(),
    approvedAt: tstz('approved_at'),
    executedBy: uuid(),
    executedAt: tstz('executed_at'),
    confirmedBy: uuid(),
    confirmedAt: tstz('confirmed_at'),
    bankReference: text(),
    proofFileId: uuid(),
    rejectReason: text(),
  },
  (t) => [index().on(t.facilityId)],
);

export const repayments = pgTable(
  'repayments',
  {
    ...stdCols(),
    facilityId: uuid().notNull().references(() => facilities.id),
    settlementRunId: uuid(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    principalXof: bigint({ mode: 'number' }).notNull(),
    interestXof: bigint({ mode: 'number' }).notNull(),
    feesXof: bigint({ mode: 'number' }).notNull().default(0),
    valueDate: date({ mode: 'string' }).notNull(),
    source: repaymentSource().notNull(),
    reference: text(),
  },
  (t) => [index().on(t.facilityId)],
);
