import { describe, expect, it } from 'vitest';
import { notificationCodes, renderNotification } from '../src';
import fr from '../fr/notifications.json';
import en from '../en/notifications.json';

describe('notification templates', () => {
  it('fr and en define the same codes and fields', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    for (const code of notificationCodes()) {
      expect(Object.keys((en as Record<string, object>)[code]!).sort()).toEqual(Object.keys((fr as Record<string, object>)[code]!).sort());
    }
  });
  it('renders with fallback', () => {
    const r = renderNotification('auth.otp', 'wo', { code: '123456' });
    expect(r.sms).toContain('123456');
    expect(renderNotification('member.invited', 'en', { orgName: 'X', inviterName: 'Y', roles: 'viewer', link: 'L' }).subject).toBe('Jappo — invitation to join X');
    expect(() => renderNotification('nope', 'fr', {})).toThrow();
  });
});

describe('contract templates', async () => {
  const { CONTRACT_TEMPLATE_SEEDS, renderContractBody, renderContractHtml } = await import('../src');
  it('seeds six codes in fr and en and renders every one without leftover tags', () => {
    expect(CONTRACT_TEMPLATE_SEEDS).toHaveLength(12);
    for (const t of CONTRACT_TEMPLATE_SEEDS) {
      const html = renderContractBody(t.bodyHbs, { ref: 'CTR-2026-000001', block: { ref: 'BLK-2026-000001' }, lenders: [{ legalName: 'Banque <Test>', amountXof: 1000 }], schedule: [{ seq: 1, principalXof: 1, interestXof: 0, totalXof: 1 }], clauses: { disputeResolution: 'CCJA' } }, t.locale);
      expect(html).not.toMatch(/{{|}}/);
      if (t.code === 'block_framework') expect(html).toContain('Banque &lt;Test&gt;');
    }
  });
  it('wraps the body with a signature page and content hash', () => {
    const html = renderContractHtml({ ref: 'CTR-1', title: 'T', bodyHtml: '<p>x</p>', contentSha256: 'abc', status: 'signed', signatures: [{ roleLabel: 'Prêteur', partyName: 'L', signerName: 'A B', method: 'otp_email', signedAt: '2026-01-01 10:00', contentSha256: 'abc' }] }, 'fr');
    expect(html).toContain('Empreinte SHA-256 du contenu: abc');
    expect(html).toContain('A B');
    expect(html).not.toContain('PROJET');
  });
});
