'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { IRRIGATION_TYPES, TENURE_TYPES, WATER_SOURCES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Alert, Button, Card, CardBody, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';

type Form = { name: string; region: string; department: string; commune: string; village: string; waterSource: (typeof WATER_SOURCES)[number]; irrigationType: (typeof IRRIGATION_TYPES)[number]; tenureType: (typeof TENURE_TYPES)[number]; description: string };

export default function NewBlockPage() {
  const t = useTranslations();
  const { api } = useSession();
  const router = useRouter();
  const { busy, msg, run } = useAction();
  const { register, handleSubmit, formState } = useForm<Form>({ defaultValues: { waterSource: 'borehole', irrigationType: 'drip', tenureType: 'deliberation', region: 'Ziguinchor' } });
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  const submit = handleSubmit((v) =>
    run('create', async () => {
      const b = await unwrap(api.POST('/v1/blocks', { body: { ...v, department: nul(v.department), commune: nul(v.commune), village: nul(v.village), description: nul(v.description) } }));
      router.push(`/app/blocks/${b.id}?tab=land`);
    }),
  );
  return (
    <>
      <PageHeader title={t('blocks.new')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <Card className="max-w-2xl">
        <CardBody>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label={t('blocks.name')} htmlFor="name" error={formState.errors.name && t('errors.VALIDATION_FAILED')}><Input id="name" {...register('name', { required: true, minLength: 2 })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('blocks.region')} htmlFor="region"><Input id="region" {...register('region', { required: true })} /></Field>
              <Field label={t('blocks.department')} htmlFor="department"><Input id="department" {...register('department')} /></Field>
              <Field label={t('blocks.commune')} htmlFor="commune"><Input id="commune" {...register('commune')} /></Field>
              <Field label={t('blocks.village')} htmlFor="village"><Input id="village" {...register('village')} /></Field>
              <Field label={t('blocks.waterSource')} htmlFor="waterSource"><Select id="waterSource" {...register('waterSource')}>{WATER_SOURCES.map((w) => <option key={w} value={w}>{t(`enum.waterSource.${w}`)}</option>)}</Select></Field>
              <Field label={t('blocks.irrigationType')} htmlFor="irrigationType"><Select id="irrigationType" {...register('irrigationType')}>{IRRIGATION_TYPES.map((w) => <option key={w} value={w}>{t(`enum.irrigationType.${w}`)}</option>)}</Select></Field>
              <Field label={t('blocks.tenureType')} htmlFor="tenureType"><Select id="tenureType" {...register('tenureType')}>{TENURE_TYPES.map((w) => <option key={w} value={w}>{t(`enum.tenureType.${w}`)}</option>)}</Select></Field>
            </div>
            <Field label={t('blocks.description')} htmlFor="description"><Textarea id="description" {...register('description')} /></Field>
            <Button type="submit" loading={busy === 'create'}>{t('blocks.create')}</Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
