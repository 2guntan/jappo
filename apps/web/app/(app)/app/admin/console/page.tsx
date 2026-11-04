'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui';

export default function AdminConsolePage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [hol, setHol] = useState({ date: '', name: '' });
  const [tplId, setTplId] = useState('');
  const [tplBody, setTplBody] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: () => unwrap(api.GET('/v1/admin/settings')) });
  const holidays = useQuery({ queryKey: ['admin-holidays'], queryFn: () => unwrap(api.GET('/v1/admin/holidays')) });
  const templates = useQuery({ queryKey: ['templates-admin'], queryFn: () => unwrap(api.GET('/v1/contract-templates')) });
  const deliveries = useQuery({ queryKey: ['admin-deliveries'], queryFn: () => unwrap(api.GET('/v1/admin/webhook-deliveries')) });
  const tpl = templates.data?.data.find((x) => x.id === tplId);
  const body = tplBody ?? tpl?.bodyHbs ?? '';
  return (
    <>
      <PageHeader title={t('adminConsole.title')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <Card className="mb-6">
        <CardHeader><CardTitle>{t('adminConsole.settings')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('adminConsole.key')}</Th><Th>{t('adminConsole.value')}</Th><Th /></tr></thead>
            <tbody>
              {(settings.data?.data ?? []).map((s) => {
                const v = edits[s.key] ?? JSON.stringify(s.value);
                return (
                  <tr key={s.key}>
                    <Td className="font-mono text-xs">{s.key}</Td>
                    <Td>{typeof s.value === 'string' && String(s.value).length > 60 ? <Textarea aria-label={s.key} rows={2} value={v} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })} /> : <Input aria-label={s.key} className="h-8" value={v} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })} />}</Td>
                    <Td><Button size="sm" variant="secondary" disabled={edits[s.key] === undefined} loading={busy === s.key} onClick={() => run(s.key, async () => { await unwrap(api.PUT('/v1/admin/settings/{key}', { params: { path: { key: s.key } }, body: { value: JSON.parse(edits[s.key]!) } })); setEdits({ ...edits, [s.key]: undefined as never }); await qc.invalidateQueries({ queryKey: ['admin-settings'] }); }, t('common.saved'))}>{t('common.save')}</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('adminConsole.holidays')}</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Input type="date" aria-label={t('adminConsole.date')} value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} />
              <Input aria-label={t('adminConsole.holidayName')} placeholder={t('adminConsole.holidayName')} value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} />
              <Button disabled={!hol.date || hol.name.length < 2} onClick={() => run('hol', async () => { await unwrap(api.POST('/v1/admin/holidays', { body: hol })); setHol({ date: '', name: '' }); await qc.invalidateQueries({ queryKey: ['admin-holidays'] }); })}>{t('adminConsole.add')}</Button>
            </div>
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">
              {(holidays.data?.data ?? []).map((h) => <li key={h.id} className="flex justify-between"><span>{formatDate(h.date)} · {h.name}</span>{h.movable && <button className="text-xs text-red-600" onClick={() => run(`dh${h.id}`, async () => { await unwrap(api.DELETE('/v1/admin/holidays/{id}', { params: { path: { id: h.id } } })); await qc.invalidateQueries({ queryKey: ['admin-holidays'] }); })}>{t('adminConsole.remove')}</button>}</li>)}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('adminConsole.webhooks')}</CardTitle></CardHeader>
          <CardBody className="max-h-80 space-y-1 overflow-auto text-xs">
            {(deliveries.data?.data ?? []).map((d) => <p key={d.id}><Badge tone={d.status === 'failed' ? 'red' : d.status === 'pending' ? 'amber' : 'green'}>{d.status}</Badge> {d.orgName} · {d.eventType} · {d.attempts}× · {d.lastStatusCode ?? '—'} · {formatDateTime(d.createdAt)}</p>)}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t('adminConsole.templates')}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <Alert tone="info">{t('adminConsole.counsel')}</Alert>
          <Select aria-label={t('adminConsole.templates')} value={tplId} onChange={(e) => { setTplId(e.target.value); setTplBody(null); setPreview(null); }}>
            <option value="">—</option>
            {(templates.data?.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.locale} · v{x.templateVersion}</option>)}
          </Select>
          {tpl && (
            <>
              <p className="text-xs text-neutral-600">{t('adminConsole.variables')} : {tpl.variablesSchema.map((v) => v.name).join(', ') || '—'}</p>
              <Textarea aria-label={t('adminConsole.body')} rows={14} className="font-mono text-xs" value={body} onChange={(e) => setTplBody(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="secondary" loading={busy === 'pv'} onClick={() => run('pv', async () => setPreview((await unwrap(api.POST('/v1/admin/contract-templates/preview', { body: { bodyHbs: body, locale: tpl.locale === 'en' ? 'en' : 'fr' } }))).html))}>{t('adminConsole.preview')}</Button>
                <Button disabled={tplBody === null} loading={busy === 'save'} onClick={() => run('save', async () => { const n = await unwrap(api.PATCH('/v1/contract-templates/{id}', { params: { path: { id: tpl.id } }, headers: { 'If-Match': `"${tpl.version}"` }, body: { bodyHbs: body } })); setTplId(n.id); setTplBody(null); await qc.invalidateQueries({ queryKey: ['templates-admin'] }); }, t('adminConsole.newVersion'))}>{t('adminConsole.saveVersion')}</Button>
              </div>
              {preview && <iframe title={t('adminConsole.preview')} className="h-96 w-full rounded border border-neutral-200" srcDoc={preview} sandbox="" />}
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
