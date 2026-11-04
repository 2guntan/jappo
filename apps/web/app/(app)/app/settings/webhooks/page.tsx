'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Table, Td, Th } from '@/components/ui';

export default function WebhooksPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [url, setUrl] = useState('https://');
  const [types, setTypes] = useState('*');
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['webhooks'], queryFn: () => unwrap(api.GET('/v1/webhooks')) });
  const dl = useQuery({ queryKey: ['webhook-deliveries', open], enabled: !!open, queryFn: () => unwrap(api.GET('/v1/webhooks/{id}/deliveries', { params: { path: { id: open! } } })) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['webhooks'] }), qc.invalidateQueries({ queryKey: ['webhook-deliveries'] })]);
  return (
    <>
      <PageHeader title={t('webhooks.title')} subtitle={t('webhooks.subtitle')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      {secret && <Alert tone="info" className="mb-4"><span data-testid="webhook-secret">{t('webhooks.secretOnce')} <code className="break-all">{secret}</code></span></Alert>}
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="URL" htmlFor="wh-url"><Input id="wh-url" className="w-80" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          <Field label={t('webhooks.events')} htmlFor="wh-types" hint={t('webhooks.eventsHint')}><Input id="wh-types" className="w-80" value={types} onChange={(e) => setTypes(e.target.value)} /></Field>
          <Button loading={busy === 'create'} onClick={() => run('create', async () => { const r = await unwrap(api.POST('/v1/webhooks', { body: { url, eventTypes: types.split(',').map((x) => x.trim()).filter(Boolean) } })); setSecret(r.secret); await refresh(); })}>{t('webhooks.create')}</Button>
        </CardBody>
      </Card>
      <Card className="mb-6">
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>URL</Th><Th>{t('webhooks.events')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {(q.data?.data ?? []).map((w) => (
                <tr key={w.id}>
                  <Td className="break-all">{w.url}</Td><Td className="text-xs">{w.eventTypes.join(', ')}</Td><Td><Badge tone={w.active ? 'green' : 'neutral'}>{w.active ? t('webhooks.active') : t('webhooks.inactive')}</Badge></Td>
                  <Td className="space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(w.id)}>{t('webhooks.log')}</Button>
                    {w.active && <Button size="sm" variant="secondary" loading={busy === `t${w.id}`} onClick={() => run(`t${w.id}`, async () => { await unwrap(api.POST('/v1/webhooks/{id}/actions/test', { params: { path: { id: w.id } } })); setOpen(w.id); await refresh(); })}>{t('webhooks.test')}</Button>}
                    {w.active && <Button size="sm" variant="ghost" onClick={() => run(`d${w.id}`, async () => { await unwrap(api.DELETE('/v1/webhooks/{id}', { params: { path: { id: w.id } } })); await refresh(); })}>{t('webhooks.disable')}</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      {open && (
        <Card>
          <CardHeader><CardTitle>{t('webhooks.log')}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('webhooks.event')}</Th><Th>{t('common.status')}</Th><Th>{t('webhooks.attempts')}</Th><Th>HTTP</Th><Th>{t('webhooks.at')}</Th></tr></thead>
              <tbody>{(dl.data?.data ?? []).map((d) => <tr key={d.id}><Td>{d.eventType}</Td><Td><Badge tone={d.status === 'delivered' ? 'green' : d.status === 'failed' ? 'red' : 'amber'} data-testid={`delivery-${d.eventType}`}>{d.status}</Badge></Td><Td>{d.attempts}</Td><Td>{d.lastStatusCode ?? '—'}{d.lastError && <span className="block text-xs text-red-600">{d.lastError}</span>}</Td><Td>{formatDateTime(d.deliveredAt ?? d.createdAt)}</Td></tr>)}</tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
