/** Golden test BE-1 (SPEC §9.4). Contract: never change the expected number. */
import { describe, expect, it } from 'vitest';
import { bidEar } from '../src';

describe('BE-1 effective annual rate', () => {
  it('1 000 000, 18 % flat, 6 months bullet, upfront fee 1 % → 2122 bps (±1)', () => {
    const r = bidEar({ amountXof: 1_000_000, rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'bullet' });
    expect(r.flows[0]).toBe(-990_000);
    expect(r.flows[6]).toBe(1_090_000);
    expect(Math.abs(r.earBps - 2122)).toBeLessThanOrEqual(1);
  });
});
