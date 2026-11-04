import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** fr-SN number formatting: "1 308 000 FCFA". */
export const formatXof = (n: number | null | undefined, locale = 'fr-SN') =>
  n === null || n === undefined ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)} FCFA`;

export const formatDateTime = (iso: string | null | undefined, locale = 'fr-SN') =>
  iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Dakar' }).format(new Date(iso)) : '—';

export const formatDate = (iso: string | null | undefined, locale = 'fr-SN') =>
  iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Africa/Dakar' }).format(new Date(iso)) : '—';

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

/** Download rows as CSV (SPEC §12.1: every list exports CSV). */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const kycTone = (s: string) => (s === 'verified' ? 'green' : s === 'rejected' ? 'red' : s === 'submitted' ? 'blue' : 'amber') as 'green' | 'red' | 'blue' | 'amber';

export const statusTone = (s: string) =>
  (({ draft: 'neutral', documenting: 'blue', ready: 'green', in_financing: 'amber', financed: 'green', active: 'green', archived: 'neutral', available: 'neutral', allocated: 'green', fallow: 'amber', excluded: 'red', submitted: 'blue', verified: 'green', rejected: 'red', expired: 'red', pending: 'amber', open: 'amber', in_progress: 'blue', resolved: 'green', closed: 'neutral' }) as Record<string, 'neutral' | 'blue' | 'green' | 'amber' | 'red'>)[s] ?? 'neutral';
