'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { uploadFile, useAction } from '@/lib/hooks';
import { Alert, Button, Field, Input } from '@/components/ui';

type Contract = Schemas['Contract'];
type Party = Contract['parties'][number];

/** OTP signature for the current principal's organisation party, or for a farmer party (code sent to the farmer's phone). */
export function OtpSign({ contract, party, onSigned }: { contract: Contract; party: Party; onSigned: () => Promise<unknown> }) {
  const t = useTranslations('contracts');
  const { api } = useSession();
  const { busy, msg, run } = useAction();
  const [sent, setSent] = useState<{ channel: 'sms' | 'email'; destination: string } | null>(null);
  const [code, setCode] = useState('');
  const id = `otp-${party.id}`;
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!sent ? (
        <Button
          size="sm"
          loading={busy === 'otp'}
          data-testid={`request-otp-${party.id}`}
          onClick={() => run('otp', async () => setSent(await unwrap(api.POST('/v1/contracts/{id}/signatures/actions/request-otp', { params: { path: { id: contract.id } }, body: { partyId: party.id } }))))}
        >
          {party.partyType === 'farmer' ? t('sendFarmerCode') : t('sendCode')}
        </Button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('codeSent', { destination: sent.destination })} htmlFor={id}>
            <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-32" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button
            size="sm"
            disabled={code.length !== 6}
            loading={busy === 'sign'}
            data-testid={`sign-${party.id}`}
            onClick={() => run('sign', async () => {
              await unwrap(api.POST('/v1/contracts/{id}/signatures', { params: { path: { id: contract.id } }, body: { partyId: party.id, method: 'otp', code, channel: sent.channel } }));
              await onSigned();
            })}
          >
            {t('sign')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** In-person signature of a farmer, witnessed by the field agent: photo evidence + GPS point. */
export function InPersonSign({ contract, party, onSigned }: { contract: Contract; party: Party; onSigned: () => Promise<unknown> }) {
  const t = useTranslations('contracts');
  const { api, authedFetch } = useSession();
  const { busy, msg, run } = useAction();
  const [photo, setPhoto] = useState<File | null>(null);
  const id = `photo-${party.id}`;
  const position = () =>
    new Promise<[number, number] | null>((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.longitude, p.coords.latitude]), () => resolve(null), { timeout: 5000 });
    });
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label={t('photo')} htmlFor={id} hint={t('photoHint')}>
        <Input id={id} type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </Field>
      <Button
        size="sm"
        disabled={!photo}
        loading={busy === 'sign'}
        data-testid={`sign-in-person-${party.id}`}
        onClick={() => run('sign', async () => {
          const evidenceFileId = await uploadFile(authedFetch, photo!);
          const gps = await position();
          await unwrap(api.POST('/v1/contracts/{id}/signatures', { params: { path: { id: contract.id } }, body: { partyId: party.id, method: 'in_person_witnessed', evidenceFileId, geo: gps ? { type: 'Point', coordinates: gps } : null } }));
          await onSigned();
        })}
      >
        {t('signInPerson')}
      </Button>
    </div>
  );
}
