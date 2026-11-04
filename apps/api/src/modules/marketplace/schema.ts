import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';
import { BID_STATES, RFP_STATES } from '@jappo/domain';

export const financingRequestStatus = pgEnum('financing_request_status', ['draft', 'submitted', 'in_tender', 'awarded', 'contracted', 'cancelled']);
export const trancheType = pgEnum('tranche_type', ['seasonal', 'investment']);
export const trancheStatus = pgEnum('tranche_status', ['open', 'fully_awarded', 'partially_awarded', 'unawarded']);
export const repaymentProfile = pgEnum('repayment_profile', ['bullet', 'seasonal', 'annuity', 'equal_principal']);
export const borrowerType = pgEnum('borrower_type', ['operator', 'farmers', 'farmer_group']);
export const rfpStatus = pgEnum('rfp_status', RFP_STATES);
export const invitationStatus = pgEnum('rfp_invitation_status', ['invited', 'viewed', 'declined', 'bid_submitted']);
export const bidStatus = pgEnum('bid_status', BID_STATES);
export const rateMethod = pgEnum('rate_method', ['flat', 'declining']);
export const graceType = pgEnum('grace_type', ['interest_only', 'capitalised']);
export const awardStatus = pgEnum('award_status', ['proposed', 'accepted_by_lender', 'declined_by_lender', 'cancelled']);

export const lenderProfiles = pgTable(
  'lender_profiles',
  {
    ...stdCols(),
    lenderOrgId: uuid().notNull(),
    name: text().notNull(),
    active: boolean().notNull().default(true),
    cropIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    regions: text().array().notNull().default(sql`'{}'::text[]`),
    trancheTypes: text().array().notNull(),
    minTicketXof: bigint({ mode: 'number' }).notNull(),
    maxTicketXof: bigint({ mode: 'number' }).notNull(),
    minReadinessScore: integer().notNull().default(0),
    maxTenorMonths: integer().notNull(),
    requiresGuarantee: boolean().notNull().default(false),
    minGuaranteePct: numeric({ precision: 7, scale: 4 }).notNull().default('0'),
    requiresInsurance: boolean().notNull().default(false),
    maxRateBps: integer(),
    notes: text(),
  },
  (t) => [index().on(t.lenderOrgId)],
);

export const financingRequests = pgTable(
  'financing_requests',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    dossierId: uuid().notNull(),
    ownerOrgId: uuid().notNull(),
    status: financingRequestStatus().notNull().default('draft'),
    submittedAt: tstz('submitted_at'),
    cancelReason: text(),
  },
  (t) => [index().on(t.ownerOrgId, t.status), index().on(t.seasonId)],
);

export const tranches = pgTable(
  'tranches',
  {
    ...stdCols(),
    financingRequestId: uuid().notNull().references(() => financingRequests.id),
    type: trancheType().notNull(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    requestedTenorMonths: integer().notNull(),
    requestedGraceMonths: integer().notNull().default(0),
    repaymentProfile: repaymentProfile().notNull(),
    borrowerType: borrowerType().notNull(),
    borrowerOrgId: uuid(),
    purpose: text().notNull(),
    status: trancheStatus().notNull().default('open'),
  },
  (t) => [index().on(t.financingRequestId)],
);

export const rfps = pgTable(
  'rfps',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    financingRequestId: uuid().notNull().references(() => financingRequests.id),
    ownerOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    status: rfpStatus().notNull().default('draft'),
    openedAt: tstz('opened_at'),
    deadlineAt: tstz('deadline_at'),
    closedAt: tstz('closed_at'),
    instructions: text(),
    minBidSharePct: numeric({ precision: 7, scale: 4 }).notNull().default('20'),
    extensions: integer().notNull().default(0),
    cancelReason: text(),
  },
  (t) => [index().on(t.status, t.deadlineAt), index().on(t.financingRequestId)],
);

export const rfpInvitations = pgTable(
  'rfp_invitations',
  {
    ...stdCols(),
    rfpId: uuid().notNull().references(() => rfps.id),
    lenderOrgId: uuid().notNull(),
    lenderProfileId: uuid(),
    matchReasons: jsonb().$type<string[]>().notNull().default([]),
    status: invitationStatus().notNull().default('invited'),
    declinedReason: text(),
    invitedAt: tstz('invited_at'),
    viewedAt: tstz('viewed_at'),
  },
  (t) => [uniqueIndex().on(t.rfpId, t.lenderOrgId), index().on(t.lenderOrgId)],
);

export const rfpQuestions = pgTable(
  'rfp_questions',
  {
    ...stdCols(),
    rfpId: uuid().notNull().references(() => rfps.id),
    askedByOrgId: uuid().notNull(),
    question: text().notNull(),
    answer: text(),
    answeredAt: tstz('answered_at'),
    published: boolean().notNull().default(false),
  },
  (t) => [index().on(t.rfpId)],
);

export const bids = pgTable(
  'bids',
  {
    ...stdCols(),
    rfpId: uuid().notNull().references(() => rfps.id),
    trancheId: uuid().notNull().references(() => tranches.id),
    lenderOrgId: uuid().notNull(),
    status: bidStatus().notNull().default('draft'),
    amountXof: bigint({ mode: 'number' }).notNull(),
    sharePct: numeric({ precision: 7, scale: 4 }).notNull(),
    rateBps: integer().notNull(),
    rateMethod: rateMethod().notNull(),
    upfrontFeeBps: integer().notNull().default(0),
    tenorMonths: integer().notNull(),
    graceMonths: integer().notNull().default(0),
    graceType: graceType().notNull().default('interest_only'),
    repaymentProfile: repaymentProfile().notNull(),
    securityRequirements: text().array().notNull().default(sql`'{}'::text[]`),
    cashCollateralPct: numeric({ precision: 7, scale: 4 }).notNull().default('0'),
    conditionsPrecedent: text().array().notNull().default(sql`'{}'::text[]`),
    daysToDisbursement: integer().notNull(),
    validUntil: date({ mode: 'string' }).notNull(),
    acceptsPartial: boolean().notNull().default(true),
    submittedAt: tstz('submitted_at'),
    submittedBy: uuid(),
    comments: text(),
  },
  (t) => [
    index().on(t.rfpId, t.lenderOrgId),
    uniqueIndex('bids_one_active_uq').on(t.rfpId, t.trancheId, t.lenderOrgId).where(sql`status <> 'withdrawn'`),
  ],
);

export const bidEvaluations = pgTable('bid_evaluations', {
  ...stdCols(),
  bidId: uuid().notNull().references(() => bids.id).unique(),
  effectiveAnnualRateBps: integer().notNull(),
  scoreCost: numeric({ precision: 7, scale: 2 }).notNull(),
  scoreShare: numeric({ precision: 7, scale: 2 }).notNull(),
  scoreSpeed: numeric({ precision: 7, scale: 2 }).notNull(),
  scoreConditions: numeric({ precision: 7, scale: 2 }).notNull(),
  totalScore: numeric({ precision: 7, scale: 2 }).notNull(),
  rank: integer().notNull(),
  computedAt: tstz('computed_at').notNull().defaultNow(),
});

export const awards = pgTable(
  'awards',
  {
    ...stdCols(),
    rfpId: uuid().notNull().references(() => rfps.id),
    bidId: uuid().notNull().references(() => bids.id),
    trancheId: uuid().notNull(),
    lenderOrgId: uuid().notNull(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    status: awardStatus().notNull().default('proposed'),
    decidedBy: uuid(),
    decidedAt: tstz('decided_at'),
    lenderResponseAt: tstz('lender_response_at'),
    declineReason: text(),
  },
  (t) => [index().on(t.rfpId), index().on(t.lenderOrgId)],
);
