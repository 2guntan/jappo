import { dec, roundXof } from './money';

export interface InvoiceLineInput {
  description: string;
  qty: number;
  unitPriceXof: number;
}

export interface PlatformInvoiceTotals {
  lines: (InvoiceLineInput & { amountXof: number })[];
  amountXof: number;
  taxXof: number;
  totalXof: number;
}

/** Platform invoice totals: each line qty × unit price (half-even), VAT on the sum (half-even, SPEC §7.17 18 % default). */
export function invoiceTotals(lines: readonly InvoiceLineInput[], vatBps: number): PlatformInvoiceTotals {
  const out = lines.map((l) => ({ ...l, amountXof: roundXof(dec(l.qty).times(l.unitPriceXof)) }));
  const amountXof = out.reduce((s, l) => s + l.amountXof, 0);
  const taxXof = roundXof(dec(amountXof).times(vatBps).div(10000));
  return { lines: out, amountXof, taxXof, totalXof: amountXof + taxXof };
}

/** Structuring fee on an awarded amount (bps, half-even). */
export const structuringFeeXof = (awardedXof: number, bps: number) => roundXof(dec(awardedXof).times(bps).div(10000));

export type BillingStatus = 'ok' | 'overdue' | 'restricted';
/** SPEC §15: overdue > 30 days → banner; > 60 days → read-only (settlement and statements never blocked). */
export function billingStatusFor(maxOverdueDays: number, bannerDays = 30, restrictDays = 60): BillingStatus {
  if (maxOverdueDays > restrictDays) return 'restricted';
  if (maxOverdueDays > bannerDays) return 'overdue';
  return 'ok';
}

/** Webhook retry schedule (SPEC §11.2): 1 m, 5 m, 30 m, 2 h, 12 h, 24 h, then failed. */
export const WEBHOOK_BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200, 86400] as const;
export function nextWebhookAttempt(attemptsSoFar: number, now: Date): Date | null {
  const s = WEBHOOK_BACKOFF_SECONDS[attemptsSoFar - 1];
  return s === undefined ? null : new Date(now.getTime() + s * 1000);
}
