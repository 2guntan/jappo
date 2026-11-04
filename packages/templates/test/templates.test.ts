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
