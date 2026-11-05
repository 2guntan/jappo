'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle } from 'lucide-react';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Meter, Spinner } from '@/components/ui';

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
          <CardBody className="flex flex-col items-center gap-3 py-8">
            <div
              className="flex size-32 items-center justify-center rounded-full p-[7px]"
              style={{ background: `conic-gradient(var(--color-brand-600) ${Math.max(0, Math.min(100, r.score))}%, var(--color-neutral-200) 0)` }}
              role="img"
              aria-label={`${t('readiness.score')} ${r.score}`}
            >
              <div className="flex size-full items-center justify-center rounded-full bg-white">
                <span className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="readiness-score">{r.score}</span>
              </div>
            </div>
            <p className="flex items-center gap-2 text-sm text-neutral-600">{t('readiness.grade')} <Badge tone={r.grade === 'A' ? 'green' : r.grade === 'D' ? 'red' : 'amber'} data-testid="readiness-grade">{r.grade}</Badge></p>
            {hasPermission('block:update') && (
              <Button size="sm" variant="secondary" loading={busy === 'check'} onClick={() => run('check', async () => { await unwrap(api.POST('/v1/blocks/{id}/actions/check-readiness', { params: { path: { id: season.blockId } }, body: { seasonId: season.id } })); await qc.invalidateQueries({ queryKey: ['block', season.blockId] }); await q.refetch(); })}>{t('readiness.check')}</Button>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t('readiness.breakdown')}</CardTitle></CardHeader>
          <CardBody className="space-y-3.5">
            {Object.entries(r.breakdown).map(([k, v]) => (
              <div key={k}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-neutral-700">{t(`readiness.components.${k}` as 'readiness.components.landSecurity')}</span>
                  <span className="text-neutral-500 tabular-nums">
                    <span className="font-medium text-neutral-900">{v}</span> {t('readiness.max', { max: MAX[k] ?? 0 })}
                  </span>
                </div>
                <Meter value={v} max={MAX[k] ?? 1} />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t('readiness.gates')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <ul className="divide-y divide-neutral-200/60" data-testid="gates">
            {r.gates.map((g) => (
              <li key={g.code} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="flex items-start gap-2.5">
                  {g.pass ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />}
                  <div>
                    <p className={g.pass ? 'text-neutral-700' : 'font-medium text-neutral-900'}>{t(`readiness.gateNames.${g.code}` as 'readiness.gateNames.G1_BOUNDARY')}</p>
                    {g.reasons.map((x) => <p key={x.code} className="font-mono text-[11px] text-neutral-500">{x.code}{x.entityIds.length ? ` (${x.entityIds.length})` : ''}</p>)}
                  </div>
                </div>
                {!g.pass && <Link className="shrink-0 text-brand-700 hover:underline" href={gateFixLink(g.code, season.blockId, season.id)}>{t('readiness.fix')}</Link>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
