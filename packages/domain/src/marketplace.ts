import { dec, roundRatio, roundXof, type Dec } from './money';
import { buildSchedule, type GraceType, type RateMethod, type RepaymentProfile } from './schedule';
import { annualise, irrMonthly } from './irr';

export const MARKETPLACE_ENGINE_VERSION = 'marketplace-1.0.0';

// ---------------------------------------------------------------- §9.3 matching

export interface MatchSummary {
  cropIds: string[];
  region: string;
  readinessScore: number;
  minBidSharePct: number;
  tranches: { trancheId: string; type: 'seasonal' | 'investment'; amountXof: number; requestedTenorMonths: number }[];
  riskCovers: { type: string; status: string; coveragePct: number }[];
}

export interface LenderProfileInput {
  profileId: string;
  lenderOrgId: string;
  active: boolean;
  cropIds: string[];
  regions: string[];
  trancheTypes: string[];
  minTicketXof: number;
  maxTicketXof: number;
  minReadinessScore: number;
  maxTenorMonths: number;
  requiresGuarantee: boolean;
  minGuaranteePct: number;
  requiresInsurance: boolean;
}

export interface MatchResult {
  profileId: string;
  lenderOrgId: string;
  matched: boolean;
  trancheIds: string[];
  reasons: string[];
  failed: string[];
}

const COMMITTED = ['committed', 'active'];

/** Lender matching (SPEC §9.3). A profile matches if the global checks pass and at least one tranche passes all tranche checks. */
export function matchLenders(s: MatchSummary, profiles: LenderProfileInput[]): MatchResult[] {
  return profiles.map((p) => {
    const reasons: string[] = [];
    const failed: string[] = [];
    const check = (code: string, ok: boolean) => (ok ? reasons : failed).push(code);
    check('ACTIVE', p.active);
    check('CROP', p.cropIds.length === 0 || s.cropIds.some((c) => p.cropIds.includes(c)));
    check('REGION', p.regions.length === 0 || p.regions.some((r) => r.toLowerCase() === s.region.toLowerCase()));
    check('READINESS', s.readinessScore >= p.minReadinessScore);
    const guarantee = Math.max(0, ...s.riskCovers.filter((c) => c.type === 'guarantee' && COMMITTED.includes(c.status)).map((c) => c.coveragePct));
    check('GUARANTEE', !p.requiresGuarantee || guarantee >= Math.max(p.minGuaranteePct, 0.0001));
    check('INSURANCE', !p.requiresInsurance || s.riskCovers.some((c) => (c.type === 'index_insurance' || c.type === 'indemnity_insurance') && COMMITTED.includes(c.status)));
    const trancheFails = new Set<string>();
    const trancheIds = s.tranches
      .filter((t) => {
        const minShare = dec(t.amountXof).times(s.minBidSharePct).div(100);
        const tests: [string, boolean][] = [
          ['TRANCHE_TYPE', p.trancheTypes.includes(t.type)],
          ['TICKET', (minShare.gte(p.minTicketXof) || t.amountXof >= p.minTicketXof) && dec(p.maxTicketXof).gte(minShare)],
          ['TENOR', t.requestedTenorMonths <= p.maxTenorMonths],
        ];
        tests.filter(([, ok]) => !ok).forEach(([c]) => trancheFails.add(c));
        return tests.every(([, ok]) => ok);
      })
      .map((t) => t.trancheId);
    if (trancheIds.length) reasons.push('TRANCHE_TYPE', 'TICKET', 'TENOR');
    else failed.push(...trancheFails);
    return { profileId: p.profileId, lenderOrgId: p.lenderOrgId, matched: failed.length === 0 && trancheIds.length > 0, trancheIds, reasons: [...new Set(reasons)], failed: [...new Set(failed)] };
  });
}

// ---------------------------------------------------------------- §9.4 bid evaluation

export interface BidTerms {
  amountXof: number;
  rateBps: number;
  rateMethod: RateMethod;
  upfrontFeeBps: number;
  tenorMonths: number;
  graceMonths: number;
  graceType: GraceType;
  repaymentProfile: RepaymentProfile;
  harvestMonths?: number[];
}

/** Lender cash flows and EAR: m0 = −(amount − fee), then schedule totals; EAR = (1+r)^12 − 1 in bps (half-even). */
export function bidEar(b: BidTerms): { earBps: number; flows: number[]; monthlyRate: Dec | null } {
  const fee = roundXof(dec(b.amountXof).times(b.upfrontFeeBps).div(10000));
  const lines = buildSchedule({ principalXof: b.amountXof, rateBps: b.rateBps, rateMethod: b.rateMethod, tenorMonths: b.tenorMonths, graceMonths: b.graceMonths, graceType: b.graceType, repaymentProfile: b.repaymentProfile, harvestMonths: b.harvestMonths });
  const last = Math.max(0, ...lines.map((l) => l.month));
  const flows = Array.from({ length: last + 1 }, () => 0);
  flows[0] = -(b.amountXof - fee);
  for (const l of lines) flows[l.month] = flows[l.month]! + l.totalXof;
  const r = irrMonthly(flows);
  return { earBps: r === null ? 0 : roundXof(annualise(r).times(10000)), flows, monthlyRate: r };
}

export interface BidInput extends BidTerms {
  bidId: string;
  daysToDisbursement: number;
  securityRequirements: string[];
  conditionsPrecedent: string[];
  cashCollateralPct: number;
  submittedAt: string;
  acceptsPartial: boolean;
}

export interface BidEvaluation {
  bidId: string;
  effectiveAnnualRateBps: number;
  scoreCost: number;
  scoreShare: number;
  scoreSpeed: number;
  scoreConditions: number;
  totalScore: number;
  rank: number;
}

export const DEFAULT_BID_WEIGHTS = { cost: 0.5, share: 0.2, speed: 0.15, conditions: 0.15 };
const STANDARD_SECURITY = ['escrow_domiciliation', 'guarantee_fongip', 'insurance', 'group_guarantee'];

/** Bid evaluation (SPEC §9.4): component scores, weighted total, rank, greedy suggested allocation. */
export function evaluateBids(
  tranche: { trancheId: string; amountXof: number; minBidSharePct: number; harvestMonths?: number[] },
  bids: BidInput[],
  weights = DEFAULT_BID_WEIGHTS,
): { evaluations: BidEvaluation[]; suggestedAllocation: { bidId: string; amountXof: number }[]; weightedEarBps: number | null } {
  if (!bids.length) return { evaluations: [], suggestedAllocation: [], weightedEarBps: null };
  const ears = new Map(bids.map((b) => [b.bidId, bidEar({ ...b, harvestMonths: b.harvestMonths ?? tranche.harvestMonths }).earBps]));
  const minEar = Math.min(...[...ears.values()].filter((e) => e > 0));
  const minDays = Math.max(1, Math.min(...bids.map((b) => Math.max(1, b.daysToDisbursement))));
  const evals = bids.map((b) => {
    const ear = ears.get(b.bidId)!;
    const cost = ear > 0 ? dec(100).times(minEar).div(ear) : dec(0);
    const share = Decimal.min(dec(100), dec(100).times(b.amountXof).div(tranche.amountXof));
    const speed = dec(100).times(minDays).div(Math.max(1, b.daysToDisbursement));
    const nonStandard = b.securityRequirements.filter((s) => !STANDARD_SECURITY.includes(s)).length;
    const conditions = Decimal.max(dec(0), dec(100).minus(15 * nonStandard).minus(10 * b.conditionsPrecedent.length).minus(b.cashCollateralPct));
    const total = cost.times(weights.cost).plus(share.times(weights.share)).plus(speed.times(weights.speed)).plus(conditions.times(weights.conditions));
    return { b, ear, cost, share, speed, conditions, total };
  });
  const ranked = [...evals].sort((x, y) => {
    const c = y.total.comparedTo(x.total);
    return c !== 0 ? c : x.b.submittedAt < y.b.submittedAt ? -1 : x.b.submittedAt > y.b.submittedAt ? 1 : 0;
  });
  const evaluations = ranked.map((e, i) => ({
    bidId: e.b.bidId,
    effectiveAnnualRateBps: e.ear,
    scoreCost: roundRatio(e.cost),
    scoreShare: roundRatio(e.share),
    scoreSpeed: roundRatio(e.speed),
    scoreConditions: roundRatio(e.conditions),
    totalScore: roundRatio(e.total),
    rank: i + 1,
  }));
  // Greedy by ascending EAR (ties: earlier submission); partials only if accepted and ≥ min share.
  const minPartial = dec(tranche.amountXof).times(tranche.minBidSharePct).div(100);
  let remaining = tranche.amountXof;
  const suggestedAllocation: { bidId: string; amountXof: number }[] = [];
  for (const e of [...evals].sort((x, y) => x.ear - y.ear || (x.b.submittedAt < y.b.submittedAt ? -1 : 1))) {
    if (remaining <= 0) break;
    if (e.b.amountXof <= remaining) {
      suggestedAllocation.push({ bidId: e.b.bidId, amountXof: e.b.amountXof });
      remaining -= e.b.amountXof;
    } else if (e.b.acceptsPartial && dec(remaining).gte(minPartial)) {
      suggestedAllocation.push({ bidId: e.b.bidId, amountXof: remaining });
      remaining = 0;
    }
  }
  return { evaluations, suggestedAllocation, weightedEarBps: weightedEar(suggestedAllocation, ears) };
}

/** Amount-weighted average EAR of a selection (bps, half-even). */
export function weightedEar(selection: { bidId: string; amountXof: number }[], ears: Map<string, number>): number | null {
  const total = selection.reduce((s, a) => s + a.amountXof, 0);
  if (total <= 0) return null;
  return roundXof(selection.reduce((s, a) => s.plus(dec(ears.get(a.bidId) ?? 0).times(a.amountXof)), dec(0)).div(total));
}

const Decimal = { min: (a: Dec, b: Dec) => (a.lt(b) ? a : b), max: (a: Dec, b: Dec) => (a.gt(b) ? a : b) };
