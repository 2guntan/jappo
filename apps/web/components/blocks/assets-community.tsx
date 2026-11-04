'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { ASSET_TYPES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDate, statusTone } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui';
import type { BlockT } from './types';

export function AssetsTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [type, setType] = useState<(typeof ASSET_TYPES)[number]>('borehole');
  const [description, setDescription] = useState('');
  const q = useQuery({ queryKey: ['assets', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/assets', { params: { path: { id: block.id } } })) });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('blocks.assetType')}</Th><Th>{t('blocks.description')}</Th><Th>{t('common.createdAt')}</Th></tr></thead>
            <tbody>{q.data?.data.map((a) => <tr key={a.id}><Td>{t(`enum.assetType.${a.type}`)}</Td><Td>{a.description}</Td><Td>{formatDate(a.createdAt)}</Td></tr>)}</tbody>
          </Table>
        </CardBody>
      </Card>
      {hasPermission('asset:manage') && block.ownerOrgId && (
        <Card>
          <CardHeader><CardTitle>{t('blocks.assets')}</CardTitle></CardHeader>
          <CardBody>
            {msg && <Alert tone={msg.tone} className="mb-3">{msg.text}</Alert>}
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run('asset', async () => { await unwrap(api.POST('/v1/blocks/{id}/assets', { params: { path: { id: block.id } }, body: { type, description } })); setDescription(''); await qc.invalidateQueries({ queryKey: ['assets', block.id] }); }); }}>
              <Field label={t('blocks.assetType')} htmlFor="asset-type"><Select id="asset-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>{ASSET_TYPES.map((a) => <option key={a} value={a}>{t(`enum.assetType.${a}`)}</option>)}</Select></Field>
              <Field label={t('blocks.description')} htmlFor="asset-desc"><Input id="asset-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
              <Button type="submit" disabled={description.length < 2} loading={busy === 'asset'}>{t('blocks.addAsset')}</Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function CommunityTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [form, setForm] = useState({ reporter: '', category: '', description: '' });
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['grievances', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/grievances', { params: { path: { id: block.id } } })) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['grievances', block.id] });
  const can = hasPermission('grievance:manage');
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>{t('blocks.grievances')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('admin.at')}</Th><Th>{t('blocks.reporter')}</Th><Th>{t('blocks.category')}</Th><Th>{t('blocks.description')}</Th><Th>{t('common.status')}</Th></tr></thead>
            <tbody>
              {q.data?.data.map((g) => (
                <tr key={g.id}>
                  <Td>{formatDate(g.reportedAt)}</Td>
                  <Td>{g.reporter}</Td>
                  <Td>{g.category}</Td>
                  <Td>{g.description}{g.resolution && <div className="text-xs text-neutral-500">{t('blocks.resolution')} : {g.resolution}</div>}</Td>
                  <Td>
                    <Badge tone={statusTone(g.status)}>{t(`enum.grievanceStatus.${g.status}`)}</Badge>
                    {can && (g.status === 'open' || g.status === 'in_progress') && (
                      <div className="mt-2 flex gap-1">
                        <Input aria-label={t('blocks.resolution')} value={resolution[g.id] ?? ''} onChange={(e) => setResolution({ ...resolution, [g.id]: e.target.value })} className="h-8" />
                        <Button size="sm" onClick={() => run('res', async () => { await unwrap(api.PATCH('/v1/grievances/{id}', { params: { path: { id: g.id } }, headers: ifMatch(g.version), body: { status: 'resolved', resolution: resolution[g.id] ?? null } })); await refresh(); })}>{t('blocks.resolve')}</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      {can && (
        <Card>
          <CardBody>
            {msg && <Alert tone={msg.tone} className="mb-3">{msg.text}</Alert>}
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run('g', async () => { await unwrap(api.POST('/v1/blocks/{id}/grievances', { params: { path: { id: block.id } }, body: form })); setForm({ reporter: '', category: '', description: '' }); await refresh(); }); }}>
              <Field label={t('blocks.reporter')} htmlFor="g-rep"><Input id="g-rep" value={form.reporter} onChange={(e) => setForm({ ...form, reporter: e.target.value })} /></Field>
              <Field label={t('blocks.category')} htmlFor="g-cat"><Input id="g-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
              <Field label={t('blocks.description')} htmlFor="g-desc"><Textarea id="g-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              <Button type="submit" loading={busy === 'g'}>{t('blocks.addGrievance')}</Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
