import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LogoMark } from '@/components/brand/logo';

/**
 * Auth screens: a dark brand panel on large screens, the form on the right.
 * Form ids and button labels are owned by the pages; this only frames them.
 */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const t = useTranslations();
  const steps = t.raw('public.how.steps') as string[];
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:py-16">
      <div className="grid overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm lg:grid-cols-[5fr_6fr]">
        <aside className="relative hidden flex-col gap-14 bg-brand-950 p-10 text-white lg:flex" aria-hidden>
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.12) 1px, transparent 0)', backgroundSize: '22px 22px' }}
          />
          <div className="relative">
            <LogoMark tone="white" className="size-8" />
            <h2 className="mt-10 max-w-xs text-3xl font-semibold leading-tight tracking-[-0.025em]">{t('auth.panel.title')}</h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-brand-100/80">{t('auth.panel.text')}</p>
          </div>
          <ol className="relative space-y-3 text-sm text-brand-100/80">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="font-mono text-xs text-brand-300/70 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </aside>
        <div className="flex flex-col justify-center p-6 sm:p-10 lg:p-14">
          <div className="mx-auto w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-neutral-900">{title}</h1>
            {subtitle && <p className="mt-2 text-sm leading-relaxed text-neutral-500">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 border-t border-neutral-200/70 pt-6 text-center text-sm text-neutral-500">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
