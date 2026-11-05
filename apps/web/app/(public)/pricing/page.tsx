import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Plan = { id: string; code: string; name: string; orgTypes: string[]; priceModel: 'per_ha_season' | 'annual_seat' | 'free'; unitPriceXof: number; structuringFeeBps: number; includedSeats: number; features: string[] };

async function loadPlans(): Promise<Plan[]> {
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  try {
    const r = await fetch(`${base}/v1/billing/plans`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as { data: Plan[] }).data : [];
  } catch {
    return [];
  }
}

/** Public pricing (SPEC §12.2) from `/v1/billing/plans`. */
export default async function PricingPage() {
  const t = await getTranslations('pricing');
  const plans = await loadPlans();
  const nf = new Intl.NumberFormat('fr-SN');
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-[-0.03em] text-neutral-900 sm:text-5xl">{t('title')}</h1>
        <p className="mt-5 text-lg leading-relaxed text-neutral-600">{t('subtitle')}</p>
      </div>
      <div className={cn('mt-14 grid gap-5', plans.length >= 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3')}>
        {plans.map((p) => {
          const free = p.priceModel === 'free';
          return (
            <article key={p.id} className="flex flex-col rounded-xl border border-neutral-200/80 bg-white p-6 shadow-xs" data-testid={`plan-${p.code}`}>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{p.orgTypes.map((o) => t(`orgTypes.${o}`)).join(', ')}</p>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-neutral-900">{p.name}</h2>
              <p className="mt-6 flex items-baseline gap-1.5 tabular-nums">
                <span className="text-3xl font-semibold tracking-[-0.03em] text-neutral-900">{free ? t('free') : nf.format(p.unitPriceXof)}</span>
                {!free && <span className="text-sm font-medium text-neutral-500">FCFA</span>}
              </p>
              <p className="mt-1 text-sm text-neutral-500">{t(`per.${p.priceModel}`)}</p>
              {(p.structuringFeeBps > 0 || p.includedSeats > 0) && (
                <p className="mt-3 text-xs text-neutral-500">
                  {[p.structuringFeeBps ? t('structuring', { pct: p.structuringFeeBps / 100 }) : null, p.includedSeats ? t('seats', { n: p.includedSeats }) : null].filter(Boolean).join(' · ')}
                </p>
              )}
              {p.features.length > 0 && (
                <ul className="mt-6 space-y-2.5 border-t border-neutral-200/70 pt-6 text-sm text-neutral-700" aria-label={t('included')}>
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                      <span>{t.has(`features.${f}`) ? t(`features.${f}`) : f}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/signup" className={buttonVariants({ variant: free ? 'secondary' : 'primary', className: 'mt-8 w-full' })}>
                {t('cta')}
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
