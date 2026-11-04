import { dec, type Dec } from './money';

/** NPV of monthly flows at monthly rate r (flows[m] at month m). */
export function npv(r: Dec, flows: readonly number[]): Dec {
  const one = dec(1).plus(r);
  return flows.reduce((s, f, m) => s.plus(dec(f).div(one.pow(m))), dec(0));
}

function dNpv(r: Dec, flows: readonly number[]): Dec {
  const one = dec(1).plus(r);
  return flows.reduce((s, f, m) => (m === 0 ? s : s.minus(dec(f).times(m).div(one.pow(m + 1)))), dec(0));
}

/**
 * Monthly IRR by Newton–Raphson with bisection fallback (tolerance 1e-10), SPEC §9.4.
 * Returns null when cash flows have no sign change.
 */
export function irrMonthly(flows: readonly number[]): Dec | null {
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;
  const tol = dec('1e-10');
  let r = dec('0.01');
  for (let i = 0; i < 100; i++) {
    const f = npv(r, flows);
    if (f.abs().lt(tol)) return r;
    const d = dNpv(r, flows);
    if (d.isZero()) break;
    const next = r.minus(f.div(d));
    if (!next.isFinite() || next.lte(-0.999999)) break;
    if (next.minus(r).abs().lt(tol)) return next;
    r = next;
  }
  // Bisection on [-0.99, 10]
  let lo = dec('-0.99');
  let hi = dec(10);
  let flo = npv(lo, flows);
  const fhi = npv(hi, flows);
  if (flo.isNeg() === fhi.isNeg()) return null;
  for (let i = 0; i < 500; i++) {
    const mid = lo.plus(hi).div(2);
    const fm = npv(mid, flows);
    if (fm.abs().lt(tol) || hi.minus(lo).lt(tol)) return mid;
    if (fm.isNeg() === flo.isNeg()) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return lo.plus(hi).div(2);
}

/** Annualise a monthly rate: (1 + r)^12 − 1. */
export const annualise = (r: Dec): Dec => dec(1).plus(r).pow(12).minus(1);
