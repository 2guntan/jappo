'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ApiError, unwrap } from '@jappo/sdk';
import { AuthCard } from '@/components/layout/auth-card';
import { Alert, Button, Field, Input } from '@/components/ui';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';

type Form = { email: string; password: string; totp?: string };

function LoginInner() {
  const t = useTranslations();
  const { api, acceptTokens } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/app';
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'password' | 'phone'>('password');
  const { register, handleSubmit, formState } = useForm<Form>();

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const tok = await unwrap(api.POST('/v1/auth/login', { body: { email: v.email, password: v.password, totp: needTotp ? v.totp : undefined } }));
      await acceptTokens(tok);
      router.push(next.startsWith('/') ? next : '/app');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') setNeedTotp(true);
      setError(problemMessage(e, t));
    }
  });

  return (
    <AuthCard
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')} <Link href="/signup" className="font-medium text-brand-700">{t('public.nav.signup')}</Link>
        </>
      }
    >
      {mode === 'password' ? (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label={t('common.email')} htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required {...register('email', { required: true })} />
          </Field>
          <Field label={t('auth.password')} htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required {...register('password', { required: true })} />
          </Field>
          {needTotp && (
            <Field label={t('auth.totp')} htmlFor="totp">
              <Input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus {...register('totp')} />
            </Field>
          )}
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>{t('auth.submitLogin')}</Button>
          <div className="flex justify-between text-sm">
            <Link href="/forgot-password" className="text-brand-700">{t('auth.forgot')}</Link>
            <button type="button" className="text-brand-700" onClick={() => setMode('phone')}>{t('auth.phoneLogin')}</button>
          </div>
        </form>
      ) : (
        <PhoneLogin onBack={() => setMode('password')} next={next} />
      )}
    </AuthCard>
  );
}

function PhoneLogin({ onBack, next }: { onBack: () => void; next: string }) {
  const t = useTranslations();
  const { api, acceptTokens } = useSession();
  const router = useRouter();
  const [phone, setPhone] = useState('+221');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(problemMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <h2 className="font-medium">{t('auth.phoneLoginTitle')}</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {sent && <Alert tone="info">{t('auth.codeSent')}</Alert>}
      <Field label={t('common.phone')} htmlFor="phone">
        <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {!sent ? (
        <Button className="w-full" loading={busy} onClick={() => run(async () => { await unwrap(api.POST('/v1/auth/otp/request', { body: { phone } })); setSent(true); })}>
          {t('auth.sendCode')}
        </Button>
      ) : (
        <>
          <Field label={t('auth.code')} htmlFor="code">
            <Input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
          </Field>
          <Button className="w-full" loading={busy} onClick={() => run(async () => { await acceptTokens(await unwrap(api.POST('/v1/auth/otp/verify', { body: { phone, code } }))); router.push(next); })}>
            {t('auth.verifyCode')}
          </Button>
        </>
      )}
      <Button variant="link" onClick={onBack}>{t('common.back')}</Button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
