import Decimal from 'decimal.js';

/** Decimal configured for financial maths: high precision, half-even at boundaries. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;
export type DecimalInput = Dec | number | string;

export const dec = (v: DecimalInput): Dec => new D(v);

/** Round half to even to an integer XOF amount (default money output rule, SPEC §4.3). */
export function roundXof(v: DecimalInput): number {
  return dec(v).toDecimalPlaces(0, D.ROUND_HALF_EVEN).toNumber();
}

/** Round a ratio half-even to `dp` decimals (SPEC §9.1.6: ratios to 2 decimals). */
export function roundRatio(v: DecimalInput, dp = 2): number {
  return dec(v).toDecimalPlaces(dp, D.ROUND_HALF_EVEN).toNumber();
}

export function floorXof(v: DecimalInput): number {
  return dec(v).floor().toNumber();
}

export interface SplitPart {
  key: string;
  weight: DecimalInput;
  /** Optional cap (inclusive) on the amount allocated to this part. */
  cap?: number;
}

/**
 * Split an integer `total` across parts pro rata to weight using the SPEC §9.6.4 rule:
 * floors for every part, then remaining XOF one at a time in descending order of fractional
 * part (ties broken by key ascending). Parts whose cap is reached are skipped.
 * Returns a map key → integer amount. Σ result = total unless every part is capped.
 */
export function splitProRata(total: number, parts: SplitPart[]): Map<string, number> {
  const out = new Map<string, number>();
  const sumW = parts.reduce((s, p) => s.plus(p.weight), dec(0));
  if (parts.length === 0) return out;
  if (sumW.lte(0)) {
    for (const p of parts) out.set(p.key, 0);
    return out;
  }
  const exact = parts.map((p) => {
    let share = dec(total).times(p.weight).div(sumW);
    if (p.cap !== undefined && share.gt(p.cap)) share = dec(p.cap);
    const fl = share.floor();
    return { key: p.key, cap: p.cap, floor: fl.toNumber(), frac: share.minus(fl) };
  });
  for (const e of exact) out.set(e.key, e.floor);
  let remaining = total - exact.reduce((s, e) => s + e.floor, 0);
  const order = [...exact].sort((a, b) => {
    const c = b.frac.comparedTo(a.frac);
    return c !== 0 ? c : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  // Distribute residual one XOF at a time, cycling in fractional order, skipping capped parts.
  while (remaining > 0) {
    let progressed = false;
    for (const e of order) {
      if (remaining <= 0) break;
      const cur = out.get(e.key) ?? 0;
      if (e.cap !== undefined && cur >= e.cap) continue;
      out.set(e.key, cur + 1);
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}

/** Format an integer XOF amount in fr-SN style: "1 308 000 FCFA". */
export function formatXof(amount: number | bigint): string {
  const s = BigInt(amount).toString();
  const neg = s.startsWith('-');
  const digits = neg ? s.slice(1) : s;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${grouped} FCFA`;
}
