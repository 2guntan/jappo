import { z } from 'zod';
import { AllowedActions, Bps, IsoDate, IsoDateTime, Uuid, Xof } from './common';
import { GeoPoint } from './geo';
import { BORROWER_TYPES, GRACE_TYPES, RATE_METHODS, REPAYMENT_PROFILES } from './finance';

export const CONTRACT_TYPES = ['block_framework', 'plot_production', 'offtake', 'loan_seasonal', 'loan_investment', 'escrow_mandate'] as const;
export const CONTRACT_STATUSES = ['draft', 'out_for_signature', 'partially_signed', 'signed', 'voided'] as const;

export const ContractTemplate = z
  .object({
    id: Uuid,
    code: z.enum(CONTRACT_TYPES),
    locale: z.string(),
    templateVersion: z.number().int(),
    title: z.string(),
    bodyHbs: z.string(),
    variablesSchema: z.array(z.object({ name: z.string(), editable: z.boolean().optional(), description: z.string().optional() })),
    active: z.boolean(),
    updatedAt: IsoDateTime,
    version: z.number().int(),
  })
  .meta({ id: 'ContractTemplate' });
export const ContractTemplateUpdateBody = z.object({
  title: z.string().min(3).max(200).optional(),
  bodyHbs: z.string().min(20).max(200_000).optional(),
  variablesSchema: z.array(z.object({ name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), editable: z.boolean().optional(), description: z.string().max(500).optional() })).max(50).optional(),
});

const Clauses = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), z.string().max(10_000));

export const ContractParty = z
  .object({
    id: Uuid,
    partyType: z.enum(['org', 'farmer']),
    orgId: Uuid.nullable(),
    farmerId: Uuid.nullable(),
    name: z.string(),
    roleLabel: z.string(),
    signOrder: z.number().int(),
    signedAt: IsoDateTime.nullable(),
    signatureMethod: z.enum(['otp_sms', 'otp_email', 'in_person_witnessed']).nullable(),
    signerName: z.string().nullable(),
    canSign: z.boolean(),
  })
  .meta({ id: 'ContractParty' });

export const Contract = z
  .object({
    id: Uuid,
    ref: z.string(),
    type: z.enum(CONTRACT_TYPES),
    title: z.string(),
    templateVersion: z.number().int(),
    locale: z.string(),
    blockId: Uuid,
    blockRef: z.string(),
    blockName: z.string(),
    seasonId: Uuid.nullable(),
    relatedType: z.string(),
    relatedId: Uuid,
    status: z.enum(CONTRACT_STATUSES),
    clauses: z.record(z.string(), z.string()),
    editableClauses: z.array(z.object({ name: z.string(), description: z.string().nullable() })),
    contentSha256: z.string().nullable(),
    hasPdf: z.boolean(),
    hasSignedPdf: z.boolean(),
    sentAt: IsoDateTime.nullable(),
    signedAt: IsoDateTime.nullable(),
    voidedAt: IsoDateTime.nullable(),
    voidReason: z.string().nullable(),
    parties: z.array(ContractParty),
    createdAt: IsoDateTime,
    version: z.number().int(),
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Contract' });

export const ContractCreateBody = z.object({
  type: z.enum(CONTRACT_TYPES),
  relatedId: Uuid,
  seasonId: Uuid.nullish(),
  locale: z.enum(['fr', 'en']).optional(),
  clauses: Clauses.optional(),
});
export const ContractUpdateBody = z.object({ clauses: Clauses.optional(), refresh: z.boolean().optional() });
export const ContractListQuery = z.object({ blockId: Uuid.optional(), seasonId: Uuid.optional(), type: z.enum(CONTRACT_TYPES).optional(), status: z.enum(CONTRACT_STATUSES).optional(), relatedId: Uuid.optional() });
export const ContractVoidBody = z.object({ reason: z.string().min(3).max(2000) });
export const SignatureOtpBody = z.object({ partyId: Uuid.optional(), channel: z.enum(['sms', 'email']).optional() });
export const SignatureOtpResult = z.object({ partyId: Uuid, channel: z.enum(['sms', 'email']), destination: z.string() }).meta({ id: 'SignatureOtpResult' });
export const SignBody = z.object({
  partyId: Uuid.optional(),
  method: z.enum(['otp', 'in_person_witnessed']),
  code: z.string().regex(/^\d{6}$/).optional(),
  channel: z.enum(['sms', 'email']).optional(),
  evidenceFileId: Uuid.optional(),
  geo: GeoPoint.nullish(),
});
export const GeneratePackBody = z.object({ seasonId: Uuid, send: z.boolean().default(false), locale: z.enum(['fr', 'en']).optional() });

// ---------------------------------------------------------------- facilities

export const FACILITY_STATUSES = ['pending_cp', 'active', 'in_arrears', 'repaid', 'defaulted', 'restructured'] as const;
export const DISBURSEMENT_STATUSES = ['requested', 'approved', 'executed', 'confirmed', 'rejected'] as const;

export const ScheduleLineOut = z.object({ seq: z.number().int(), dueDate: IsoDate, principalXof: Xof, interestXof: Xof, feesXof: Xof, totalXof: Xof, paidXof: Xof, status: z.enum(['due', 'paid', 'partial', 'overdue']) }).meta({ id: 'FacilityScheduleLine' });
export const FacilityFarmerAllocation = z.object({ farmerId: Uuid, farmerCode: z.string(), principalXof: Xof, interestXof: Xof, feesXof: Xof, dueXof: Xof }).meta({ id: 'FacilityFarmerAllocation' });

export const Facility = z
  .object({
    id: Uuid,
    ref: z.string(),
    awardId: Uuid,
    trancheType: z.enum(['seasonal', 'investment']),
    lenderOrgId: Uuid,
    lenderName: z.string(),
    operatorOrgId: Uuid,
    operatorName: z.string(),
    blockId: Uuid,
    blockRef: z.string(),
    blockName: z.string(),
    seasonId: Uuid,
    borrowerType: z.enum(BORROWER_TYPES),
    borrowerOrgId: Uuid.nullable(),
    principalXof: Xof,
    rateBps: Bps,
    rateMethod: z.enum(RATE_METHODS),
    upfrontFeeBps: Bps,
    upfrontFeeXof: Xof,
    tenorMonths: z.number().int(),
    graceMonths: z.number().int(),
    graceType: z.enum(GRACE_TYPES),
    repaymentProfile: z.enum(REPAYMENT_PROFILES),
    startDate: IsoDate,
    maturityDate: IsoDate,
    escrowAccountId: Uuid.nullable(),
    lenderLoanRef: z.string().nullable(),
    status: z.enum(FACILITY_STATUSES),
    activatedAt: IsoDateTime.nullable(),
    requestedXof: Xof,
    disbursedXof: Xof,
    repaidXof: Xof,
    repaidPrincipalXof: Xof,
    outstandingPrincipalXof: Xof,
    overdueXof: Xof,
    oldestOverdueDate: IsoDate.nullable(),
    conditionsPrecedent: z.array(z.object({ code: z.string(), met: z.boolean() })),
    schedule: z.array(ScheduleLineOut),
    farmerAllocations: z.array(FacilityFarmerAllocation),
    version: z.number().int(),
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Facility' });

export const FacilityListQuery = z.object({ blockId: Uuid.optional(), seasonId: Uuid.optional(), status: z.enum(FACILITY_STATUSES).optional() });
export const FacilityUpdateBody = z.object({ lenderLoanRef: z.string().max(100).nullish(), escrowAccountId: Uuid.nullish() });
export const FacilityDefaultBody = z.object({ reason: z.string().min(3).max(2000) });
export const FacilityRestructureBody = z.object({ reason: z.string().min(3).max(2000), extendMonths: z.number().int().min(1).max(36) });

export const EscrowAccount = z
  .object({ id: Uuid, lenderOrgId: Uuid, lenderName: z.string(), blockId: Uuid, bankName: z.string(), accountLabel: z.string(), accountNumberMasked: z.string(), hasIban: z.boolean(), status: z.string(), createdAt: IsoDateTime })
  .meta({ id: 'EscrowAccount' });
export const EscrowAccountCreateBody = z.object({
  blockId: Uuid,
  bankName: z.string().min(2).max(200),
  accountLabel: z.string().min(2).max(200),
  accountNumber: z.string().regex(/^[A-Z0-9 -]{6,40}$/i),
  iban: z.string().regex(/^[A-Z]{2}[0-9A-Z ]{10,40}$/i).nullish(),
});

export const Disbursement = z
  .object({
    id: Uuid,
    ref: z.string(),
    facilityId: Uuid,
    facilityRef: z.string(),
    amountXof: Xof,
    purpose: z.string(),
    beneficiaryType: z.enum(['supplier', 'operator', 'farmer']),
    beneficiaryOrgId: Uuid.nullable(),
    beneficiaryFarmerId: Uuid.nullable(),
    beneficiaryName: z.string(),
    budgetLineIds: z.array(Uuid),
    capexItemIds: z.array(Uuid),
    status: z.enum(DISBURSEMENT_STATUSES),
    requestedBy: Uuid.nullable(),
    approvedBy: Uuid.nullable(),
    approvedAt: IsoDateTime.nullable(),
    executedBy: Uuid.nullable(),
    executedAt: IsoDateTime.nullable(),
    confirmedBy: Uuid.nullable(),
    confirmedAt: IsoDateTime.nullable(),
    bankReference: z.string().nullable(),
    proofFileId: Uuid.nullable(),
    rejectReason: z.string().nullable(),
    createdAt: IsoDateTime,
    version: z.number().int(),
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Disbursement' });
export const DisbursementCreateBody = z.object({
  amountXof: Xof.min(1),
  purpose: z.string().min(3).max(500),
  beneficiaryType: z.enum(['supplier', 'operator', 'farmer']),
  beneficiaryOrgId: Uuid.nullish(),
  beneficiaryFarmerId: Uuid.nullish(),
  beneficiaryName: z.string().max(200).nullish(),
  budgetLineIds: z.array(Uuid).max(500).optional(),
  capexItemIds: z.array(Uuid).max(500).optional(),
});
export const DisbursementActionBody = z.object({ reason: z.string().max(2000).optional(), bankReference: z.string().max(100).optional(), proofFileId: Uuid.nullish() });

export const Repayment = z
  .object({ id: Uuid, facilityId: Uuid, settlementRunId: Uuid.nullable(), amountXof: Xof, principalXof: Xof, interestXof: Xof, feesXof: Xof, valueDate: IsoDate, source: z.enum(['settlement', 'direct', 'guarantee_call', 'insurance']), reference: z.string().nullable(), createdAt: IsoDateTime })
  .meta({ id: 'Repayment' });
