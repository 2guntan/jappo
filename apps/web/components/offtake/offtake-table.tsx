'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Table, Td, Th } from '@/components/ui';

export function OfftakeTable({ rows, showBlock = true, showOperatorActions = true }: { rows: Schemas['OfftakeContract'][]; showBlock?: boolean; showOperatorActions?: boolean }) {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { msg, run } = useAction();
  const act = (c: Schemas['OfftakeContract'], action: 'mark-loi' | 'mark-signed' | 'terminate') =>
    run(action, async () => {
      const reason = action === 'terminate' ? window.prompt(t('seasons.reason')) ?? undefined : undefined;
      if (action === 'terminate' && !reason) return;
      const path = { params: { path: { id: c.id } }, headers: ifMatch(c.version), body: { reason } };
      if (action === 'mark-loi') await unwrap(api.POST('/v1/offtake-contracts/{id}/actions/mark-loi', path));
      else if (action === 'mark-signed') await unwrap(api.POST('/v1/offtake-contracts/{id}/actions/mark-signed', path));
      else await unwrap(api.POST('/v1/offtake-contracts/{id}/actions/terminate', path));
      await qc.invalidateQueries({ queryKey: ['offtake'] });
      await qc.invalidateQueries({ queryKey: ['plantings'] });
    });
  return (
    <>
      {msg && <Alert tone={msg.tone} className="m-3">{msg.text}</Alert>}
      <Table>
        <thead><tr><Th>Ref</Th>{showBlock && <Th>{t('offtake.block')}</Th>}<Th>{t('offtake.buyer')}</Th><Th>{t('seasons.crop')}</Th><Th>{t('offtake.minVolume')}</Th><Th>{t('offtake.price')}</Th><Th>{t('common.status')}</Th>{showOperatorActions && <Th />}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.ref}</Td>
              {showBlock && <Td>{c.blockName}</Td>}
              <Td>{c.buyerName}</Td>
              <Td>{c.cropCode}</Td>
              <Td>{c.minVolumeKg.toLocaleString('fr-SN')} – {c.maxVolumeKg.toLocaleString('fr-SN')}</Td>
              <Td>{formatXof(c.priceXofPerKg)} {c.paysIntoEscrow && <Badge tone="green">escrow</Badge>}</Td>
              <Td><Badge tone={c.status === 'signed' ? 'green' : c.status === 'loi' ? 'blue' : c.status === 'draft' ? 'neutral' : 'red'} data-testid={`offtake-status-${c.ref}`}>{t(`offtake.status.${c.status}`)}</Badge></Td>
              {showOperatorActions && (
                <Td className="space-x-1 whitespace-nowrap">
                  {c.allowedActions.includes('mark_loi') && <Button size="sm" variant="secondary" onClick={() => act(c, 'mark-loi')}>{t('offtake.markLoi')}</Button>}
                  {c.allowedActions.includes('mark_signed') && <Button size="sm" onClick={() => act(c, 'mark-signed')}>{t('offtake.markSigned')}</Button>}
                  {c.allowedActions.includes('terminate') && <Button size="sm" variant="ghost" onClick={() => act(c, 'terminate')}>{t('offtake.terminate')}</Button>}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
