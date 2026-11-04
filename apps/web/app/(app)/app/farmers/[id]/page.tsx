'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDate, formatDateTime, formatXof, statusTone } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { FarmerForm, toFarmerBody } from '@/components/farmers/farmer-form';

export default function FarmerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [edit, setEdit] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pii, setPii] = useState<{ nationalIdNumber: string | null; mobileWalletNumber: string | null } | null>(null);
  const f = useQuery({ queryKey: ['farmer', id], queryFn: () => unwrap(api.GET('/v1/farmers/{id}', { params: { path: { id } } })) });
  const hist = useQuery({ queryKey: ['farmer-history', id], queryFn: () => unwrap(api.GET('/v1/farmers/{id}/history', { params: { path: { id } } })) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['farmer', id] });
  if (f.isLoading || !f.data) return <Spinner />;
  const x = f.data;
  const can = (a: string) => x.allowedActions.includes(a);
  return (
    <>
      <PageHeader
        title={`${x.firstName} ${x.lastName}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{x.code} · {t(`enum.sex.${x.sex}`)} {x.birthYear ? `· ${x.birthYear}` : ''} <Badge tone={statusTone(x.kycStatus)} data-testid="farmer-kyc">{t(`farmers.kycStatus.${x.kycStatus}`)}</Badge></span>}
        actions={<Link href="/app/farmers" className="text-sm text-brand-700">{t('common.back')}</Link>}
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      {x.flags.map((fl) => <Alert key={fl.id} tone="warning" className="mb-2">{fl.type} — {fl.detail}</Alert>)}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{t('org.profile')}</CardTitle>
            {can('update') && <Button size="sm" variant="secondary" onClick={() => setEdit(!edit)}>{edit ? t('common.cancel') : t('farmers.edit')}</Button>}
          </CardHeader>
          <CardBody>
            {edit ? (
              <FarmerForm
                edit
                submitLabel={t('common.save')}
                busy={busy === 'save'}
                defaults={{ firstName: x.firstName, lastName: x.lastName, sex: x.sex, birthYear: x.birthYear?.toString() ?? '', phone: x.phone ?? '', village: x.village ?? '', commune: x.commune ?? '', householdSize: x.householdSize?.toString() ?? '', baselineIncomeXof: x.baselineIncomeXof?.toString() ?? '', nationalIdType: x.nationalIdType, mobileWalletProvider: x.mobileWalletProvider, consentData: !!x.consentDataAt, consentCreditBureau: !!x.consentCreditBureauAt }}
                onSubmit={(v) => void run('save', async () => { await unwrap(api.PATCH('/v1/farmers/{id}', { params: { path: { id } }, headers: ifMatch(x.version), body: toFarmerBody(v, true) as never })); setEdit(false); await refresh(); }, t('common.saved'))}
              />
            ) : (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <dt className="text-neutral-500">{t('common.phone')}</dt><dd>{x.phone ?? '—'}</dd>
                <dt className="text-neutral-500">{t('farmers.village')}</dt><dd>{[x.village, x.commune].filter(Boolean).join(', ') || '—'}</dd>
                <dt className="text-neutral-500">{t('farmers.nationalIdType')}</dt><dd>{t(`enum.nationalIdType.${x.nationalIdType}`)} {pii?.nationalIdNumber ?? x.nationalIdNumberMasked ?? ''}</dd>
                <dt className="text-neutral-500">{t('farmers.walletProvider')}</dt><dd>{t(`enum.walletProvider.${x.mobileWalletProvider}`)} {pii?.mobileWalletNumber ?? x.mobileWalletNumberMasked ?? ''} {x.walletVerifiedAt ? <Badge tone="green">{t('farmers.walletVerified')}</Badge> : <Badge>{t('farmers.walletUnverified')}</Badge>}</dd>
                <dt className="text-neutral-500">{t('farmers.householdSize')}</dt><dd>{x.householdSize ?? '—'}</dd>
                <dt className="text-neutral-500">{t('farmers.baselineIncome')}</dt><dd>{formatXof(x.baselineIncomeXof)}</dd>
                <dt className="text-neutral-500">{t('farmers.consentData')}</dt><dd>{formatDateTime(x.consentDataAt)}</dd>
                <dt className="text-neutral-500">{t('farmers.consentCreditBureau')}</dt><dd>{formatDateTime(x.consentCreditBureauAt)}</dd>
              </dl>
            )}
          </CardBody>
        </Card>
        <div className="space-y-4">
          {can('verify_kyc') && (
            <Card><CardBody><Button className="w-full" loading={busy === 'kyc'} onClick={() => run('kyc', async () => { await unwrap(api.POST('/v1/farmers/{id}/actions/verify-kyc', { params: { path: { id } }, headers: ifMatch(x.version) })); await refresh(); })}>{t('farmers.verifyKyc')}</Button></CardBody></Card>
          )}
          {can('verify_wallet') && (
            <Card>
              <CardBody className="space-y-3">
                {otp === null ? (
                  <Button className="w-full" variant="secondary" loading={busy === 'otp'} onClick={() => run('otp', async () => { await unwrap(api.POST('/v1/farmers/{id}/actions/verify-wallet', { params: { path: { id } } })); setOtp(''); }, t('farmers.otpSent'))}>{t('farmers.verifyWallet')}</Button>
                ) : (
                  <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run('confirm', async () => { await unwrap(api.POST('/v1/farmers/{id}/actions/confirm-wallet', { params: { path: { id } }, body: { code: otp } })); setOtp(null); await refresh(); }); }}>
                    <Field label={t('auth.code')} htmlFor="wallet-otp"><Input id="wallet-otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>
                    <Button type="submit" loading={busy === 'confirm'}>{t('farmers.confirmWallet')}</Button>
                  </form>
                )}
              </CardBody>
            </Card>
          )}
          {can('reveal_pii') && !pii && (
            <Card>
              <CardBody className="space-y-2">
                <Field label={t('farmers.revealReason')} htmlFor="pii-reason"><Input id="pii-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <Button size="sm" variant="ghost" disabled={reason.length < 5} onClick={() => run('pii', async () => setPii(await unwrap(api.GET('/v1/farmers/{id}/pii', { params: { path: { id }, query: { reason } } }))))}>{t('farmers.reveal')}</Button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>{t('farmers.history')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('adminLand.block')}</Th><Th>{t('blocks.code')}</Th><Th>{t('blocks.share')}</Th><Th>{t('blocks.issueDate')}</Th><Th>{t('common.status')}</Th></tr></thead>
            <tbody>
              {hist.data?.allocations.map((a) => (
                <tr key={a.id}><Td><Link className="text-brand-700 hover:underline" href={`/app/blocks/${a.blockId}?tab=plots`}>{a.blockName}</Link></Td><Td>{a.plotCode}</Td><Td>{a.sharePct} %</Td><Td>{formatDate(a.startDate)}{a.endDate ? ` → ${formatDate(a.endDate)}` : ''}</Td><Td>{a.status}</Td></tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
