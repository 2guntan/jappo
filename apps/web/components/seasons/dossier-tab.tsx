'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Table, Td, Th } from '@/components/ui';

export function DossierTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const q = useQuery({
    queryKey: ['dossiers', season.id],
    queryFn: () => unwrap(api.GET('/v1/seasons/{id}/dossiers', { params: { path: { id: season.id } } })),
    refetchInterval: (query) => (query.state.data?.data.some((d) => d.pdfStatus !== 'ready' && d.status === 'frozen') ? 3000 : false),
  });
  const rows = q.data?.data ?? [];
  const open = async (url: Promise<{ url: string }>) => window.open((await url).url, '_blank', 'noopener');
  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {hasPermission('dossier:freeze') && ['planning', 'financing'].includes(season.status) && (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-neutral-600">{t('dossier.freezeHelp')}</p>
            <Button loading={busy === 'freeze'} onClick={() => run('freeze', async () => { await unwrap(api.POST('/v1/seasons/{id}/dossiers', { params: { path: { id: season.id } } })); await qc.invalidateQueries({ queryKey: ['dossiers', season.id] }); await qc.invalidateQueries({ queryKey: ['block', season.blockId] }); })}>{t('dossier.freeze')}</Button>
          </CardBody>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t('dossier.title')} description={t('dossier.none')} />
      ) : (
        rows.map((d) => (
          <Card key={d.id}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{d.ref} · {t('dossier.version')} {d.version} <Badge tone={d.status === 'frozen' ? 'green' : 'neutral'} data-testid={`dossier-status-${d.version}`}>{t(`dossier.status.${d.status}`)}</Badge></CardTitle>
              <div className="flex items-center gap-3 text-sm">
                <span>{t('readiness.score')} <strong>{d.readinessScore}</strong> · {d.grade}</span>
                <span className="text-neutral-500">{t('dossier.frozenAt')} {formatDateTime(d.frozenAt)}</span>
                {d.pdfFileId ? (
                  <Button size="sm" variant="secondary" data-testid="dossier-pdf" onClick={() => open(unwrap(api.GET('/v1/dossiers/{id}/pdf', { params: { path: { id: d.id } } })))}>{t('dossier.download')}</Button>
                ) : (
                  <span className="text-xs text-neutral-500">{t('dossier.pdfPending')}</span>
                )}
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <thead><tr><Th>{t('dossier.dataRoom')}</Th><Th /><Th /></tr></thead>
                <tbody>
                  {d.dataRoom.map((f) => (
                    <tr key={f.fileId}><Td className="text-xs uppercase text-neutral-500">{f.category}</Td><Td>{f.label}<div className="text-xs text-neutral-500">{f.filename}</div></Td><Td><Button size="sm" variant="ghost" onClick={() => open(unwrap(api.GET('/v1/files/{id}/signed-url', { params: { path: { id: f.fileId } } })))}>{t('common.open')}</Button></Td></tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
