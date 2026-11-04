'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Alert, Card, CardBody, PageHeader } from '@/components/ui';
import { FarmerForm, toFarmerBody } from '@/components/farmers/farmer-form';

export default function NewFarmerPage() {
  const t = useTranslations();
  const { api } = useSession();
  const router = useRouter();
  const { busy, msg, run } = useAction();
  return (
    <>
      <PageHeader title={t('farmers.new')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <Card className="max-w-3xl">
        <CardBody>
          <FarmerForm
            submitLabel={t('common.save')}
            busy={busy === 'save'}
            onSubmit={(v) => void run('save', async () => {
              const f = await unwrap(api.POST('/v1/farmers', { body: toFarmerBody(v) as never }));
              router.push(`/app/farmers/${f.id}`);
            })}
          />
        </CardBody>
      </Card>
    </>
  );
}
