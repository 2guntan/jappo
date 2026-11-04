'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';

export default function ReportsPage() {
  const t = useTranslations();
  const { api, activeMembership } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const orgType = activeMembership?.orgType;
  const types = orgType === 'lender' ? (['lender_monthly'] as const) : orgType === 'guarantor' || orgType === 'insurer' ? (['guarantor_portfolio'] as const) : (['season_close'] as const);
  const [type, setType] = useState<string>(types[0]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [blockId, setBlockId] = useState('');
  const blocks = useQuery({ queryKey: ['blocks-min'], enabled: type === 'season_close', queryFn: () => unwrap(api.GET('/v1/blocks', { params: { query: { limit: 200 } } })) });
  const q = useQuery({ queryKey: ['reports'], queryFn: () => unwrap(api.GET('/v1/reports')) });
  return (
    <>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label={t('reports.type')} htmlFor="r-type"><Select id="r-type" value={type} onChange={(e) => setType(e.target.value)}>{types.map((x) => <option key={x} value={x}>{t(`reports.types.${x}`)}</option>)}</Select></Field>
          {type === 'season_close' && <Field label={t('adminLand.block')} htmlFor="r-block"><Select id="r-block" value={blockId} onChange={(e) => setBlockId(e.target.value)}><option value="">—</option>{(blocks.data?.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.ref} · {b.name}</option>)}</Select></Field>}
          <Field label={t('reports.period')} htmlFor="r-period"><Input id="r-period" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Button loading={busy === 'gen'} disabled={type === 'season_close' && !blockId} onClick={() => run('gen', async () => { await unwrap(api.POST('/v1/reports', { body: { type: type as never, period, scopeId: blockId || null } })); await qc.invalidateQueries({ queryKey: ['reports'] }); }, t('reports.generated'))}>{t('reports.generate')}</Button>
        </CardBody>
      </Card>
      <Card>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('reports.type')}</Th><Th>{t('reports.period')}</Th><Th>{t('reports.generatedAt')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {(q.data?.data ?? []).map((r) => (
                <tr key={r.id}>
                  <Td>{t(`reports.types.${r.type}`)}</Td><Td>{r.period}</Td><Td>{formatDateTime(r.generatedAt)}</Td><Td><Badge data-testid={`report-${r.type}`}>{r.status}</Badge></Td>
                  <Td>{r.hasPdf && <Button size="sm" variant="ghost" onClick={() => run('pdf', async () => { const x = await unwrap(api.GET('/v1/reports/{id}', { params: { path: { id: r.id } } })); if (x.url) window.open(x.url, '_blank', 'noopener'); })}>PDF</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
