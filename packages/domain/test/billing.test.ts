import { describe, expect, it } from 'vitest';
import { billingStatusFor, invoiceTotals, nextWebhookAttempt, structuringFeeXof } from '../src';

describe('billing helpers', () => {
  it('computes invoice totals with VAT 18 %', () => {
    const r = invoiceTotals([{ description: 'Abonnement 3 ha', qty: 3, unitPriceXof: 5000 }, { description: 'Frais', qty: 0.5, unitPriceXof: 1001 }], 1800);
    expect(r.lines.map((l) => l.amountXof)).toEqual([15_000, 500]); // 500.5 → 500 (half-even)
    expect(r).toMatchObject({ amountXof: 15_500, taxXof: 2_790, totalXof: 18_290 });
    expect(structuringFeeXof(3_000_000, 100)).toBe(30_000);
    expect(structuringFeeXof(150, 100)).toBe(2); // 1.5 → 2
  });
  it('derives billing status from overdue days', () => {
    expect([0, 30, 31, 60, 61].map((d) => billingStatusFor(d))).toEqual(['ok', 'ok', 'overdue', 'overdue', 'restricted']);
  });
  it('schedules webhook retries then gives up', () => {
    const t0 = new Date('2027-01-01T00:00:00Z');
    expect(nextWebhookAttempt(1, t0)!.toISOString()).toBe('2027-01-01T00:01:00.000Z');
    expect(nextWebhookAttempt(6, t0)!.toISOString()).toBe('2027-01-02T00:00:00.000Z');
    expect(nextWebhookAttempt(7, t0)).toBeNull();
  });
});
