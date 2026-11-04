import { z } from 'zod';
import { AllowedActions, IsoDateTime, Uuid, Xof } from './common';

export const RATE_METHODS = ['flat', 'declining'] as const;
export const REPAYMENT_PROFILES = ['bullet', 'seasonal', 'annuity', 'equal_principal'] as const;
export const GRACE_TYPES = ['interest_only', 'capitalised'] as const;
export const BORROWER_TYPES = ['operator', 'farmers', 'farmer_group'] as const;
export const SCENARIO_CODES = ['base', 'yield_minus_20', 'price_minus_15', 'combined', 'delay_2m'] as const;

export const SeasonalTerms = z.object({
  amountXof: Xof.min(0).optional(),
  rateBps: z.number().int().min(0).max(10000),
  rateMethod: z.enum(RATE_METHODS),
  upfrontFeeBps: z.number().int().min(0).max(2000),
  tenorMonths: z.number().int().min(1).max(36),
  repaymentProfile: z.enum(REPAYMENT_PROFILES),
  feesChargedTo: z.enum(['operator', 'farmers']),
  borrowerType: z.enum(BORROWER_TYPES),
});
export const InvestmentTerms = z.object({
  amountXof: Xof.min(0).optional(),
  rateBps: z.number().int().min(0).max(10000),
  rateMethod: z.enum(RATE_METHODS),
  upfrontFeeBps: z.number().int().min(0).max(2000),
  tenorMonths: z.number().int().min(1).max(180),
  graceMonths: z.number().int().min(0).max(60),
  graceType: z.enum(GRACE_TYPES),
  repaymentProfile: z.enum(REPAYMENT_PROFILES),
});
export const ModelAssumptions = z
  .object({ seasonId: Uuid, seasonal: SeasonalTerms.nullable(), investment: InvestmentTerms.nullable(), seasonsPerYear: z.number().int().min(1).max(4), discountRateBps: z.number().int().min(0).max(10000), version: z.number().int() })
  .meta({ id: 'ModelAssumptions' });
export const ModelAssumptionsBody = z.object({ seasonal: SeasonalTerms.nullable(), investment: InvestmentTerms.nullable(), seasonsPerYear: z.number().int().min(1).max(4).default(1), discountRateBps: z.number().int().min(0).max(10000).default(1200) });

const FarmerResult = z.object({ farmerId: Uuid, ha: z.number(), grossRevenueXof: Xof, seasonalDebtDueXof: Xof, investmentFeeXof: Xof, landFeeXof: Xof, operatorServiceFeeXof: Xof, farmerCashCostsXof: Xof, netIncomeXof: Xof, valueCreatedXof: Xof.nullable(), hcr: z.number().nullable() });
const BlockResult = z.object({ grossRevenueXof: Xof, seasonalDebtDueXof: Xof, hcr: z.number().nullable(), breakevenYieldMultiplier: z.number().nullable(), breakevenPriceMultiplier: z.number().nullable(), minDscr: z.number().nullable(), avgDscr: z.number().nullable(), operatorNpvXof: Xof, operatorIrr: z.number().nullable(), paybackMonth: z.number().int().nullable() });
const Scenario = z.object({ farmers: z.array(FarmerResult), block: BlockResult, monthlyCashflow: z.array(z.object({ month: z.number().int(), inflowXof: Xof, outflowXof: Xof, netXof: Xof, cumulativeXof: Xof })) });
export const ModelOutput = z
  .object({
    engineVersion: z.string(),
    inputsHash: z.string(),
    scenarios: z.object({ base: Scenario, yield_minus_20: Scenario, price_minus_15: Scenario, combined: Scenario, delay_2m: Scenario }),
    details: z.record(z.string(), z.unknown()),
    breakevenYieldByCrop: z.array(z.object({ cropId: z.string(), yieldTHa: z.number() })),
    tranches: z.object({ seasonalAmountXof: Xof, investmentAmountXof: Xof }),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  })
  .meta({ id: 'ModelOutput' });
export const ModelRun = z.object({ id: Uuid, blockId: Uuid, seasonId: Uuid, engineVersion: z.string(), inputsHash: z.string(), current: z.boolean(), computedAt: IsoDateTime, outputs: ModelOutput }).meta({ id: 'ModelRun' });
export const ModelPreviewBody = z.object({ yieldShockPct: z.number().min(-100).max(100).default(0), priceShockPct: z.number().min(-100).max(100).default(0), seasonalRateBps: z.number().int().min(0).max(10000).optional() });

// ---------------------------------------------------------------- readiness & dossier
export const GateResult = z.object({ code: z.string(), pass: z.boolean(), reasons: z.array(z.object({ code: z.string(), entityIds: z.array(z.string()) })) });
export const Readiness = z
  .object({
    engineVersion: z.string(),
    gates: z.array(GateResult),
    allGatesPass: z.boolean(),
    breakdown: z.object({ landSecurity: z.number(), offtakeStrength: z.number(), financialRobustness: z.number(), farmerQuality: z.number(), riskCover: z.number(), operatorCapacity: z.number(), dataCompleteness: z.number() }),
    rawScore: z.number(),
    score: z.number().int(),
    grade: z.enum(['A', 'B', 'C', 'D']),
  })
  .meta({ id: 'Readiness' });
export const DataRoomItem = z.object({ fileId: Uuid, label: z.string(), category: z.string(), filename: z.string().optional(), mime: z.string().optional() });
export const Dossier = z
  .object({
    id: Uuid,
    ref: z.string(),
    blockId: Uuid,
    seasonId: Uuid,
    version: z.number().int(),
    status: z.enum(['draft', 'frozen', 'superseded']),
    readinessScore: z.number().int(),
    grade: z.enum(['A', 'B', 'C', 'D']),
    gates: z.array(GateResult),
    scoreBreakdown: z.record(z.string(), z.number()),
    modelRunId: Uuid,
    snapshot: z.record(z.string(), z.unknown()),
    contentSha256: z.string(),
    pdfFileId: Uuid.nullable(),
    pdfStatus: z.string(),
    dataRoom: z.array(DataRoomItem),
    frozenAt: IsoDateTime.nullable(),
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Dossier' });
export const CheckReadinessBody = z.object({ seasonId: Uuid });

export const RISK_COVER_TYPES = ['guarantee', 'index_insurance', 'indemnity_insurance', 'first_loss'] as const;
export const RISK_COVER_STATUSES = ['proposed', 'committed', 'active', 'expired'] as const;
export const RiskCover = z
  .object({ id: Uuid, blockId: Uuid, trancheId: Uuid.nullable(), type: z.enum(RISK_COVER_TYPES), providerOrgId: Uuid.nullable(), providerName: z.string(), coveragePct: z.number(), capXof: Xof.nullable(), premiumXof: Xof.nullable(), status: z.enum(RISK_COVER_STATUSES), fileId: Uuid.nullable(), version: z.number().int() })
  .meta({ id: 'RiskCover' });
export const RiskCoverCreateBody = z.object({ type: z.enum(RISK_COVER_TYPES), providerOrgId: Uuid.nullable().optional(), providerName: z.string().min(2), coveragePct: z.number().min(0).max(100), capXof: Xof.min(0).nullable().optional(), premiumXof: Xof.min(0).nullable().optional(), status: z.enum(RISK_COVER_STATUSES).default('proposed'), fileId: Uuid.nullable().optional(), trancheId: Uuid.nullable().optional() });
export const RiskCoverUpdateBody = RiskCoverCreateBody.partial();
