'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { LEGAL_FORMS, LENDER_KINDS, SIGNUP_ORG_TYPES } from '@jappo/contracts';
import { AuthCard } from '@/components/layout/auth-card';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { useSession } from '@/lib/session';
import { applyFieldErrors, problemMessage } from '@/lib/errors';

const schema = z
  .object({
    orgType: z.enum(SIGNUP_ORG_TYPES),
    legalName: z.string().min(2),
    legalForm: z.enum(LEGAL_FORMS),
    lenderKind: z.enum(LENDER_KINDS).optional(),
    fullName: z.string().min(2),
    email: z.email(),
    password: z.string().min(10),
  })
  .refine((v) => v.orgType !== 'lender' || !!v.lenderKind, { path: ['lenderKind'], message: 'required' });
type Form = z.infer<typeof schema>;

function SignupInner() {
  const t = useTranslations();
  const locale = useLocale();
  const { api, acceptTokens } = useSession();
  const router = useRouter();
  const preset = useSearchParams().get('type');
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setError: setFieldError, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { orgType: (SIGNUP_ORG_TYPES as readonly string[]).includes(preset ?? '') ? (preset as Form['orgType']) : 'operator', legalForm: 'SARL' },
  });
  const orgType = watch('orgType');
  const err = (k: keyof Form) => formState.errors[k]?.message;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const tok = await unwrap(api.POST('/v1/auth/signup', { body: { ...v, lenderKind: v.orgType === 'lender' ? v.lenderKind : undefined, locale: locale === 'en' ? 'en' : 'fr' } }));
      await acceptTokens(tok);
      router.push('/app');
    } catch (e) {
      applyFieldErrors(e, setFieldError);
      setError(problemMessage(e, t));
    }
  });

  return (
    <AuthCard title={t('auth.signupTitle')} subtitle={t('auth.signupSubtitle')} footer={<>{t('auth.haveAccount')} <Link href="/login" className="font-medium text-brand-700 underline-offset-4 hover:underline">{t('public.nav.login')}</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('auth.orgType')} htmlFor="orgType">
          <Select id="orgType" {...register('orgType')}>
            {SIGNUP_ORG_TYPES.map((o) => <option key={o} value={o}>{t(`auth.orgTypes.${o}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('auth.legalName')} htmlFor="legalName" error={err('legalName')}>
          <Input id="legalName" aria-invalid={!!err('legalName')} {...register('legalName')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('auth.legalForm')} htmlFor="legalForm">
            <Select id="legalForm" {...register('legalForm')}>
              {LEGAL_FORMS.map((f) => <option key={f} value={f}>{t(`auth.legalForms.${f}`)}</option>)}
            </Select>
          </Field>
          {orgType === 'lender' && (
            <Field label={t('auth.lenderKind')} htmlFor="lenderKind" error={err('lenderKind')}>
              <Select id="lenderKind" {...register('lenderKind')} defaultValue="">
                <option value="" disabled>—</option>
                {LENDER_KINDS.map((k) => <option key={k} value={k}>{t(`auth.lenderKinds.${k}`)}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label={t('auth.fullName')} htmlFor="fullName" error={err('fullName')}>
          <Input id="fullName" autoComplete="name" {...register('fullName')} />
        </Field>
        <Field label={t('common.email')} htmlFor="email" error={err('email')}>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={err('password')} hint={t('auth.passwordHint')}>
          <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>{t('auth.submitSignup')}</Button>
      </form>
    </AuthCard>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupInner />
    </Suspense>
  );
}
