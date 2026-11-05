'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { statusTone } from '@/lib/utils';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { KpiGrid } from './kpi-grid';

function TaskLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="group -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm text-neutral-800 transition-colors hover:bg-neutral-100">
        <span>{children}</span>
        <ArrowRight className="size-4 text-neutral-300 transition-colors group-hover:text-neutral-600" aria-hidden />
      </Link>
    </li>
  );
}

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
    const statuses = Object.entries(d.blocksByStatus);
    const total = statuses.reduce((s, [, n]) => s + n, 0);
    return (
      <div className="mt-6 space-y-6" data-testid="operator-dashboard">
        <KpiGrid kpis={d.kpis} keys={['areaFinancedHa', 'farmers', 'womenPct', 'disbursed', 'outstanding', 'deliveryRatePct', 'farmerNetIncomeAvgXof', 'alerts']} />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.blocksByStatus')}</CardTitle>
              <span className="text-xs text-neutral-500 tabular-nums">{total}</span>
            </CardHeader>
            <CardBody>
              {statuses.length === 0 ? (
                <p className="text-sm text-neutral-500">{t('common.none')}</p>
              ) : (
                <ul className="space-y-2.5">
                  {statuses.map(([k, n]) => (
                    <li key={k} className="flex items-center justify-between gap-3 text-sm">
                      <Badge tone={statusTone(k)}>{t(`blockStatus.${k}`)}</Badge>
                      <span className="font-medium tabular-nums">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.tasks')}</CardTitle>
            </CardHeader>
            <CardBody>
              <ul>
                <TaskLink href="/app/contracts">{t('dashboard.contractsPending', { count: d.tasks.contractsPendingSignature })}</TaskLink>
                <TaskLink href="/app/facilities">{t('dashboard.disbursements', { count: d.tasks.disbursementsInProgress })}</TaskLink>
                <TaskLink href="/app/settlements">{t('dashboard.settlements', { count: d.tasks.settlementsOpen })}</TaskLink>
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('alerts.title')}</CardTitle>
            </CardHeader>
            <CardBody>
              {d.alerts.length === 0 ? (
                <p className="text-sm text-neutral-500">{t('alerts.empty')}</p>
              ) : (
                <ul className="space-y-3">
                  {d.alerts.map((a) => (
                    <li key={a.id} className="flex items-start gap-2.5 text-sm">
                      <Badge tone={a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'blue'}>{t(`alerts.severities.${a.severity}`)}</Badge>
                      <Link className="min-w-0 leading-5 text-neutral-800 hover:underline" href={`/app/blocks/${a.blockId}?tab=alerts`}>
                        {a.message}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  if (ld.data) {
    const d = ld.data;
    return (
      <div className="mt-6 space-y-6" data-testid="lender-dashboard">
        <KpiGrid kpis={d.kpis} keys={['outstanding', 'disbursed', 'par30Pct', 'par90Pct', 'repaymentRatePct', 'deliveryRatePct', 'farmers', 'alerts']} />
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.pending')}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="grid gap-x-8 sm:grid-cols-2">
              <TaskLink href="/app/lender/opportunities">{t('dashboard.opportunities', { count: d.openOpportunities })}</TaskLink>
              <TaskLink href="/app/facilities">{t('dashboard.cps', { count: d.pending.cpToConfirm })}</TaskLink>
              <TaskLink href="/app/facilities">{t('dashboard.disbursements', { count: d.pending.disbursements })}</TaskLink>
              <TaskLink href="/app/settlements">{t('dashboard.settlementsToApprove', { count: d.pending.settlementsToApprove })}</TaskLink>
              <TaskLink href="/app/contracts">{t('dashboard.contractsPending', { count: d.pending.contractsToSign })}</TaskLink>
            </ul>
          </CardBody>
        </Card>
      </div>
    );
  }
  return null;
}
