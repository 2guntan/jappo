'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { Alert, Button, Card, CardBody, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';

export function MfaEnrolPanel({ forced = false }: { forced?: boolean }) {
  const t = useTranslations();
  const { api, acceptTokens, me } = useSession();
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (me?.user?.mfaEnabled || done) return <Alert tone="success">{t('security.activated')}</Alert>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{forced ? t('app.mfaRequiredTitle') : t('security.mfa')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {forced && <p className="text-sm text-neutral-700">{t('app.mfaRequiredText')}</p>}
        {error && <Alert tone="error">{error}</Alert>}
        {!secret ? (
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setSecret(await unwrap(api.POST('/v1/auth/mfa/enroll')));
              } catch (e) {
                setError(problemMessage(e, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('security.enroll')}
          </Button>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await acceptTokens(await unwrap(api.POST('/v1/auth/mfa/activate', { body: { code } })));
                setDone(true);
              } catch (err) {
                setError(problemMessage(err, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="text-sm">{t('security.scan')}</p>
            <code className="block break-all rounded bg-neutral-100 p-2 text-sm" data-testid="totp-secret">{secret.secret}</code>
            <a href={secret.otpauthUrl} className="text-sm text-brand-700 underline">otpauth://</a>
            <Field label={t('auth.totp')} htmlFor="mfa-code">
              <Input id="mfa-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Button type="submit" loading={busy}>{t('security.activate')}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
