import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui';

export default async function Landing() {
  const t = await getTranslations('public');
  const steps = t.raw('how.steps') as string[];
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">{t('hero.title')}</h1>
          <p className="mt-6 max-w-2xl text-lg text-neutral-700">{t('hero.subtitle')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup?type=operator" className={buttonVariants({ size: 'lg' })}>{t('hero.ctaOperator')}</Link>
            <Link href="/signup?type=lender" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>{t('hero.ctaLender')}</Link>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-3">
        {(['operator', 'lender', 'farmer'] as const).map((k) => (
          <div key={k} className="rounded-lg border border-neutral-200 bg-white p-6">
            <h2 className="font-semibold text-brand-700">{t(`value.${k}Title`)}</h2>
            <p className="mt-2 text-sm text-neutral-700">{t(`value.${k}Text`)}</p>
          </div>
        ))}
      </section>
      <section id="how" className="mx-auto max-w-6xl px-4 pb-20">
        <h2 className="text-2xl font-semibold">{t('how.title')}</h2>
        <ol className="mt-6 grid gap-3 md:grid-cols-5" aria-label={t('how.title')}>
          {steps.map((s, i) => (
            <li key={s} className="relative rounded-lg border border-brand-100 bg-white p-4 text-sm">
              <span className="mb-2 flex size-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
