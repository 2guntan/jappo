'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ApiError, unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';
import { downloadCsv, statusTone } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, EmptyState, Input, PageHeader, Select, Spinner, Table, Td, Th, buttonVariants } from '@/components/ui';

type ImportResult = { created: number; updated: number; failed: number; rows: { row: number; status: string; errors: { field: string; message: string }[] }[] };

export default function FarmersPage() {
  const t = useTranslations();
  const { api, authedFetch, activeOrgId, hasPermission } = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [kyc, setKyc] = useState('');
  const [importRes, setImportRes] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['farmers', activeOrgId, q, kyc],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET('/v1/farmers', { params: { query: { limit: 100, cursor: pageParam, q: q || undefined, ...(kyc ? { 'filter[kycStatus]': kyc as 'pending' } : {}) } } })),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  const doImport = async (file: File) => {
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    const r = await authedFetch('/v1/farmers/import', { method: 'POST', body: fd });
    const body = await r.json();
    if (!r.ok) return setError(problemMessage(new ApiError(r.status, body), t));
    setImportRes(body as ImportResult);
    await qc.invalidateQueries({ queryKey: ['farmers'] });
  };
  const template = async () => {
    const r = await authedFetch('/v1/farmers/import-template');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = 'farmers-import-template.csv';
    a.click();
  };

  return (
    <>
      <PageHeader
        title={t('farmers.title')}
        actions={
          <>
            <Button variant="secondary" onClick={() => downloadCsv('farmers.csv', rows.map((f) => ({ code: f.code, firstName: f.firstName, lastName: f.lastName, sex: f.sex, village: f.village, kyc: f.kycStatus, wallet: f.walletVerifiedAt ? 'verified' : '' })))}>{t('common.exportCsv')}</Button>
            {hasPermission('farmer:import') && (
              <>
                <Button variant="ghost" onClick={template}>{t('farmers.template')}</Button>
                <label className={`${buttonVariants({ variant: 'secondary' })} cursor-pointer`}>
                  {t('farmers.import')}
                  <input type="file" accept=".csv,text/csv" className="sr-only" data-testid="farmers-import" onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
                </label>
              </>
            )}
            {hasPermission('farmer:create') && <Link href="/app/farmers/new" className={buttonVariants()}>{t('farmers.new')}</Link>}
          </>
        }
      />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {importRes && (
        <Alert tone={importRes.failed ? 'warning' : 'success'} className="mb-4">
          <p data-testid="import-result">{t('farmers.importResult', { created: importRes.created, updated: importRes.updated, failed: importRes.failed })}</p>
          {importRes.rows.filter((r) => r.status === 'error').map((r) => <p key={r.row} className="text-xs">{t('farmers.row')} {r.row} : {r.errors.map((e) => `${e.field} (${e.message})`).join(', ')}</p>)}
        </Alert>
      )}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-72"><Input placeholder={t('common.search')} aria-label={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-48">
          <Select aria-label={t('farmers.kyc')} value={kyc} onChange={(e) => setKyc(e.target.value)}>
            <option value="">{t('admin.all')}</option>
            {(['pending', 'verified', 'rejected'] as const).map((s) => <option key={s} value={s}>{t(`farmers.kycStatus.${s}`)}</option>)}
          </Select>
        </div>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={t('farmers.title')} description={t('farmers.empty')} action={hasPermission('farmer:create') ? <Link href="/app/farmers/new" className={buttonVariants()}>{t('farmers.new')}</Link> : undefined} />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('farmers.code')}</Th><Th>{t('common.name')}</Th><Th>{t('farmers.sex')}</Th><Th>{t('common.phone')}</Th><Th>{t('farmers.village')}</Th><Th>{t('farmers.kyc')}</Th><Th>{t('farmers.wallet')}</Th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <Td><Link href={`/app/farmers/${f.id}`} className="font-medium text-brand-700 hover:underline">{f.code}</Link></Td>
                    <Td>{f.firstName} {f.lastName} {f.flags.length > 0 && <Badge tone="red">{f.flags.length}</Badge>}</Td>
                    <Td>{t(`enum.sex.${f.sex}`)}</Td>
                    <Td>{f.phone ?? '—'}</Td>
                    <Td>{f.village ?? '—'}</Td>
                    <Td><Badge tone={statusTone(f.kycStatus)}>{t(`farmers.kycStatus.${f.kycStatus}`)}</Badge></Td>
                    <Td>{f.walletVerifiedAt ? <Badge tone="green">{t('farmers.walletVerified')}</Badge> : <Badge>{t('farmers.walletUnverified')}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
      {list.hasNextPage && <Button variant="secondary" className="mt-4" onClick={() => list.fetchNextPage()}>{t('common.loadMore')}</Button>}
    </>
  );
}
