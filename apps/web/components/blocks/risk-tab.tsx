'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { RISK_COVER_TYPES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import type { BlockT } from './types';

export function RiskTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const q = useQuery({ queryKey: ['risk', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/risk-covers', { params: { path: { id: block.id } } })) });
  const [f, setF] = useState({ type: 'guarantee', providerName: '', coveragePct: '80' });
  const own = block.allowedActions.includes('update') && hasPermission('risk_cover:manage');
  const refresh = () => qc.invalidateQueries({ queryKey: ['risk', block.id] });
  const rows = q.data?.data ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {msg && <Alert tone={msg.tone} className="mb-3">{msg.text}</Alert>}
        {rows.length === 0 ? <EmptyState title={t('risk.title')} description={t('risk.empty')} /> : (
          <Card>
            <CardBody className="p-0">
              <Table>
                <thead><tr><Th>{t('risk.type')}</Th><Th>{t('risk.provider')}</Th><Th>{t('risk.coverage')}</Th><Th>{t('risk.cap')}</Th><Th>{t('common.status')}</Th>{own && <Th />}</tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <Td>{t(`risk.types.${c.type}`)}</Td>
                      <Td>{c.providerName}</Td>
                      <Td>{c.coveragePct} %</Td>
                      <Td>{formatXof(c.capXof)}</Td>
                      <Td><Badge tone={c.status === 'proposed' ? 'neutral' : c.status === 'expired' ? 'red' : 'green'}>{t(`risk.statuses.${c.status}`)}</Badge></Td>
                      {own && (
                        <Td className="space-x-1 whitespace-nowrap">
                          {c.status === 'proposed' && <Button size="sm" variant="secondary" onClick={() => run('c', async () => { await unwrap(api.PATCH('/v1/risk-covers/{id}', { params: { path: { id: c.id } }, headers: ifMatch(c.version), body: { status: 'committed' } })); await refresh(); })}>{t('risk.commit')}</Button>}
                          {c.status === 'committed' && <Button size="sm" variant="secondary" onClick={() => run('a', async () => { await unwrap(api.PATCH('/v1/risk-covers/{id}', { params: { path: { id: c.id } }, headers: ifMatch(c.version), body: { status: 'active' } })); await refresh(); })}>{t('risk.activate')}</Button>}
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        )}
      </div>
      {own && (
        <Card>
          <CardHeader><CardTitle>{t('risk.add')}</CardTitle></CardHeader>
          <CardBody>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run('add', async () => { await unwrap(api.POST('/v1/blocks/{id}/risk-covers', { params: { path: { id: block.id } }, body: { type: f.type as 'guarantee', providerName: f.providerName, coveragePct: Number(f.coveragePct), status: 'proposed' } })); setF({ ...f, providerName: '' }); await refresh(); }); }}>
              <Field label={t('risk.type')} htmlFor="rc-type"><Select id="rc-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{RISK_COVER_TYPES.map((x) => <option key={x} value={x}>{t(`risk.types.${x}`)}</option>)}</Select></Field>
              <Field label={t('risk.provider')} htmlFor="rc-prov"><Input id="rc-prov" required value={f.providerName} onChange={(e) => setF({ ...f, providerName: e.target.value })} /></Field>
              <Field label={t('risk.coverage')} htmlFor="rc-cov"><Input id="rc-cov" type="number" min={0} max={100} value={f.coveragePct} onChange={(e) => setF({ ...f, coveragePct: e.target.value })} /></Field>
              <Button type="submit" loading={busy === 'add'}>{t('risk.add')}</Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
