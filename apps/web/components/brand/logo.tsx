import { cn } from '@/lib/utils';

/**
 * Brand mark: a block divided into four plots, one of them lit — "a block farm, parcel by parcel".
 * Pure SVG so it stays crisp at every size and in any colour.
 */
export function LogoMark({ className, tone = 'brand' }: { className?: string; tone?: 'brand' | 'white' | 'ink' }) {
  const bg = tone === 'brand' ? '#1d5639' : tone === 'white' ? '#ffffff' : '#1b1a17';
  const fg = tone === 'white' ? '#1d5639' : '#ffffff';
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill={bg} />
      <rect x="7" y="7" width="8" height="8" rx="1.5" fill={fg} fillOpacity="0.55" />
      <rect x="17" y="7" width="8" height="8" rx="1.5" fill={fg} fillOpacity="0.55" />
      <rect x="7" y="17" width="8" height="8" rx="1.5" fill={fg} fillOpacity="0.55" />
      <rect x="17" y="17" width="8" height="8" rx="1.5" fill={fg} />
    </svg>
  );
}

export function Logo({ className, tone = 'brand', wordmark = true }: { className?: string; tone?: 'brand' | 'white' | 'ink'; wordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark tone={tone} />
      {wordmark && <span className={cn('text-[17px] font-semibold tracking-[-0.02em]', tone === 'white' ? 'text-white' : 'text-neutral-900')}>Jappo</span>}
    </span>
  );
}
