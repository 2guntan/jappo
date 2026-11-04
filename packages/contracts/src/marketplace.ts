import { z } from 'zod';
import { AllowedActions, IsoDate, IsoDateTime, Uuid, Xof } from './common';
import { BORROWER_TYPES, GRACE_TYPES, RATE_METHODS, REPAYMENT_PROFILES } from './finance';

export const TRANCHE_TYPES = ['seasonal', 'investment'] as const;
export const SECURITY_CODES = ['escrow_domiciliation', 'guarantee_fongip', 'insurance', 'equipment_pledge', 'group_guarantee', 'personal_guarantee', 'cash_collateral', 'other'] as const;

const ProfileFields = z.object({
  name: z.string().min(2).max(200),
  active: z.boolean(),
  cropIds: z.array(Uuid),
  regions: z.array(z.string().min(2)),
  trancheTypes: z.array(z.enum(TRANCHE_TYPES)).min(1),
  minTicketXof: Xof.min(0),
  maxTicketXof: Xof.min(0),
  minReadinessScore: z.number().int().min(0).max(100),
  maxTenorMonths: z.number().int().min(1).max(240),
  requiresGuarantee: z.boolean(),
  minGuaranteePct: z.number().min(0).max(100),
  requiresInsurance: z.boolean(),
  maxRateBps: z.number().int().min(0).max(10000).nullable(),
  notes: z.string().max(2000).nullable(),
});
export const LenderProfileCreateBody = ProfileFields.partial().required({ name: true, trancheTypes: true, minTicketXof: true, maxTicketXof: true, maxTenorMonths: true });
export const LenderProfileUpdateBody = ProfileFields.partial();
export const LenderProfile = ProfileFields.extend({ id: Uuid, lenderOrgId: Uuid, version: z.number().int(), createdAt: IsoDateTime }).meta({ id: 'LenderProfile' });

export const TrancheBody = z.object({
  type: z.enum(TRANCHE_TYPES),
  amountXof: Xof.min(1),
  requestedTenorMonths: z.number().int().min(1).max(240),
  requestedGraceMonths: z.number().int().min(0).max(60).default(0),
  repaymentProfile: z.enum(REPAYMENT_PROFILES),
  borrowerType: z.enum(BORROWER_TYPES),
  borrowerOrgId: Uuid.nullable().optional(),
  purpose: z.string().min(2).max(1000),
});
export const Tranche = TrancheBody.extend({ id: Uuid, status: z.enum(['open', 'fully_awarded', 'partially_awarded', 'unawarded']), awardedXof: Xof }).meta({ id: 'Tranche' });
export const FinancingRequestCreateBody = z.object({ dossierId: Uuid, tranches: z.array(TrancheBody).min(1).max(2).optional() });
export const FinancingRequestUpdateBody = z.object({ tranches: z.array(TrancheBody).min(1).max(2) });
export const FinancingRequest = z
  .object({ id: Uuid, ref: z.string(), blockId: Uuid, blockName: z.string(), seasonId: Uuid, dossierId: Uuid, status: z.enum(['draft', 'submitted', 'in_tender', 'awarded', 'contracted', 'cancelled']), submittedAt: IsoDateTime.nullable(), tranches: z.array(Tranche), rfpId: Uuid.nullable(), version: z.number().int(), createdAt: IsoDateTime, allowedActions: AllowedActions })
  .meta({ id: 'FinancingRequest' });
export const LenderMatch = z.object({ lenderOrgId: Uuid, lenderName: z.string(), lenderKind: z.string().nullable(), profileId: Uuid, profileName: z.string(), trancheIds: z.array(Uuid), reasons: z.array(z.string()) }).meta({ id: 'LenderMatch' });

export const RFP_STATUSES = ['draft', 'open', 'closed', 'evaluation', 'awarded', 'cancelled'] as const;
export const RfpCreateBody = z.object({ financingRequestId: Uuid, lenderOrgIds: z.array(Uuid).optional(), instructions: z.string().max(5000).nullable().optional(), minBidSharePct: z.number().min(1).max(100).optional() });
export const RfpInvitation = z.object({ id: Uuid, lenderOrgId: Uuid, lenderName: z.string(), status: z.enum(['invited', 'viewed', 'declined', 'bid_submitted']), matchReasons: z.array(z.string()), declinedReason: z.string().nullable(), invitedAt: IsoDateTime.nullable(), viewedAt: IsoDateTime.nullable() });
export const Rfp = z
  .object({
    id: Uuid,
    ref: z.string(),
    financingRequestId: Uuid,
    financingRequestRef: z.string(),
    blockId: Uuid,
    blockName: z.string(),
    region: z.string(),
    seasonId: Uuid,
    dossierId: Uuid,
    dossierRef: z.string(),
    readinessScore: z.number().int(),
    grade: z.string(),
    operatorName: z.string(),
    status: z.enum(RFP_STATUSES),
    openedAt: IsoDateTime.nullable(),
    deadlineAt: IsoDateTime.nullable(),
    closedAt: IsoDateTime.nullable(),
    instructions: z.string().nullable(),
    minBidSharePct: z.number(),
    extensions: z.number().int(),
    tranches: z.array(Tranche),
    invitations: z.array(RfpInvitation),
    myInvitation: RfpInvitation.nullable(),
    version: z.number().int(),
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Rfp' });
export const RfpActionBody = z.object({ reason: z.string().max(2000).optional(), workingDays: z.number().int().min(1).max(30).optional() });
export const Opportunity = z.object({ invitation: RfpInvitation, rfp: Rfp.omit({ invitations: true }) }).meta({ id: 'Opportunity' });

export const Question = z.object({ id: Uuid, rfpId: Uuid, askedByMe: z.boolean(), askedByOrgName: z.string().nullable(), question: z.string(), answer: z.string().nullable(), answeredAt: IsoDateTime.nullable(), published: z.boolean(), createdAt: IsoDateTime });
export const QuestionCreateBody = z.object({ question: z.string().min(5).max(4000) });
export const AnswerBody = z.object({ answer: z.string().min(2).max(8000), publish: z.boolean().default(true) });

const BidFields = z.object({
  trancheId: Uuid,
  amountXof: Xof.min(1),
  rateBps: z.number().int().min(0).max(10000),
  rateMethod: z.enum(RATE_METHODS),
  upfrontFeeBps: z.number().int().min(0).max(2000),
  tenorMonths: z.number().int().min(1).max(240),
  graceMonths: z.number().int().min(0).max(60),
  graceType: z.enum(GRACE_TYPES),
  repaymentProfile: z.enum(REPAYMENT_PROFILES),
  securityRequirements: z.array(z.enum(SECURITY_CODES)),
  cashCollateralPct: z.number().min(0).max(100),
  conditionsPrecedent: z.array(z.string().min(2).max(300)).max(20),
  daysToDisbursement: z.number().int().min(1).max(365),
  validUntil: IsoDate,
  acceptsPartial: z.boolean(),
  comments: z.string().max(4000).nullable(),
});
export const BidCreateBody = BidFields.partial().required({ trancheId: true, amountXof: true, rateBps: true, rateMethod: true, tenorMonths: true, repaymentProfile: true, daysToDisbursement: true, validUntil: true });
export const BidUpdateBody = BidFields.omit({ trancheId: true }).partial();
export const BID_STATUSES = ['draft', 'submitted', 'withdrawn', 'opened', 'awarded', 'not_awarded', 'expired'] as const;
export const Bid = BidFields.extend({ id: Uuid, rfpId: Uuid, lenderOrgId: Uuid, lenderName: z.string(), status: z.enum(BID_STATUSES), sharePct: z.number(), earBps: z.number().int(), submittedAt: IsoDateTime.nullable(), version: z.number().int(), allowedActions: AllowedActions }).meta({ id: 'Bid' });
export const BidPreviewBody = BidFields.pick({ amountXof: true, rateBps: true, rateMethod: true, upfrontFeeBps: true, tenorMonths: true, graceMonths: true, graceType: true, repaymentProfile: true }).extend({ trancheId: Uuid.optional() });
export const BidPreview = z.object({ earBps: z.number().int(), schedule: z.array(z.object({ seq: z.number().int(), month: z.number().int(), principalXof: Xof, interestXof: Xof, feesXof: Xof, totalXof: Xof })), totalInterestXof: Xof, upfrontFeeXof: Xof }).meta({ id: 'BidPreview' });

export const Evaluation = z
  .object({
    tranches: z.array(
      z.object({
        trancheId: Uuid,
        amountXof: Xof,
        evaluations: z.array(z.object({ bidId: Uuid, lenderName: z.string(), amountXof: Xof, effectiveAnnualRateBps: z.number().int(), scoreCost: z.number(), scoreShare: z.number(), scoreSpeed: z.number(), scoreConditions: z.number(), totalScore: z.number(), rank: z.number().int() })),
        suggestedAllocation: z.array(z.object({ bidId: Uuid, amountXof: Xof })),
        weightedEarBps: z.number().int().nullable(),
      }),
    ),
  })
  .meta({ id: 'Evaluation' });
export const AwardBody = z.object({ awards: z.array(z.object({ bidId: Uuid, amountXof: Xof.min(1) })).min(1) });
export const Award = z.object({ id: Uuid, rfpId: Uuid, bidId: Uuid, trancheId: Uuid, lenderOrgId: Uuid, lenderName: z.string(), amountXof: Xof, status: z.enum(['proposed', 'accepted_by_lender', 'declined_by_lender', 'cancelled']), decidedAt: IsoDateTime.nullable(), lenderResponseAt: IsoDateTime.nullable(), declineReason: z.string().nullable(), blockName: z.string(), rfpRef: z.string(), allowedActions: AllowedActions }).meta({ id: 'Award' });
export const AwardResponseBody = z.object({ reason: z.string().max(2000).optional() });
