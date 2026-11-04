import { dec, roundXof, type Dec } from './money';

export type RateMethod = 'flat' | 'declining';
export type RepaymentProfile = 'bullet' | 'seasonal' | 'annuity' | 'equal_principal';
export type GraceType = 'interest_only' | 'capitalised';

export interface ScheduleInput {
  principalXof: number;
  rateBps: number;
  rateMethod: RateMethod;
  tenorMonths: number;
  graceMonths?: number;
  graceType?: GraceType;
  repaymentProfile: RepaymentProfile;
  upfrontFeeBps?: number;
  /** Seasonal profile: month offsets (1..tenor) of the planned harvest receipts. */
  harvestMonths?: number[];
}

export interface ScheduleLine {
  seq: number;
  /** Month offset from disbursement (month 0). */
  month: number;
  principalXof: number;
  interestXof: number;
  feesXof: number;
  totalXof: number;
}

const line = (seq: number, month: number, principal: number, interest: number): ScheduleLine => ({ seq, month, principalXof: principal, interestXof: interest, feesXof: 0, totalXof: principal + interest });

/**
 * Repayment schedule (SPEC §9.5). Day count 30/360 monthly for instalments, months/12 for bullets.
 * Each line rounded half-even to XOF; the last line adjusts principal so Σ principal = principal.
 * The upfront fee is taken at disbursement and is not a schedule line.
 */
export function buildSchedule(input: ScheduleInput): ScheduleLine[] {
  const P = dec(input.principalXof);
  const rate = dec(input.rateBps).div(10000);
  const rm = rate.div(12);
  const tenor = input.tenorMonths;
  if (tenor <= 0 || input.principalXof <= 0) return [];
  const grace = Math.min(input.graceMonths ?? 0, Math.max(0, tenor - 1));
  const lines: ScheduleLine[] = [];

  if (input.repaymentProfile === 'bullet') {
    const interest = roundXof(P.times(rate).times(tenor).div(12));
    return [line(1, tenor, input.principalXof, interest)];
  }

  if (input.repaymentProfile === 'seasonal') {
    const months = [...new Set((input.harvestMonths?.length ? input.harvestMonths : [tenor]).filter((m) => m >= 1 && m <= tenor))].sort((a, b) => a - b);
    if (!months.length) months.push(tenor);
    const n = months.length;
    const perPrincipal = roundXof(P.div(n));
    let outstanding = P;
    let prev = 0;
    months.forEach((m, i) => {
      const base = input.rateMethod === 'flat' ? P : outstanding;
      const interest = roundXof(base.times(rate).times(m - prev).div(12));
      const principal = i === n - 1 ? outstanding.toNumber() : perPrincipal;
      lines.push(line(i + 1, m, principal, interest));
      outstanding = outstanding.minus(principal);
      prev = m;
    });
    return lines;
  }

  // Monthly profiles (annuity / equal principal) with optional grace.
  let seq = 0;
  let outstanding: Dec = P;
  for (let m = 1; m <= grace; m++) {
    if (input.graceType === 'capitalised') {
      outstanding = outstanding.plus(input.rateMethod === 'flat' ? P.times(rm) : outstanding.times(rm));
    } else {
      const interest = roundXof((input.rateMethod === 'flat' ? P : outstanding).times(rm));
      lines.push(line(++seq, m, 0, interest));
    }
  }
  outstanding = dec(roundXof(outstanding));
  const base = outstanding;
  const n = tenor - grace;
  if (input.repaymentProfile === 'annuity') {
    const instalment =
      input.rateMethod === 'declining'
        ? rm.isZero()
          ? roundXof(base.div(n))
          : roundXof(base.times(rm).div(dec(1).minus(dec(1).plus(rm).pow(-n))))
        : null;
    const flatInterest = roundXof(P.times(rm));
    const flatPrincipal = roundXof(base.div(n));
    for (let k = 1; k <= n; k++) {
      const month = grace + k;
      if (input.rateMethod === 'declining') {
        const interest = roundXof(outstanding.times(rm));
        const principal = k === n ? outstanding.toNumber() : instalment! - interest;
        lines.push(line(++seq, month, principal, interest));
        outstanding = outstanding.minus(principal);
      } else {
        const principal = k === n ? outstanding.toNumber() : flatPrincipal;
        lines.push(line(++seq, month, principal, flatInterest));
        outstanding = outstanding.minus(principal);
      }
    }
    return lines;
  }
  // equal_principal
  const perPrincipal = roundXof(base.div(n));
  for (let k = 1; k <= n; k++) {
    const interest = roundXof((input.rateMethod === 'flat' ? P : outstanding).times(rm));
    const principal = k === n ? outstanding.toNumber() : perPrincipal;
    lines.push(line(++seq, grace + k, principal, interest));
    outstanding = outstanding.minus(principal);
  }
  return lines;
}

export const scheduleTotals = (lines: readonly ScheduleLine[]) => ({
  principalXof: lines.reduce((s, l) => s + l.principalXof, 0),
  interestXof: lines.reduce((s, l) => s + l.interestXof, 0),
  totalXof: lines.reduce((s, l) => s + l.totalXof, 0),
});
