'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ApiError, unwrap } from '@jappo/sdk';
import { KYC_DOC_TYPES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';
import { formatDateTime, kycTone } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';

const REQUIRED: Record<string, string[]> = { operator: ['ninea', 'rccm'], lender: ['ninea', 'rccm', 'approval_bceao'], buyer: ['ninea', 'rccm'], guarantor: ['ninea', 'rccm'], insurer: ['ninea', 'rccm'], supplier: ['ninea', 'rccm'], farmer_group: ['ninea'] };

type ProfileForm = { tradeName: string; ninea: string; rccm: string; region: string; address: string; phone: string; bceaoApprovalNo: string };

export default function OrganizationSettings() {
  const t = useTranslations();
  const { api, authedFetch, activeOrgId, hasPermission, reloadMe } = useSession();
  const qc = useQueryClient();
  const etag = useRef<string | null>(null);
  const org = useQuery({
    queryKey: ['org', activeOrgId],
    queryFn: async () => {
      const r = await api.GET('/v1/orgs/current');
      etag.current = r.response.headers.get('etag');
      return unwrap(Promise.resolve(r));
    },
  });
  const docs = useQuery({ queryKey: ['kyc-docs', activeOrgId], queryFn: () => unwrap(api.GET('/v1/orgs/current/kyc-documents')) });
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [docType, setDocType] = useState<string>('ninea');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm<ProfileForm>();

  useEffect(() => {
    if (org.data) {
      const o = org.data;
      reset({ tradeName: o.tradeName ?? '', ninea: o.ninea ?? '', rccm: o.rccm ?? '', region: o.region ?? '', address: o.address ?? '', phone: o.phone ?? '', bceaoApprovalNo: o.bceaoApprovalNo ?? '' });
    }
  }, [org.data, reset]);

  if (org.isLoading || !org.data) return <Spinner />;
  const o = org.data;
  const canEdit = hasPermission('org:update');
  const locked = o.kycStatus === 'verified';
  const nul = (v: string) => (v.trim() === '' ? null : v.trim());

  const save = handleSubmit(async (v) => {
    setMsg(null);
    try {
      await unwrap(
        api.PATCH('/v1/orgs/current', {
          headers: { 'If-Match': etag.current ?? '"0"' },
          body: { tradeName: nul(v.tradeName), region: nul(v.region), address: nul(v.address), phone: nul(v.phone), ...(locked ? {} : { ninea: nul(v.ninea), rccm: nul(v.rccm) }), ...(o.type === 'lender' ? { bceaoApprovalNo: nul(v.bceaoApprovalNo) } : {}) },
        }),
      );
      setMsg({ tone: 'success', text: t('common.saved') });
      await qc.invalidateQueries({ queryKey: ['org'] });
    } catch (e) {
      setMsg({ tone: 'error', text: problemMessage(e, t) });
    }
  });

  const upload = async () => {
    if (!file) return;
    setBusy('upload');
    setMsg(null);
    const fd = new FormData();
    fd.append('docType', docType);
    fd.append('file', file);
    const r = await authedFetch('/v1/orgs/current/kyc-documents', { method: 'POST', body: fd });
    setBusy(null);
    if (!r.ok) {
      setMsg({ tone: 'error', text: problemMessage(new ApiError(r.status, await r.json()), t) });
      return;
    }
    setFile(null);
    await qc.invalidateQueries({ queryKey: ['kyc-docs'] });
  };

  const submitKyc = async () => {
    setBusy('submit');
    setMsg(null);
    try {
      await unwrap(api.POST('/v1/orgs/current/actions/submit-kyc'));
      setMsg({ tone: 'success', text: t('org.submitted') });
      await qc.invalidateQueries({ queryKey: ['org'] });
      await reloadMe();
    } catch (e) {
      setMsg({ tone: 'error', text: problemMessage(e, t) });
    } finally {
      setBusy(null);
    }
  };

  const required = (REQUIRED[o.type] ?? []).map((d) => t(`org.kycDocs.${d}`)).join(', ');
  return (
    <>
      <PageHeader title={o.legalName} subtitle={<span className="flex items-center gap-2">{t(`auth.orgTypes.${o.type}` as 'auth.orgTypes.operator')} · <Badge tone={kycTone(o.kycStatus)} data-testid="kyc-status">{t(`kyc.${o.kycStatus}`)}</Badge></span>} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('org.profile')}</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={save} className="space-y-4">
              <Field label={t('org.tradeName')} htmlFor="tradeName"><Input id="tradeName" disabled={!canEdit} {...register('tradeName')} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('org.ninea')} htmlFor="ninea"><Input id="ninea" disabled={!canEdit || locked} {...register('ninea')} /></Field>
                <Field label={t('org.rccm')} htmlFor="rccm"><Input id="rccm" disabled={!canEdit || locked} {...register('rccm')} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('org.region')} htmlFor="region"><Input id="region" disabled={!canEdit} {...register('region')} /></Field>
                <Field label={t('common.phone')} htmlFor="orgPhone"><Input id="orgPhone" placeholder="+221…" disabled={!canEdit} {...register('phone')} /></Field>
              </div>
              <Field label={t('org.address')} htmlFor="address"><Input id="address" disabled={!canEdit} {...register('address')} /></Field>
              {o.type === 'lender' && <Field label={t('org.bceao')} htmlFor="bceao"><Input id="bceao" disabled={!canEdit} {...register('bceaoApprovalNo')} /></Field>}
              {canEdit && <Button type="submit">{t('common.save')}</Button>}
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('org.kycTitle')}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-neutral-600">{t('org.kycHelp', { docs: required })}</p>
            {docs.data?.data.length ? (
              <Table>
                <thead><tr><Th>{t('org.docType')}</Th><Th>{t('common.status')}</Th><Th>{t('common.createdAt')}</Th></tr></thead>
                <tbody>
                  {docs.data.data.map((d) => (
                    <tr key={d.id}>
                      <Td>{t(`org.kycDocs.${d.docType}`)}<div className="text-xs text-neutral-500">{d.filename}</div></Td>
                      <Td><Badge tone={kycTone(d.status)}>{t(`kyc.${d.status}`)}</Badge>{d.comment && <div className="text-xs text-neutral-500">{d.comment}</div>}</Td>
                      <Td>{formatDateTime(d.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-neutral-500">{t('org.noDocs')}</p>
            )}
            {canEdit && !locked && (
              <div className="space-y-3 rounded-md bg-neutral-50 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('org.docType')} htmlFor="docType">
                    <Select id="docType" value={docType} onChange={(e) => setDocType(e.target.value)}>
                      {KYC_DOC_TYPES.map((d) => <option key={d} value={d}>{t(`org.kycDocs.${d}`)}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('org.file')} htmlFor="kycFile">
                    <Input id="kycFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={upload} disabled={!file} loading={busy === 'upload'}>{t('org.upload')}</Button>
                  {o.allowedActions.includes('submit_kyc') && o.kycStatus !== 'submitted' && (
                    <Button onClick={submitKyc} loading={busy === 'submit'}>{t('org.submitKyc')}</Button>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
