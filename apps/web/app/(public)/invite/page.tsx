'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { AuthCard } from '@/components/layout/auth-card';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';

function InviteInner() {
  const t = useTranslations();
  const { api, acceptTokens } = useSession();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const q = useQuery({ queryKey: ['invite', token], queryFn: () => unwrap(api.GET('/v1/invitations/lookup', { params: { query: { token } } })), retry: false });
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <AuthCard title={t('auth.verifyFailed')}><Alert tone="error">{t('auth.inviteInvalid')}</Alert></AuthCard>;
  const inv = q.data;
  return (
    <AuthCard title={t('auth.inviteTitle', { org: inv.orgName })} subtitle={t('auth.inviteRoles', { roles: inv.roles.map((r) => t(`roles.${r}`)).join(', ') })}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const tok = await unwrap(api.POST('/v1/invitations/accept', { body: inv.existingUser ? { token, password } : { token, fullName, password } }));
            await acceptTokens(tok);
            router.push('/app');
          } catch (err) {
            setError(problemMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        {inv.email && <p className="text-sm text-neutral-600">{inv.email}</p>}
        {inv.existingUser ? (
          <p className="text-sm">{t('auth.inviteExisting')}</p>
        ) : (
          <Field label={t('auth.fullName')} htmlFor="fullName">
            <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
        )}
        <Field label={t('auth.password')} htmlFor="password" hint={inv.existingUser ? undefined : t('auth.passwordHint')}>
          <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={busy}>{t('auth.acceptInvite')}</Button>
      </form>
    </AuthCard>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteInner />
    </Suspense>
  );
}
