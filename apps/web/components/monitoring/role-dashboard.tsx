'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { KpiGrid } from './kpi-grid';

/** Home dashboards: operator (KPIs, blocks by status, alerts, tasks) and lender (portfolio, pending approvals). */
export function RoleDashboard() {
  const t = useTranslations();
  const { api, activeMembership, hasPermission } = useSession();
  const type = activeMembership?.orgType;
  const enabled = hasPermission('dashboard:read') && activeMembership?.kycStatus === 'verified';
  const op = useQuery({ queryKey: ['dash-operator'], enabled: enabled && type === 'operator', queryFn: () => unwrap(api.GET('/v1/dashboards/operator')) });
  const ld = useQuery({ queryKey: ['dash-lender'], enabled: enabled && type === 'lender', queryFn: () => unwrap(api.GET('/v1/dashboards/lender')) });
  if (op.data) {
    const d = op.data;
    return (
      <div className="mt-6 space-y-4" data-testid="operator-dashboard">
        <KpiGrid kpis={d.kpis} keys={['areaFinancedHa', 'farmers', 'womenPct', 'disbursed', 'outstanding', 'deliveryRatePct', 'farmerNetIncomeAvgXof', 'alerts']} />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>{t('dashboard.blocksByStatus')}</CardTitle></CardHeader>
            <CardBody className="space-y-1 text-sm">{Object.entries(d.blocksByStatus).map(([k, n]) => <p key={k}>{t(`blockStatus.${k}`)} : <strong>{n}</strong></p>)}</CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('dashboard.tasks')}</CardTitle></CardHeader>
            <CardBody className="space-y-1 text-sm">
              <p><Link className="text-brand-700 hover:underline" href="/app/contracts">{t('dashboard.contractsPending', { count: d.tasks.contractsPendingSignature })}</Link></p>
              <p><Link className="text-brand-700 hover:underline" href="/app/facilities">{t('dashboard.disbursements', { count: d.tasks.disbursementsInProgress })}</Link></p>
              <p><Link className="text-brand-700 hover:underline" href="/app/settlements">{t('dashboard.settlements', { count: d.tasks.settlementsOpen })}</Link></p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('alerts.title')}</CardTitle></CardHeader>
            <CardBody className="space-y-1 text-sm">
              {d.alerts.length === 0 ? <p className="text-neutral-600">{t('alerts.empty')}</p> : d.alerts.map((a) => <p key={a.id}><Badge tone={a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'blue'}>{t(`alerts.severities.${a.severity}`)}</Badge> <Link className="hover:underline" href={`/app/blocks/${a.blockId}?tab=alerts`}>{a.message}</Link></p>)}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }
  if (ld.data) {
    const d = ld.data;
    return (
      <div className="mt-6 space-y-4" data-testid="lender-dashboard">
        <KpiGrid kpis={d.kpis} keys={['outstanding', 'disbursed', 'par30Pct', 'par90Pct', 'repaymentRatePct', 'deliveryRatePct', 'farmers', 'alerts']} />
        <Card>
          <CardHeader><CardTitle>{t('dashboard.pending')}</CardTitle></CardHeader>
          <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
            <p><Link className="text-brand-700 hover:underline" href="/app/lender/opportunities">{t('dashboard.opportunities', { count: d.openOpportunities })}</Link></p>
            <p><Link className="text-brand-700 hover:underline" href="/app/facilities">{t('dashboard.cps', { count: d.pending.cpToConfirm })}</Link></p>
            <p><Link className="text-brand-700 hover:underline" href="/app/facilities">{t('dashboard.disbursements', { count: d.pending.disbursements })}</Link></p>
            <p><Link className="text-brand-700 hover:underline" href="/app/settlements">{t('dashboard.settlementsToApprove', { count: d.pending.settlementsToApprove })}</Link></p>
            <p><Link className="text-brand-700 hover:underline" href="/app/contracts">{t('dashboard.contractsPending', { count: d.pending.contractsToSign })}</Link></p>
          </CardBody>
        </Card>
      </div>
    );
  }
  return null;
}
