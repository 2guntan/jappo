import { z } from 'zod';
import { IsoDate, IsoDateTime, Uuid, Xof } from './common';

const N = z.number().nullable();
export const Kpis = z
  .object({
    areaFinancedHa: z.number(),
    farmers: z.number().int(),
    womenPct: N,
    youthPct: N,
    disbursedXof: z.object({ seasonal: Xof, investment: Xof, total: Xof }),
    outstandingXof: z.object({ seasonal: Xof, investment: Xof, total: Xof }),
    par30Pct: N,
    par90Pct: N,
    repaymentRatePct: N,
    expectedKg: z.number(),
    deliveredKg: z.number(),
    deliveryRatePct: N,
    yieldAchievedTHa: N,
    yieldBaseTHa: N,
    yieldAchievedPctOfBase: N,
    buyerPaymentDelayDays: N,
    farmerNetIncomeAvgXof: N,
    farmerNetIncomeMedianXof: N,
    valueCreatedAvgXof: N,
    serviceCostPerFarmerXof: N,
    directCostRecoveryPct: N,
    daysSubmissionToFirstDisbursement: N,
    alerts: z.object({ info: z.number().int(), warning: z.number().int(), critical: z.number().int() }),
  })
  .meta({ id: 'Kpis' });
export const KpiQuery = z.object({ scopeType: z.enum(['block', 'season', 'lender_portfolio', 'platform']), scopeId: Uuid.optional(), from: IsoDate.optional(), to: IsoDate.optional() });
export const KpiSeries = z.object({ data: z.array(z.object({ date: IsoDate, metrics: Kpis })) }).meta({ id: 'KpiSeries' });

const AlertLite = z.object({ id: Uuid, severity: z.enum(['info', 'warning', 'critical']), message: z.string(), createdAt: IsoDateTime });
export const OperatorDashboard = z
  .object({
    blocksByStatus: z.record(z.string(), z.number().int()),
    blocks: z.array(z.object({ id: Uuid, ref: z.string(), name: z.string(), status: z.string(), region: z.string() })),
    kpis: Kpis,
    alerts: z.array(AlertLite.extend({ blockId: Uuid })),
    tasks: z.object({ contractsPendingSignature: z.number().int(), disbursementsInProgress: z.number().int(), settlementsOpen: z.number().int() }),
  })
  .meta({ id: 'OperatorDashboard' });
export const LenderDashboard = z
  .object({
    kpis: Kpis,
    facilities: z.array(z.object({ id: Uuid, ref: z.string(), blockRef: z.string(), blockName: z.string(), status: z.string(), principalXof: Xof, trancheType: z.string() })),
    pending: z.object({ cpToConfirm: z.number().int(), disbursements: z.number().int(), settlementsToApprove: z.number().int(), contractsToSign: z.number().int() }),
    openOpportunities: z.number().int(),
  })
  .meta({ id: 'LenderDashboard' });
export const BlockDashboard = z
  .object({
    block: z.object({ id: Uuid, ref: z.string(), name: z.string(), status: z.string() }),
    season: z.object({ id: Uuid, name: z.string(), status: z.string(), startDate: IsoDate, endDate: IsoDate }).nullable(),
    kpis: Kpis,
    harvestProgressPct: N,
    alerts: z.array(AlertLite.extend({ status: z.string() })),
    recentVisits: z.array(z.object({ plotCode: z.string(), visitedAt: IsoDateTime, healthScore: z.number().int(), cropStage: z.string() })),
  })
  .meta({ id: 'BlockDashboard' });
export const GuarantorDashboard = z
  .object({
    kpis: Kpis,
    claimThresholdDays: z.number().int(),
    totalExposureXof: Xof,
    facilities: z.array(z.object({ facilityId: Uuid, facilityRef: z.string(), blockId: Uuid, blockRef: z.string(), blockName: z.string(), lenderName: z.string(), coverType: z.string(), coveragePct: z.number(), outstandingXof: Xof, exposureXof: Xof, maxOverdueDays: z.number().int(), claimCandidate: z.boolean(), status: z.string() })),
  })
  .meta({ id: 'GuarantorDashboard' });

export const REPORT_TYPES = ['lender_monthly', 'season_close', 'guarantor_portfolio'] as const;
export const Report = z.object({ id: Uuid, type: z.enum(REPORT_TYPES), scopeId: Uuid.nullable(), period: z.string(), status: z.string(), hasPdf: z.boolean(), generatedAt: IsoDateTime.nullable(), createdAt: IsoDateTime }).meta({ id: 'Report' });
export const ReportCreateBody = z.object({ type: z.enum(REPORT_TYPES), scopeId: Uuid.nullish(), period: z.string().regex(/^\d{4}(-\d{2})?$/) });
