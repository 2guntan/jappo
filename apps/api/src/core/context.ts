import type { OrgType, Role } from '@jappo/contracts';

export type Principal =
  | { type: 'anonymous' }
  | { type: 'user'; userId: string; mfa: boolean; familyId?: string }
  | { type: 'api_key'; apiKeyId: string; orgId: string }
  | { type: 'farmer'; farmerId: string; orgId: string }
  | { type: 'system'; name: string };

/** Who is acting, in which organisation, with which permissions (SPEC §6). */
export interface ActorContext {
  principal: Principal;
  orgId: string | null;
  orgType: OrgType | null;
  roles: Role[];
  permissions: ReadonlySet<string>;
  mfaEnrolmentRequired: boolean;
  orgSuspended?: boolean;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const anonymousActor = (ip: string | null = null, requestId: string | null = null, userAgent: string | null = null): ActorContext => ({
  principal: { type: 'anonymous' },
  orgId: null,
  orgType: null,
  roles: [],
  permissions: new Set(),
  mfaEnrolmentRequired: false,
  ip,
  userAgent,
  requestId,
});

export const systemActor = (name = 'worker'): ActorContext => ({
  principal: { type: 'system', name },
  orgId: null,
  orgType: null,
  roles: [],
  permissions: new Set(['*']),
  mfaEnrolmentRequired: false,
  ip: null,
  userAgent: null,
  requestId: null,
});

export function principalId(a: ActorContext): string {
  const p = a.principal;
  switch (p.type) {
    case 'user':
      return p.userId;
    case 'api_key':
      return p.apiKeyId;
    case 'farmer':
      return p.farmerId;
    case 'system':
      return `system:${p.name}`;
    default:
      return 'anonymous';
  }
}

export const actorUserId = (a: ActorContext): string | null => (a.principal.type === 'user' ? a.principal.userId : null);

export function requireOrg(a: ActorContext): string {
  if (!a.orgId) throw new Error('active organisation required');
  return a.orgId;
}

export const isPlatformStaff = (a: ActorContext): boolean =>
  a.orgType === 'platform' && (a.roles.includes('platform_admin') || a.roles.includes('platform_support'));
