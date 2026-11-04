'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { AuthCard } from '@/components/layout/auth-card';
import { Alert, Spinner, buttonVariants } from '@/components/ui';
import { useSession } from '@/lib/session';

function VerifyInner() {
  const t = useTranslations();
  const { api } = useSession();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'busy' | 'ok' | 'fail'>('busy');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    unwrap(api.POST('/v1/auth/verify-email', { body: { token } }))
      .then(() => setState('ok'))
      .catch(() => setState('fail'));
  }, [api, token]);
  return (
    <AuthCard title={t('auth.verifyTitle')}>
      {state === 'busy' && <Spinner />}
      {state === 'ok' && <Alert tone="success">{t('auth.verifyDone')}</Alert>}
      {state === 'fail' && <Alert tone="error">{t('auth.verifyFailed')}</Alert>}
      {state !== 'busy' && <Link href="/app" className={`${buttonVariants()} mt-4 w-full`}>{t('auth.goToApp')}</Link>}
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
