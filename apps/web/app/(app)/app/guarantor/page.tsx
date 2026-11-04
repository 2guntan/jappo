'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { formatXof } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { KpiGrid } from '@/components/monitoring/kpi-grid';

/** Guarantor / insurer view (SPEC §12.6): covered facilities, exposure, PAR, claim candidates. */
export default function GuarantorPage() {
  const t = useTranslations();
  const { api } = useSession();
  const q = useQuery({ queryKey: ['dash-guarantor'], queryFn: () => unwrap(api.GET('/v1/dashboards/guarantor')) });
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  return (
    <>
      <PageHeader title={t('guarantor.title')} subtitle={`${t('guarantor.exposure')} ${formatXof(d.totalExposureXof)} · ${t('guarantor.threshold', { days: d.claimThresholdDays })}`} />
      <div className="mb-6"><KpiGrid kpis={d.kpis} keys={['outstanding', 'par30Pct', 'par90Pct', 'repaymentRatePct']} /></div>
      {d.facilities.length === 0 ? <EmptyState title={t('guarantor.title')} description={t('guarantor.empty')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('facility.ref')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('facility.lender')}</Th><Th>{t('guarantor.coverage')}</Th><Th>{t('facility.outstanding')}</Th><Th>{t('guarantor.exposure')}</Th><Th>{t('guarantor.overdueDays')}</Th><Th /></tr></thead>
              <tbody>
                {d.facilities.map((f) => (
                  <tr key={f.facilityId}>
                    <Td className="font-medium">{f.facilityRef}</Td>
                    <Td><Link className="text-brand-700 hover:underline" href={`/app/blocks/${f.blockId}?tab=monitoring`}>{f.blockRef} · {f.blockName}</Link></Td>
                    <Td>{f.lenderName}</Td><Td>{f.coveragePct} %</Td><Td>{formatXof(f.outstandingXof)}</Td><Td data-testid={`exposure-${f.facilityRef}`}>{formatXof(f.exposureXof)}</Td><Td>{f.maxOverdueDays}</Td>
                    <Td>{f.claimCandidate && <Badge tone="red">{t('guarantor.claimCandidate')}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
