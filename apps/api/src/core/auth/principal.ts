import { and, eq, isNull } from 'drizzle-orm';
import { MFA_REQUIRED_ROLES, roleAllowedFor, type OrgType, type Role } from '@jappo/contracts';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../../db/client';
import { apiKeys, memberships, organizations, users } from '../../modules/identity/schema';
import { anonymousActor, type ActorContext } from '../context';
import { forbidden, unauthorized } from '../errors';
import { permissionsFor } from '../authz/permissions';
import { verifyAccessToken } from './tokens';
import { sha256 } from '../crypto';
import { env } from '../../env';

export interface MembershipRow {
  orgId: string;
  orgType: OrgType;
  orgName: string;
  roles: Role[];
  kycStatus: string;
  orgStatus: string;
}

export async function loadMemberships(db: Db, userId: string): Promise<MembershipRow[]> {
  const rows = await db
    .select({
      orgId: memberships.orgId,
      roles: memberships.roles,
      orgType: organizations.type,
      orgName: organizations.legalName,
      kycStatus: organizations.kycStatus,
      orgStatus: organizations.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
  return rows.map((r) => ({ ...r, roles: (r.roles as Role[]).filter((role) => roleAllowedFor(role, r.orgType)) }));
}

export const needsMfaEnrolment = (ms: MembershipRow[], mfaEnabled: boolean): boolean =>
  env().MFA_ENFORCE && !mfaEnabled && ms.some((m) => m.roles.some((r) => MFA_REQUIRED_ROLES.includes(r)));

/** Resolve the request principal and active organisation (SPEC §5.2, §6.1). */
export async function resolveActor(db: Db, req: FastifyRequest): Promise<ActorContext> {
  const base = anonymousActor(req.ip, req.id, (req.headers['user-agent'] as string | undefined) ?? null);
  const authz = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];
  const orgHeader = typeof req.headers['x-org-id'] === 'string' ? req.headers['x-org-id'] : undefined;

  if (authz?.startsWith('ApiKey ') || typeof apiKeyHeader === 'string') {
    const key = authz?.startsWith('ApiKey ') ? authz.slice(7).trim() : String(apiKeyHeader);
    const m = /^jpk_([A-Za-z0-9]{8})_[A-Za-z0-9_-]{20,}$/.exec(key);
    if (!m) throw unauthorized('INVALID_API_KEY');
    const [row] = await db
      .select({ k: apiKeys, orgType: organizations.type, orgStatus: organizations.status })
      .from(apiKeys)
      .innerJoin(organizations, eq(organizations.id, apiKeys.orgId))
      .where(and(eq(apiKeys.prefix, m[1]!), isNull(apiKeys.revokedAt)));
    if (!row || row.k.keyHash !== sha256(key)) throw unauthorized('INVALID_API_KEY');
    if (row.orgStatus !== 'active') throw forbidden('ORG_SUSPENDED');
    const roles = (row.k.roles as Role[]).filter((r) => roleAllowedFor(r, row.orgType) && r !== 'platform_admin');
    void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.k.id)).catch(() => undefined);
    return { ...base, principal: { type: 'api_key', apiKeyId: row.k.id, orgId: row.k.orgId }, orgId: row.k.orgId, orgType: row.orgType, roles, permissions: permissionsFor(roles) };
  }

  if (!authz?.startsWith('Bearer ')) return base;
  const claims = await verifyAccessToken(authz.slice(7).trim());
  if (!claims) throw unauthorized('INVALID_TOKEN', 'Access token is invalid or expired');

  if (claims.typ === 'farmer') {
    if (!claims.org) throw unauthorized('INVALID_TOKEN');
    return { ...base, principal: { type: 'farmer', farmerId: claims.sub, orgId: claims.org }, orgId: claims.org, orgType: 'operator', permissions: new Set(['farmer:self']) };
  }

  const [user] = await db.select({ status: users.status, mfaEnabledAt: users.mfaEnabledAt }).from(users).where(eq(users.id, claims.sub));
  if (!user || user.status !== 'active') throw unauthorized('USER_DISABLED');
  const ms = await loadMemberships(db, claims.sub);
  const mfaEnrolmentRequired = needsMfaEnrolment(ms, user.mfaEnabledAt !== null);
  let active: MembershipRow | undefined;
  if (orgHeader) {
    active = ms.find((m) => m.orgId === orgHeader);
    if (!active) throw forbidden('NOT_A_MEMBER', 'You are not a member of the organisation in X-Org-Id');
  } else if (ms.length === 1) {
    active = ms[0];
  }
  const roles = active?.roles ?? [];
  return {
    ...base,
    principal: { type: 'user', userId: claims.sub, mfa: claims.mfa, familyId: claims.fam },
    orgId: active?.orgId ?? null,
    orgType: active?.orgType ?? null,
    roles,
    permissions: permissionsFor(roles),
    mfaEnrolmentRequired,
    orgSuspended: active?.orgStatus === 'suspended',
  };
}
