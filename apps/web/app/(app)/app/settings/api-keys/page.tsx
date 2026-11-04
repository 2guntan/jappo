'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { ROLES, roleAllowedFor, type Role } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Table, Td, Th } from '@/components/ui';

export default function ApiKeysPage() {
  const t = useTranslations();
  const { api, activeOrgId, activeMembership } = useSession();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys', activeOrgId], queryFn: () => unwrap(api.GET('/v1/orgs/current/api-keys')) });
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Role[]>(['viewer']);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opts = ROLES.filter((r) => roleAllowedFor(r, activeMembership?.orgType ?? 'operator') && !r.startsWith('platform_'));
  return (
    <>
      <PageHeader title={t('apiKeys.title')} />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {created && (
        <Alert tone="warning" className="mb-4">
          <p>{t('apiKeys.shownOnce')}</p>
          <code className="mt-2 block break-all rounded bg-white p-2" data-testid="new-api-key">{created}</code>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {keys.data?.data.length ? (
            <Card>
              <CardBody className="p-0">
                <Table>
                  <thead><tr><Th>{t('apiKeys.name')}</Th><Th>{t('apiKeys.prefix')}</Th><Th>{t('common.roles')}</Th><Th>{t('apiKeys.lastUsed')}</Th><Th /></tr></thead>
                  <tbody>
                    {keys.data.data.map((k) => (
                      <tr key={k.id}>
                        <Td>{k.name}</Td>
                        <Td><code>jpk_{k.prefix}_…</code></Td>
                        <Td>{k.roles.map((r) => t(`roles.${r}`)).join(', ')}</Td>
                        <Td>{formatDateTime(k.lastUsedAt)}</Td>
                        <Td>
                          {k.revokedAt ? (
                            <Badge tone="red">{t('apiKeys.revoked')}</Badge>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={async () => { await unwrap(api.DELETE('/v1/orgs/current/api-keys/{id}', { params: { path: { id: k.id } } })); await qc.invalidateQueries({ queryKey: ['api-keys'] }); }}>
                              {t('members.revoke')}
                            </Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
          ) : (
            <EmptyState title={t('apiKeys.title')} description={t('apiKeys.empty')} />
          )}
        </div>
        <Card>
          <CardHeader><CardTitle>{t('apiKeys.create')}</CardTitle></CardHeader>
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                try {
                  const k = await unwrap(api.POST('/v1/orgs/current/api-keys', { body: { name, roles } }));
                  setCreated(k.key);
                  setName('');
                  await qc.invalidateQueries({ queryKey: ['api-keys'] });
                } catch (err) {
                  setError(problemMessage(err, t));
                }
              }}
            >
              <Field label={t('apiKeys.name')} htmlFor="key-name"><Input id="key-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">{t('common.roles')}</legend>
                {opts.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
                    {t(`roles.${r}`)}
                  </label>
                ))}
              </fieldset>
              <Button type="submit" disabled={roles.length === 0}>{t('apiKeys.create')}</Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
