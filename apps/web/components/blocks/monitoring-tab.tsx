'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';
import { Badge, Card, CardBody, CardHeader, CardTitle, Spinner, Table, Td, Th } from '@/components/ui';
import { KpiGrid } from '@/components/monitoring/kpi-grid';
import type { BlockT } from './types';

/** Block monitoring (operator, lenders, guarantors read-only): KPIs, harvest vs expected, alerts, visits. */
export function MonitoringTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api } = useSession();
  const q = useQuery({ queryKey: ['dash-block', block.id], queryFn: () => unwrap(api.GET('/v1/dashboards/block/{id}', { params: { path: { id: block.id } } })) });
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  return (
    <div className="space-y-4" data-testid="block-monitoring">
      {d.season && <p className="text-sm text-neutral-600">{d.season.name} · {d.season.startDate} → {d.season.endDate}</p>}
      <KpiGrid kpis={d.kpis} keys={['farmers', 'areaFinancedHa', 'deliveredKg', 'deliveryRatePct', 'yieldAchievedTHa', 'outstanding', 'repaymentRatePct', 'alerts']} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('ops.visits')}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('ops.plot')}</Th><Th>{t('ops.visitedAt')}</Th><Th>{t('ops.stage')}</Th><Th>{t('ops.health')}</Th></tr></thead>
              <tbody>{d.recentVisits.map((v, i) => <tr key={i}><Td>{v.plotCode}</Td><Td>{formatDateTime(v.visitedAt)}</Td><Td>{t(`ops.stages.${v.cropStage}`)}</Td><Td>{v.healthScore}/5</Td></tr>)}</tbody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('alerts.title')}</CardTitle></CardHeader>
          <CardBody className="space-y-1 text-sm">
            {d.alerts.length === 0 ? <p className="text-neutral-600">{t('alerts.empty')}</p> : d.alerts.map((a) => <p key={a.id}><Badge tone={a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'blue'}>{t(`alerts.severities.${a.severity}`)}</Badge> {a.message}</p>)}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
