import { dec, roundXof, splitProRata } from './money';
import type { ScheduleLine } from './schedule';

/** Add calendar months to an ISO date (YYYY-MM-DD); the day is clamped to the month end. */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export interface DatedScheduleLine extends ScheduleLine {
  dueDate: string;
}

/** Attach due dates to schedule lines: line month offset counted from the facility start date. */
export function datedSchedule(startDate: string, lines: readonly ScheduleLine[]): DatedScheduleLine[] {
  return lines.map((l) => ({ ...l, dueDate: addMonthsIso(startDate, l.month) }));
}

export interface FacilityAllocationInput {
  principalXof: number;
  interestXof: number;
  feesXof: number;
  /** Farmer weights: the §9.1.3 seasonal credit allocated to each farmer. */
  farmers: { farmerId: string; weightXof: number }[];
}

export interface FacilityFarmerAllocation {
  farmerId: string;
  principalXof: number;
  interestXof: number;
  feesXof: number;
  dueXof: number;
}

/**
 * Split a seasonal facility across farmers pro rata to their §9.1.3 credit allocation.
 * Principal, interest and fees are split independently (floor + largest remainder, ties by farmer id),
 * so each column sums exactly to the facility total.
 */
export function allocateFacility(input: FacilityAllocationInput): FacilityFarmerAllocation[] {
  const parts = input.farmers.filter((f) => f.weightXof > 0).map((f) => ({ key: f.farmerId, weight: f.weightXof }));
  const p = splitProRata(input.principalXof, parts);
  const i = splitProRata(input.interestXof, parts);
  const fe = splitProRata(input.feesXof, parts);
  return parts
    .map((x) => {
      const principalXof = p.get(x.key) ?? 0;
      const interestXof = i.get(x.key) ?? 0;
      const feesXof = fe.get(x.key) ?? 0;
      return { farmerId: x.key, principalXof, interestXof, feesXof, dueXof: principalXof + interestXof + feesXof };
    })
    .sort((a, b) => (a.farmerId < b.farmerId ? -1 : a.farmerId > b.farmerId ? 1 : 0));
}

/** Upfront fee taken at disbursement: principal × bps / 10 000, half-even to XOF. */
export function upfrontFeeXof(principalXof: number, upfrontFeeBps: number): number {
  return roundXof(dec(principalXof).times(upfrontFeeBps).div(10000));
}

/** Days a schedule line is overdue on `asOf` (0 when not yet due or fully paid). */
export function daysOverdue(dueDate: string, asOf: string, outstandingXof: number): number {
  if (outstandingXof <= 0) return 0;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

/** Seasonal repayment months within the tenor: the last harvest month of the plan, then every 12 months (as the model engine). */
export function harvestMonthsFor(harvestMonths: readonly number[], tenorMonths: number): number[] {
  const h = harvestMonths.length ? Math.max(...harvestMonths) : 6;
  const out: number[] = [];
  for (let m = h; m <= tenorMonths; m += 12) out.push(m);
  return out;
}
