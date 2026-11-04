'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';
import { InPersonSign, OtpSign } from '@/components/contracts/sign-panel';

/** Field PWA: plot contracts awaiting a farmer signature (online only — the content hash is fixed server side). */
export function SignContractsScreen() {
  const t = useTranslations('field');
  const { api } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['field-contracts'],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        unwrap(api.GET('/v1/contracts', { params: { query: { type: 'plot_production', status: 'out_for_signature' } } })),
        unwrap(api.GET('/v1/contracts', { params: { query: { type: 'plot_production', status: 'partially_signed' } } })),
      ]);
      return [...a.data, ...b.data].filter((c) => c.parties.some((p) => p.partyType === 'farmer' && p.canSign));
    },
  });
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['field-contracts'] });
  if (!rows.length) return <p className="text-sm text-neutral-600" data-testid="no-contracts-to-sign">{t('noContractsToSign')}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((c) => {
        const p = c.parties.find((x) => x.partyType === 'farmer' && x.canSign)!;
        return (
          <li key={c.id} className="space-y-3 rounded-lg border border-neutral-200 p-4" data-testid={`field-contract-${c.ref}`}>
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-neutral-500">{c.ref} · {c.title} · {c.blockRef}</p>
            </div>
            <InPersonSign contract={c} party={p} onSigned={refresh} />
            <OtpSign contract={c} party={p} onSigned={refresh} />
          </li>
        );
      })}
    </ul>
  );
}
