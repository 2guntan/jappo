/** Human reference formatting, e.g. BLK-2026-0001 (SPEC §4.2). */
export function formatRef(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

export const REF_PREFIXES = {
  block: 'BLK',
  rfp: 'RFP',
  contract: 'CTR',
  settlement: 'STL',
  invoice: 'INV',
  dossier: 'DOS',
  financingRequest: 'FRQ',
  offtake: 'OFT',
  facility: 'FAC',
  disbursement: 'DSB',
  dispatch: 'DSP',
  buyerInvoice: 'BIN',
} as const;

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Add `n` working days (Mon–Fri, skipping holidays given as YYYY-MM-DD) to a date (UTC).
 * The time of day is preserved.
 */
export function addWorkingDays(start: Date, n: number, holidays: readonly string[]): Date {
  const set = new Set(holidays);
  const d = new Date(start.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (set.has(toIsoDate(d))) continue;
    added += 1;
  }
  return d;
}

export function isWorkingDay(d: Date, holidays: readonly string[]): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.includes(toIsoDate(d));
}

/** Senegal fixed-date public holidays (movable religious holidays are entered by admins). */
export function senegalFixedHolidays(year: number): { date: string; name: string }[] {
  return [
    { date: `${year}-01-01`, name: "Jour de l'an" },
    { date: `${year}-04-04`, name: "Fête de l'Indépendance" },
    { date: `${year}-05-01`, name: 'Fête du Travail' },
    { date: `${year}-08-15`, name: 'Assomption' },
    { date: `${year}-11-01`, name: 'Toussaint' },
    { date: `${year}-12-25`, name: 'Noël' },
  ];
}
