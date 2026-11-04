import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

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
    <section className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold text-brand-900">{t('title')}</h1>
      <p className="mb-8 text-neutral-600">{t('subtitle')}</p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <div key={p.id} className="flex flex-col rounded-lg border border-neutral-200 bg-white p-5" data-testid={`plan-${p.code}`}>
            <p className="text-sm text-neutral-500">{p.orgTypes.map((o) => t(`orgTypes.${o}`)).join(', ')}</p>
            <h2 className="mb-2 text-lg font-semibold">{p.name}</h2>
            <p className="mb-3 text-2xl font-bold text-brand-700">{p.priceModel === 'free' ? t('free') : `${nf.format(p.unitPriceXof)} FCFA`}</p>
            <p className="mb-3 text-sm text-neutral-600">{t(`per.${p.priceModel}`)}{p.structuringFeeBps ? ` · ${t('structuring', { pct: p.structuringFeeBps / 100 })}` : ''}{p.includedSeats ? ` · ${t('seats', { n: p.includedSeats })}` : ''}</p>
            <Link href="/signup" className="mt-auto rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-700">{t('cta')}</Link>
          </div>
        ))}
      </div>
    </section>
  );
}
