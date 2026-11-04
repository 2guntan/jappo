'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle } from 'lucide-react';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Spinner } from '@/components/ui';

const MAX: Record<string, number> = { landSecurity: 20, offtakeStrength: 20, financialRobustness: 20, farmerQuality: 10, riskCover: 15, operatorCapacity: 10, dataCompleteness: 5 };

/** Where to fix each gate (SPEC §9.2.1: "UI links to fix"). */
export function gateFixLink(code: string, blockId: string, seasonId: string): string {
  const map: Record<string, string> = {
    G1_BOUNDARY: `/app/blocks/${blockId}?tab=land`,
    G2_LAND_TITLE: `/app/blocks/${blockId}?tab=land`,
    G3_COMMUNITY: `/app/blocks/${blockId}?tab=land`,
    G4_FARMERS: `/app/blocks/${blockId}?tab=plots`,
    G5_PLAN: `/app/seasons/${seasonId}?tab=plan`,
    G6_OFFTAKE: `/app/blocks/${blockId}?tab=offtake`,
    G7_MODEL: `/app/seasons/${seasonId}?tab=model`,
    G8_HCR: `/app/seasons/${seasonId}?tab=model`,
    G9_OPERATOR_KYC: '/app/settings/organization',
    G10_ESCROW: `/app/blocks/${blockId}?tab=offtake`,
  };
  return map[code] ?? `/app/blocks/${blockId}`;
}

export function ReadinessTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const q = useQuery({ queryKey: ['readiness', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/readiness', { params: { path: { id: season.id } } })) });
  if (q.isLoading || !q.data) return <Spinner />;
  const r = q.data;
  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-8">
            <div className="flex size-28 items-center justify-center rounded-full border-8 border-brand-100" style={{ borderTopColor: '#23804a' }}>
              <span className="text-3xl font-bold" data-testid="readiness-score">{r.score}</span>
            </div>
            <p className="text-sm text-neutral-600">{t('readiness.grade')} <Badge tone={r.grade === 'A' ? 'green' : r.grade === 'D' ? 'red' : 'amber'} data-testid="readiness-grade">{r.grade}</Badge></p>
            {hasPermission('block:update') && (
              <Button size="sm" variant="secondary" loading={busy === 'check'} onClick={() => run('check', async () => { await unwrap(api.POST('/v1/blocks/{id}/actions/check-readiness', { params: { path: { id: season.blockId } }, body: { seasonId: season.id } })); await qc.invalidateQueries({ queryKey: ['block', season.blockId] }); await q.refetch(); })}>{t('readiness.check')}</Button>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t('readiness.breakdown')}</CardTitle></CardHeader>
          <CardBody className="space-y-2">
            {Object.entries(r.breakdown).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-sm"><span>{t(`readiness.components.${k}` as 'readiness.components.landSecurity')}</span><span>{v} {t('readiness.max', { max: MAX[k] ?? 0 })}</span></div>
                <div className="h-2 rounded bg-neutral-100"><div className="h-2 rounded bg-brand-600" style={{ width: `${Math.min(100, (v / (MAX[k] ?? 1)) * 100)}%` }} /></div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t('readiness.gates')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <ul className="divide-y divide-neutral-100" data-testid="gates">
            {r.gates.map((g) => (
              <li key={g.code} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="flex items-start gap-2">
                  {g.pass ? <CheckCircle2 className="mt-0.5 size-4 text-brand-600" /> : <XCircle className="mt-0.5 size-4 text-red-600" />}
                  <div>
                    <p className="font-medium">{t(`readiness.gateNames.${g.code}` as 'readiness.gateNames.G1_BOUNDARY')}</p>
                    {g.reasons.map((x) => <p key={x.code} className="text-xs text-neutral-500">{x.code}{x.entityIds.length ? ` (${x.entityIds.length})` : ''}</p>)}
                  </div>
                </div>
                {!g.pass && <Link className="text-brand-700 hover:underline" href={gateFixLink(g.code, season.blockId, season.id)}>{t('readiness.fix')}</Link>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
