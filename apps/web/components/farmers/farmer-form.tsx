'use client';

import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { NATIONAL_ID_TYPES, WALLET_PROVIDERS } from '@jappo/contracts';
import { Button, Field, Input, Select } from '@/components/ui';

export interface FarmerFormValues {
  firstName: string;
  lastName: string;
  sex: 'F' | 'M';
  birthYear: string;
  phone: string;
  village: string;
  commune: string;
  householdSize: string;
  baselineIncomeXof: string;
  nationalIdType: (typeof NATIONAL_ID_TYPES)[number];
  nationalIdNumber: string;
  mobileWalletProvider: (typeof WALLET_PROVIDERS)[number];
  mobileWalletNumber: string;
  consentData: boolean;
  consentCreditBureau: boolean;
}

/** Convert form values to the API body (empty → null, numbers parsed). PII left out when unchanged (blank on edit). */
export function toFarmerBody(v: FarmerFormValues, edit = false) {
  const n = (s: string) => (s.trim() === '' ? null : Number(s));
  const s = (x: string) => (x.trim() === '' ? null : x.trim());
  const body: Record<string, unknown> = {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    sex: v.sex,
    birthYear: n(v.birthYear),
    phone: s(v.phone),
    village: s(v.village),
    commune: s(v.commune),
    householdSize: n(v.householdSize),
    baselineIncomeXof: n(v.baselineIncomeXof),
    nationalIdType: v.nationalIdType,
    mobileWalletProvider: v.mobileWalletProvider,
    consentData: v.consentData,
    consentCreditBureau: v.consentCreditBureau,
  };
  if (!edit || v.nationalIdNumber.trim()) body.nationalIdNumber = s(v.nationalIdNumber);
  if (!edit || v.mobileWalletNumber.trim()) body.mobileWalletNumber = s(v.mobileWalletNumber);
  return body;
}

export function FarmerForm({ defaults, onSubmit, busy, submitLabel, edit = false }: { defaults?: Partial<FarmerFormValues>; onSubmit: (v: FarmerFormValues) => void; busy?: boolean; submitLabel: string; edit?: boolean }) {
  const t = useTranslations();
  const { register, handleSubmit, watch } = useForm<FarmerFormValues>({
    defaultValues: { sex: 'F', nationalIdType: 'cni', mobileWalletProvider: 'wave', consentData: true, consentCreditBureau: true, birthYear: '', phone: '+221', village: '', commune: '', householdSize: '', baselineIncomeXof: '', nationalIdNumber: '', mobileWalletNumber: '', ...defaults },
  });
  const idType = watch('nationalIdType');
  const wallet = watch('mobileWalletProvider');
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('farmers.firstName')} htmlFor="firstName"><Input id="firstName" required {...register('firstName', { required: true })} /></Field>
        <Field label={t('farmers.lastName')} htmlFor="lastName"><Input id="lastName" required {...register('lastName', { required: true })} /></Field>
        <Field label={t('farmers.sex')} htmlFor="sex"><Select id="sex" {...register('sex')}><option value="F">{t('enum.sex.F')}</option><option value="M">{t('enum.sex.M')}</option></Select></Field>
        <Field label={t('farmers.birthYear')} htmlFor="birthYear"><Input id="birthYear" type="number" min={1900} max={2030} {...register('birthYear')} /></Field>
        <Field label={t('common.phone')} htmlFor="phone"><Input id="phone" type="tel" {...register('phone')} /></Field>
        <Field label={t('farmers.village')} htmlFor="village"><Input id="village" {...register('village')} /></Field>
        <Field label={t('farmers.commune')} htmlFor="commune"><Input id="commune" {...register('commune')} /></Field>
        <Field label={t('farmers.householdSize')} htmlFor="householdSize"><Input id="householdSize" type="number" min={1} {...register('householdSize')} /></Field>
        <Field label={t('farmers.baselineIncome')} htmlFor="baselineIncomeXof"><Input id="baselineIncomeXof" type="number" min={0} {...register('baselineIncomeXof')} /></Field>
        <Field label={t('farmers.nationalIdType')} htmlFor="nationalIdType"><Select id="nationalIdType" {...register('nationalIdType')}>{NATIONAL_ID_TYPES.map((x) => <option key={x} value={x}>{t(`enum.nationalIdType.${x}`)}</option>)}</Select></Field>
        {idType !== 'none' && <Field label={t('farmers.nationalIdNumber')} htmlFor="nationalIdNumber" hint={edit ? '****' : undefined}><Input id="nationalIdNumber" autoComplete="off" {...register('nationalIdNumber')} /></Field>}
        <Field label={t('farmers.walletProvider')} htmlFor="mobileWalletProvider"><Select id="mobileWalletProvider" {...register('mobileWalletProvider')}>{WALLET_PROVIDERS.map((x) => <option key={x} value={x}>{t(`enum.walletProvider.${x}`)}</option>)}</Select></Field>
        {wallet !== 'none' && <Field label={t('farmers.walletNumber')} htmlFor="mobileWalletNumber" hint={edit ? '****' : undefined}><Input id="mobileWalletNumber" type="tel" autoComplete="off" {...register('mobileWalletNumber')} /></Field>}
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" {...register('consentData')} /> {t('farmers.consentData')}</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" {...register('consentCreditBureau')} /> {t('farmers.consentCreditBureau')}</label>
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  );
}
