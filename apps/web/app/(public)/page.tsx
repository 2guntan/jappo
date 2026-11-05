import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui';

/** SPEC §9.6.3 reference waterfall (WF-1): receipts 5 750 000 → seasonal lenders 3 148 000, operator fees 300 000, farmers 2 302 000. */
const WATERFALL = { receipts: 5_750_000, lenders: 3_148_000, operator: 300_000, farmers: 2_302_000 } as const;

export default async function Landing() {
  const t = await getTranslations('public');
  const ts = await getTranslations('settlement');
  const steps = t.raw('how.steps') as string[];
  const nf = new Intl.NumberFormat('fr-SN');
  const pct = (n: number) => (n / WATERFALL.receipts) * 100;
  const segments = [
    { key: 'lenders', label: ts('seasonalLenders'), value: WATERFALL.lenders, className: 'bg-brand-700' },
    { key: 'operator', label: ts('operator'), value: WATERFALL.operator, className: 'bg-brand-400' },
    { key: 'farmers', label: ts('farmersTotal'), value: WATERFALL.farmers, className: 'bg-neutral-900' },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-5 pb-20 pt-20 sm:px-8 sm:pt-28 lg:pb-28">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand-700">{t('hero.eyebrow')}</p>
          <h1 className="mt-5 max-w-4xl text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] text-neutral-900 sm:text-6xl lg:text-[4.25rem]">{t('hero.title')}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-neutral-600 sm:text-xl">{t('hero.subtitle')}</p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/signup?type=operator" className={buttonVariants({ size: 'lg' })}>
              {t('hero.ctaOperator')}
              <ArrowRight />
            </Link>
            <Link href="/signup?type=lender" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>
              {t('hero.ctaLender')}
            </Link>
          </div>
        </div>
      </section>

      {/* Reference waterfall */}
      <section className="border-y border-neutral-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-neutral-900">{t('waterfall.title')}</h2>
              <p className="mt-3 text-sm leading-relaxed text-neutral-600">{t('waterfall.caption')}</p>
            </div>
            <figure className="min-w-0">
              <figcaption className="flex items-baseline justify-between gap-4">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">{ts('receipts')}</span>
                <span className="text-2xl font-semibold tracking-tight text-neutral-900 tabular-nums">
                  {nf.format(WATERFALL.receipts)} <span className="text-sm font-medium text-neutral-500">FCFA</span>
                </span>
              </figcaption>
              <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                {segments.map((s) => (
                  <div key={s.key} className={s.className} style={{ width: `${pct(s.value)}%` }} />
                ))}
              </div>
              <dl className="mt-6 grid gap-6 sm:grid-cols-3">
                {segments.map((s) => (
                  <div key={s.key} className="min-w-0">
                    <dt className="flex items-center gap-2 text-xs font-medium text-neutral-500">
                      <span className={`size-2 rounded-full ${s.className}`} aria-hidden />
                      {s.label}
                    </dt>
                    <dd className="mt-1.5 text-lg font-semibold tracking-tight text-neutral-900 tabular-nums">{nf.format(s.value)}</dd>
                    <dd className="text-xs text-neutral-500 tabular-nums">{pct(s.value).toFixed(1).replace('.', ',')} %</dd>
                  </div>
                ))}
              </dl>
            </figure>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 lg:py-28">
        <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.025em] text-neutral-900">{t('how.title')}</h2>
        <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5" aria-label={t('how.title')}>
          {steps.map((s, i) => (
            <li key={s} className="border-t border-neutral-900/80 pt-5">
              <span className="font-mono text-xs text-neutral-500 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-800">{s}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Audiences */}
      <section className="border-t border-neutral-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
          <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.025em] text-neutral-900">{t('value.title')}</h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-neutral-200/80">
            {(['operator', 'lender', 'farmer'] as const).map((k) => (
              <div key={k} className="md:px-8 md:first:pl-0 md:last:pr-0">
                <h3 className="text-base font-semibold text-neutral-900">{t(`value.${k}Title`)}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">{t(`value.${k}Text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="flex flex-col gap-8 rounded-2xl bg-neutral-900 px-8 py-12 text-white sm:px-12 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('cta.title')}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-neutral-300">{t('cta.text')}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className={buttonVariants({ size: 'lg', variant: 'secondary', className: 'border-transparent shadow-none' })}>
              {t('nav.signup')}
            </Link>
            <Link href="/pricing" className={buttonVariants({ size: 'lg', variant: 'ghost', className: 'text-white hover:bg-white/10 hover:text-white' })}>
              {t('nav.pricing')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
