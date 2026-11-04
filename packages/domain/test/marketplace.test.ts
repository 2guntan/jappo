import { describe, expect, it } from 'vitest';
import { evaluateBids, matchLenders, type BidInput, type LenderProfileInput, type MatchSummary } from '../src';

const summary: MatchSummary = {
  cropIds: ['maize'],
  region: 'Ziguinchor',
  readinessScore: 72,
  minBidSharePct: 20,
  tranches: [{ trancheId: 'T1', type: 'seasonal', amountXof: 3_000_000, requestedTenorMonths: 6 }],
  riskCovers: [{ type: 'guarantee', status: 'committed', coveragePct: 80 }],
};
const profile = (o: Partial<LenderProfileInput> = {}): LenderProfileInput => ({
  profileId: 'P', lenderOrgId: 'L', active: true, cropIds: [], regions: [], trancheTypes: ['seasonal'], minTicketXof: 500_000, maxTicketXof: 10_000_000,
  minReadinessScore: 60, maxTenorMonths: 12, requiresGuarantee: false, minGuaranteePct: 0, requiresInsurance: false, ...o,
});

describe('matchLenders (SPEC §9.3)', () => {
  it('matches with reasons and rejects on each criterion', () => {
    const [m] = matchLenders(summary, [profile()]);
    expect(m!.matched).toBe(true);
    expect(m!.trancheIds).toEqual(['T1']);
    expect(m!.reasons).toEqual(expect.arrayContaining(['ACTIVE', 'CROP', 'REGION', 'TRANCHE_TYPE', 'TICKET', 'READINESS', 'TENOR', 'GUARANTEE', 'INSURANCE']));
    const fail = (o: Partial<LenderProfileInput>) => matchLenders(summary, [profile(o)])[0]!;
    expect(fail({ active: false }).matched).toBe(false);
    expect(fail({ cropIds: ['rice'] }).failed).toContain('CROP');
    expect(fail({ regions: ['Thiès'] }).failed).toContain('REGION');
    expect(fail({ trancheTypes: ['investment'] }).failed).toContain('TRANCHE_TYPE');
    expect(fail({ minTicketXof: 4_000_000 }).failed).toContain('TICKET');
    expect(fail({ maxTicketXof: 100_000 }).failed).toContain('TICKET');
    expect(fail({ minReadinessScore: 80 }).failed).toContain('READINESS');
    expect(fail({ maxTenorMonths: 3 }).failed).toContain('TENOR');
    expect(fail({ requiresGuarantee: true, minGuaranteePct: 90 }).failed).toContain('GUARANTEE');
    expect(fail({ requiresInsurance: true }).failed).toContain('INSURANCE');
    // share-based ticket: 20 % of 3 000 000 = 600 000 ≥ min ticket 500 000
    expect(fail({ minTicketXof: 600_000 }).matched).toBe(true);
  });
});

const bid = (o: Partial<BidInput>): BidInput => ({
  bidId: 'B', amountXof: 3_000_000, rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'bullet',
  daysToDisbursement: 10, securityRequirements: ['escrow_domiciliation'], conditionsPrecedent: [], cashCollateralPct: 0, submittedAt: '2026-11-10T10:00:00Z', acceptsPartial: true, ...o,
});

describe('evaluateBids (SPEC §9.4)', () => {
  it('scores, ranks and allocates (acceptance scenario bids)', () => {
    const alpha = bid({ bidId: 'alpha' });
    const gamma = bid({ bidId: 'gamma', rateBps: 2000, upfrontFeeBps: 0, daysToDisbursement: 5, submittedAt: '2026-11-11T10:00:00Z' });
    const r = evaluateBids({ trancheId: 'T1', amountXof: 3_000_000, minBidSharePct: 20 }, [alpha, gamma]);
    const a = r.evaluations.find((e) => e.bidId === 'alpha')!;
    const g = r.evaluations.find((e) => e.bidId === 'gamma')!;
    expect(a.effectiveAnnualRateBps).toBe(2122);
    expect(g.effectiveAnnualRateBps).toBe(2100);
    expect(g.scoreCost).toBe(100);
    expect(a.scoreCost).toBe(98.96);
    expect(a.scoreSpeed).toBe(50);
    expect(g.rank).toBe(1);
    expect(r.suggestedAllocation).toEqual([{ bidId: 'gamma', amountXof: 3_000_000 }]);
    expect(r.weightedEarBps).toBe(2100);
  });
  it('applies condition penalties, partial allocation rules and tie-breaks', () => {
    const b1 = bid({ bidId: 'b1', amountXof: 2_000_000, securityRequirements: ['equipment_pledge', 'personal_guarantee'], conditionsPrecedent: ['cp1'], cashCollateralPct: 10 });
    const b2 = bid({ bidId: 'b2', amountXof: 2_000_000, rateBps: 1900, acceptsPartial: false });
    const b3 = bid({ bidId: 'b3', amountXof: 2_000_000, rateBps: 1950, submittedAt: '2026-11-09T10:00:00Z' });
    const r = evaluateBids({ trancheId: 'T1', amountXof: 3_000_000, minBidSharePct: 20 }, [b1, b2, b3]);
    expect(r.evaluations.find((e) => e.bidId === 'b1')!.scoreConditions).toBe(50);
    expect(r.evaluations.find((e) => e.bidId === 'b1')!.scoreShare).toBe(66.67);
    // greedy by ascending EAR: b1 2 000 000, b2 cannot be partial → skipped, b3 takes remaining 1 000 000 (≥ 20 %)
    expect(r.suggestedAllocation).toEqual([{ bidId: 'b1', amountXof: 2_000_000 }, { bidId: 'b3', amountXof: 1_000_000 }]);
    const tiny = evaluateBids({ trancheId: 'T1', amountXof: 3_000_000, minBidSharePct: 20 }, [bid({ bidId: 'x', amountXof: 2_800_000 }), bid({ bidId: 'y', amountXof: 1_000_000, rateBps: 1900 })]);
    // remaining 200 000 < 20 % of tranche → y not taken partially
    expect(tiny.suggestedAllocation).toEqual([{ bidId: 'x', amountXof: 2_800_000 }]);
    const tie = evaluateBids({ trancheId: 'T1', amountXof: 3_000_000, minBidSharePct: 20 }, [bid({ bidId: 'late', submittedAt: '2026-11-12T00:00:00Z' }), bid({ bidId: 'early', submittedAt: '2026-11-01T00:00:00Z' })]);
    expect(tie.evaluations.find((e) => e.bidId === 'early')!.rank).toBe(1);
    expect(evaluateBids({ trancheId: 'T1', amountXof: 1, minBidSharePct: 20 }, []).evaluations).toEqual([]);
  });
});
