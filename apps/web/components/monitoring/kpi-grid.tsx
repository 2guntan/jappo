'use client';

import { useTranslations } from 'next-intl';
import type { Schemas } from '@jappo/sdk';
import { formatXof } from '@/lib/utils';
import { Card, CardBody } from '@/components/ui';

type K = Schemas['Kpis'];
const n = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? '—' : `${new Intl.NumberFormat('fr-SN', { maximumFractionDigits: 2 }).format(v)}${suffix}`);

/** KPI tiles (SPEC §9.9). `keys` selects and orders the tiles. */
export function KpiGrid({ kpis, keys }: { kpis: K; keys: string[] }) {
  const t = useTranslations('kpi');
  const v: Record<string, string> = {
    areaFinancedHa: n(kpis.areaFinancedHa, ' ha'),
    farmers: n(kpis.farmers),
    womenPct: n(kpis.womenPct, ' %'),
    youthPct: n(kpis.youthPct, ' %'),
    disbursed: formatXof(kpis.disbursedXof.total),
    outstanding: formatXof(kpis.outstandingXof.total),
    par30Pct: n(kpis.par30Pct, ' %'),
    par90Pct: n(kpis.par90Pct, ' %'),
    repaymentRatePct: n(kpis.repaymentRatePct, ' %'),
    deliveryRatePct: n(kpis.deliveryRatePct, ' %'),
    deliveredKg: n(kpis.deliveredKg, ' kg'),
    yieldAchievedTHa: n(kpis.yieldAchievedTHa, ' t/ha'),
    buyerPaymentDelayDays: n(kpis.buyerPaymentDelayDays, ' j'),
    farmerNetIncomeAvgXof: kpis.farmerNetIncomeAvgXof === null ? '—' : formatXof(kpis.farmerNetIncomeAvgXof),
    farmerNetIncomeMedianXof: kpis.farmerNetIncomeMedianXof === null ? '—' : formatXof(kpis.farmerNetIncomeMedianXof),
    directCostRecoveryPct: n(kpis.directCostRecoveryPct, ' %'),
    alerts: `${kpis.alerts.critical} / ${kpis.alerts.warning}`,
  };
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {keys.map((k) => (
        <Card key={k}>
          <CardBody>
            <p className="text-xs text-neutral-500">{t(k)}</p>
            <p className="text-xl font-semibold" data-testid={`kpi-${k}`}>{v[k]}</p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
