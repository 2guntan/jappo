'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { AuthCard } from '@/components/layout/auth-card';
import { Alert, Button, Field, Input } from '@/components/ui';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';

function ResetInner() {
  const t = useTranslations();
  const { api } = useSession();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title={t('auth.resetTitle')}>
      {state === 'done' ? (
        <Alert tone="success">
          {t('auth.resetDone')} <Link href="/login" className="font-medium underline">{t('public.nav.login')}</Link>
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setState('busy');
            setError(null);
            try {
              await unwrap(api.POST('/v1/auth/password/reset', { body: { token, password } }));
              setState('done');
            } catch (err) {
              setError(problemMessage(err, t));
              setState('idle');
            }
          }}
        >
          {error && <Alert tone="error">{error}</Alert>}
          <Field label={t('auth.password')} htmlFor="password" hint={t('auth.passwordHint')}>
            <Input id="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={state === 'busy'}>{t('common.save')}</Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
