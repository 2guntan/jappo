import { describe, expect, it } from 'vitest';
import { addMonthsIso, allocateFacility, buildSchedule, datedSchedule, daysOverdue, harvestMonthsFor, upfrontFeeXof } from '../src';

describe('facility helpers', () => {
  it('adds months with end-of-month clamping', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsIso('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsIso('2026-06-01', 0)).toBe('2026-06-01');
  });

  it('dates a schedule from the start date', () => {
    const lines = buildSchedule({ principalXof: 1_200_000, rateBps: 1200, rateMethod: 'declining', tenorMonths: 3, repaymentProfile: 'equal_principal' });
    const d = datedSchedule('2026-03-10', lines);
    expect(d.map((l) => l.dueDate)).toEqual(['2026-04-10', '2026-05-10', '2026-06-10']);
  });

  it('splits principal, interest and fees exactly pro rata to farmer credit', () => {
    const out = allocateFacility({
      principalXof: 1_000_000,
      interestXof: 100_001,
      feesXof: 3,
      farmers: [
        { farmerId: 'b', weightXof: 200_000 },
        { farmerId: 'a', weightXof: 100_000 },
        { farmerId: 'c', weightXof: 0 },
      ],
    });
    expect(out.map((o) => o.farmerId)).toEqual(['a', 'b']);
    expect(out.reduce((s, o) => s + o.principalXof, 0)).toBe(1_000_000);
    expect(out.reduce((s, o) => s + o.interestXof, 0)).toBe(100_001);
    expect(out.reduce((s, o) => s + o.feesXof, 0)).toBe(3);
    expect(out[0]).toMatchObject({ principalXof: 333_333, interestXof: 33_334, feesXof: 1 });
    expect(out[1]).toMatchObject({ principalXof: 666_667, interestXof: 66_667, feesXof: 2 });
    for (const o of out) expect(o.dueXof).toBe(o.principalXof + o.interestXof + o.feesXof);
  });

  it('computes upfront fee half-even and overdue days', () => {
    expect(upfrontFeeXof(1_000_000, 150)).toBe(15_000);
    expect(upfrontFeeXof(50, 100)).toBe(0); // 0.5 → 0 (half-even)
    expect(upfrontFeeXof(150, 100)).toBe(2); // 1.5 → 2
    expect(daysOverdue('2026-05-01', '2026-05-11', 10)).toBe(10);
    expect(daysOverdue('2026-05-01', '2026-04-11', 10)).toBe(0);
    expect(daysOverdue('2026-05-01', '2026-05-11', 0)).toBe(0);
  });
});

describe('harvestMonthsFor', () => {
  it('repeats the last harvest month every 12 months within the tenor', () => {
    expect(harvestMonthsFor([4, 6], 30)).toEqual([6, 18, 30]);
    expect(harvestMonthsFor([], 12)).toEqual([6]);
    expect(harvestMonthsFor([14], 12)).toEqual([]);
  });
});
