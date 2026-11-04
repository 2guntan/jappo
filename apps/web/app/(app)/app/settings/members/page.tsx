'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { ROLES, roleAllowedFor, type Role } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';
import { downloadCsv, formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function MembersPage() {
  const t = useTranslations();
  const { api, activeOrgId, activeMembership } = useSession();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['members', activeOrgId], queryFn: () => unwrap(api.GET('/v1/orgs/current/members')) });
  const invites = useQuery({ queryKey: ['invitations', activeOrgId], queryFn: () => unwrap(api.GET('/v1/orgs/current/invitations')) });
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const orgType = activeMembership?.orgType ?? 'operator';
  const roleOptions = ROLES.filter((r) => roleAllowedFor(r, orgType) && !r.startsWith('platform_'));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['members'] }), qc.invalidateQueries({ queryKey: ['invitations'] })]);
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setMsg(null);
    try {
      await fn();
      if (success) setMsg({ tone: 'success', text: success });
      await refresh();
    } catch (e) {
      setMsg({ tone: 'error', text: problemMessage(e, t) });
    }
  };

  if (members.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader
        title={t('members.title')}
        actions={<Button variant="secondary" onClick={() => downloadCsv('members.csv', (members.data?.data ?? []).map((m) => ({ name: m.fullName, email: m.email, roles: m.roles.join(' '), status: m.status })))}>{t('common.exportCsv')}</Button>}
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('common.name')}</Th><Th>{t('common.roles')}</Th><Th>{t('members.lastLogin')}</Th><Th>{t('common.actions')}</Th></tr></thead>
              <tbody>
                {members.data?.data.map((m) => (
                  <tr key={m.userId}>
                    <Td><div className="font-medium">{m.fullName}</div><div className="text-xs text-neutral-500">{m.email ?? m.phone}</div></Td>
                    <Td><div className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r}>{t(`roles.${r}`)}</Badge>)}</div>{m.status === 'disabled' && <Badge tone="red" className="mt-1">{t('members.disable')}</Badge>}</Td>
                    <Td>{formatDateTime(m.lastLoginAt)}</Td>
                    <Td>
                      <Button size="sm" variant="ghost" onClick={() => act(() => unwrap(api.PATCH('/v1/orgs/current/members/{userId}', { params: { path: { userId: m.userId } }, body: { status: m.status === 'active' ? 'disabled' : 'active' } })))}>
                        {m.status === 'active' ? t('members.disable') : t('members.enable')}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('members.inviteTitle')}</CardTitle></CardHeader>
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                await act(async () => {
                  await unwrap(api.POST('/v1/orgs/current/invitations', { body: { email: email || undefined, phone: phone || undefined, roles } }));
                  setEmail('');
                  setPhone('');
                  setRoles([]);
                }, t('members.sent'));
                setBusy(false);
              }}
            >
              <Field label={t('common.email')} htmlFor="inv-email"><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label={t('common.phone')} htmlFor="inv-phone"><Input id="inv-phone" type="tel" placeholder="+221…" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              <fieldset>
                <legend className="text-sm font-medium">{t('common.roles')}</legend>
                <div className="mt-2 space-y-1">
                  {roleOptions.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
                      {t(`roles.${r}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" loading={busy} disabled={roles.length === 0 || (!email && !phone)}>{t('members.invite')}</Button>
            </form>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>{t('members.pendingInvites')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('common.email')}</Th><Th>{t('common.roles')}</Th><Th>{t('members.expires')}</Th><Th /></tr></thead>
            <tbody>
              {invites.data?.data.filter((i) => !i.acceptedAt).map((i) => (
                <tr key={i.id}>
                  <Td>{i.email ?? i.phone}</Td>
                  <Td>{i.roles.map((r) => t(`roles.${r}`)).join(', ')}</Td>
                  <Td>{formatDateTime(i.expiresAt)}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => act(() => unwrap(api.DELETE('/v1/orgs/current/invitations/{id}', { params: { path: { id: i.id } } })))}>{t('members.revoke')}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
