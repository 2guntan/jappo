'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { AuthCard } from '@/components/layout/auth-card';
import { Alert, Button, Field, Input } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function ForgotPage() {
  const t = useTranslations();
  const { api } = useSession();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t('auth.forgotTitle')}>
      {done ? (
        <Alert tone="success">{t('auth.forgotSent')}</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await unwrap(api.POST('/v1/auth/password/forgot', { body: { email } })).catch(() => undefined);
            setBusy(false);
            setDone(true);
          }}
        >
          <Field label={t('common.email')} htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>{t('auth.sendLink')}</Button>
        </form>
      )}
    </AuthCard>
  );
}
