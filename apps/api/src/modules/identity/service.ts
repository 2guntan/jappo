import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { roleAllowedFor, type OrgType, type Role, type SignupBody } from '@jappo/contracts';
import { orgKycMachine, transition, allowedActions } from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { newId } from '../../db/columns';
import { apiKeys, invitations, memberships, organizations, orgKycDocuments, otpCodes, refreshTokens, userTokens, users } from './schema';
import { files } from '../../core/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { notify, notifyOrgRoles } from '../../core/notify';
import { badRequest, conflict, forbidden, notFound, tooMany, unauthorized, unprocessable } from '../../core/errors';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../../core/auth/passwords';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, signAccessToken } from '../../core/auth/tokens';
import { newTotpSecret, totpUrl, verifyTotp } from '../../core/auth/totp';
import { decryptPii, encryptPii, randomDigits, randomToken, safeEqual, sha256 } from '../../core/crypto';
import { loadMemberships, needsMfaEnrolment } from '../../core/auth/principal';
import { hasPermission } from '../../core/authz/permissions';
import { env } from '../../env';
import { assertVersion } from '../../core/etag';

export type OrgRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;

const RT_COOKIE = 'jappo_rt';
const CSRF_COOKIE = 'jappo_csrf';
const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

/** Business role granted to the signup user in addition to org_admin (DECISIONS D-010). */
const SIGNUP_ROLES: Record<string, Role[]> = {
  operator: ['org_admin', 'operator_manager'],
  lender: ['org_admin', 'credit_officer'],
  buyer: ['org_admin', 'buyer_rep'],
  guarantor: ['org_admin', 'credit_officer'],
  insurer: ['org_admin', 'credit_officer'],
  supplier: ['org_admin'],
};

/** KYC documents required before an org can submit KYC (DECISIONS D-011). */
export const REQUIRED_KYC_DOCS: Record<OrgType, string[]> = {
  platform: [],
  operator: ['ninea', 'rccm'],
  lender: ['ninea', 'rccm', 'approval_bceao'],
  buyer: ['ninea', 'rccm'],
  guarantor: ['ninea', 'rccm'],
  insurer: ['ninea', 'rccm'],
  supplier: ['ninea', 'rccm'],
  farmer_group: ['ninea'],
};

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword('timing-equaliser-password'));

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function orgDto(o: OrgRow, actor?: ActorContext) {
  const actions: string[] = [];
  if (actor && actor.orgId === o.id && hasPermission(actor.permissions, 'org:update')) {
    actions.push('update');
    if (allowedActions(orgKycMachine, o.kycStatus).includes('submit') && o.kycStatus !== 'verified') actions.push('submit_kyc');
  }
  if (actor && hasPermission(actor.permissions, 'admin:kyc_review') && o.kycStatus !== 'verified') actions.push('verify_kyc', 'reject_kyc');
  return {
    id: o.id,
    type: o.type,
    legalName: o.legalName,
    tradeName: o.tradeName,
    legalForm: o.legalForm,
    ninea: o.ninea,
    rccm: o.rccm,
    country: o.country,
    region: o.region,
    address: o.address,
    phone: o.phone,
    email: o.email,
    logoFileId: o.logoFileId,
    locale: (o.locale === 'en' ? 'en' : 'fr') as 'fr' | 'en',
    kycStatus: o.kycStatus,
    status: o.status,
    lenderKind: o.lenderKind,
    bceaoApprovalNo: o.bceaoApprovalNo,
    annualVolumeKgEstimate: o.annualVolumeKgEstimate === null ? null : Number(o.annualVolumeKgEstimate),
    yearsInBusiness: o.yearsInBusiness,
    version: o.version,
    createdAt: o.createdAt.toISOString(),
    allowedActions: actions,
  };
}

// ---------------------------------------------------------------- sessions

interface SessionOpts {
  mfa: boolean;
  familyId?: string;
  req: FastifyRequest;
  reply: FastifyReply;
}

/** Issue access + rotating refresh token (cookie) + CSRF double-submit cookie. */
export async function issueSession(db: DbOrTx, userId: string, o: SessionOpts) {
  const familyId = o.familyId ?? newId();
  const raw = randomToken(32);
  const [rt] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: sha256(raw),
      familyId,
      mfa: o.mfa,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
      userAgent: (o.req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
      ip: o.req.ip,
    })
    .returning({ id: refreshTokens.id });
  const ms = await loadMemberships(db as Db, userId);
  const [u] = await db.select({ mfaEnabledAt: users.mfaEnabledAt }).from(users).where(eq(users.id, userId));
  const accessToken = await signAccessToken({ sub: userId, typ: 'user', mfa: o.mfa, fam: familyId, orgs: ms.map((m) => m.orgId) });
  const csrf = randomToken(18);
  const secure = env().COOKIE_SECURE;
  o.reply.setCookie(RT_COOKIE, raw, { httpOnly: true, secure, sameSite: 'strict', path: '/v1/auth', maxAge: REFRESH_TTL_DAYS * 86400 });
  o.reply.setCookie(CSRF_COOKIE, csrf, { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: REFRESH_TTL_DAYS * 86400 });
  return {
    refreshTokenId: rt!.id,
    response: {
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      tokenType: 'Bearer' as const,
      mfaEnrolmentRequired: needsMfaEnrolment(ms, (u?.mfaEnabledAt ?? null) !== null),
      csrfToken: csrf,
    },
  };
}

function assertCsrf(req: FastifyRequest) {
  const cookie = req.cookies[CSRF_COOKIE];
  const header = req.headers['x-csrf-token'];
  if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) throw forbidden('CSRF_FAILED', 'Missing or invalid CSRF token');
}

/** Rotate refresh token; reuse of a revoked token revokes the whole family (SPEC §10.1). */
export async function refreshSession(db: Db, req: FastifyRequest, reply: FastifyReply) {
  assertCsrf(req);
  const raw = req.cookies[RT_COOKIE];
  if (!raw) throw unauthorized('REFRESH_TOKEN_MISSING');
  const result = await db.transaction(async (tx) => {
    const [rt] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).for('update');
    if (!rt) return { error: 'REFRESH_TOKEN_INVALID' as const };
    if (rt.revokedAt) {
      // Reuse of a rotated token: revoke the whole family (committed, then reject).
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, rt.familyId), isNull(refreshTokens.revokedAt)));
      await audit(tx, { ...req.actor, principal: { type: 'user', userId: rt.userId, mfa: false } }, { action: 'auth.refresh_reuse_detected', resourceType: 'user', resourceId: rt.userId });
      return { error: 'REFRESH_TOKEN_REUSED' as const };
    }
    if (rt.expiresAt < new Date()) return { error: 'REFRESH_TOKEN_EXPIRED' as const };
    const [u] = await tx.select().from(users).where(eq(users.id, rt.userId));
    if (!u || u.status !== 'active') return { error: 'USER_DISABLED' as const };
    const s = await issueSession(tx, rt.userId, { mfa: rt.mfa, familyId: rt.familyId, req, reply });
    await tx.update(refreshTokens).set({ revokedAt: new Date(), replacedById: s.refreshTokenId }).where(eq(refreshTokens.id, rt.id));
    return { response: s.response };
  });
  if ('error' in result) {
    throw unauthorized(result.error, result.error === 'REFRESH_TOKEN_REUSED' ? 'Session revoked: refresh token reuse detected' : undefined);
  }
  return result.response;
}

export async function logout(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const raw = req.cookies[RT_COOKIE];
  if (raw) {
    assertCsrf(req);
    const [rt] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw)));
    if (rt) await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, rt.familyId), isNull(refreshTokens.revokedAt)));
  }
  reply.clearCookie(RT_COOKIE, { path: '/v1/auth' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

// ---------------------------------------------------------------- signup & email

async function createUserToken(tx: DbOrTx, userId: string, purpose: string, ttlMs: number): Promise<string> {
  const raw = randomToken(32);
  await tx.insert(userTokens).values({ userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) });
  return raw;
}

async function consumeUserToken(tx: DbOrTx, raw: string, purpose: string): Promise<string> {
  const [t] = await tx
    .update(userTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(userTokens.tokenHash, sha256(raw)), eq(userTokens.purpose, purpose), isNull(userTokens.consumedAt), gt(userTokens.expiresAt, new Date())))
    .returning({ userId: userTokens.userId });
  if (!t) throw badRequest('TOKEN_INVALID', 'Link is invalid or expired');
  return t.userId;
}

export async function signup(db: Db, actor: ActorContext, body: SignupBody, req: FastifyRequest, reply: FastifyReply) {
  assertPasswordPolicy(body.password);
  if (body.orgType === 'lender' && !body.lenderKind) {
    throw badRequest('VALIDATION_FAILED', 'lenderKind is required for lenders', [{ path: 'body.lenderKind', message: 'required' }]);
  }
  const passwordHash = await hashPassword(body.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (existing) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    const [org] = await tx
      .insert(organizations)
      .values({
        type: body.orgType,
        legalName: body.legalName,
        tradeName: body.tradeName ?? null,
        legalForm: body.legalForm,
        ninea: body.ninea ?? null,
        rccm: body.rccm ?? null,
        region: body.region ?? null,
        phone: body.phone ?? null,
        email: body.email,
        locale: body.locale,
        lenderKind: body.orgType === 'lender' ? (body.lenderKind ?? null) : null,
      })
      .returning();
    const [user] = await tx
      .insert(users)
      .values({ email: body.email, fullName: body.fullName, passwordHash, locale: body.locale, status: 'active' })
      .returning();
    await tx.insert(memberships).values({ userId: user!.id, orgId: org!.id, roles: SIGNUP_ROLES[body.orgType] ?? ['org_admin'] });
    const a: ActorContext = { ...actor, principal: { type: 'user', userId: user!.id, mfa: false }, orgId: org!.id, orgType: org!.type };
    await audit(tx, a, { action: 'org.signup', resourceType: 'organization', resourceId: org!.id, after: { type: org!.type, legalName: org!.legalName } });
    await emit(tx, a, 'org.created', { type: 'organization', id: org!.id }, { type: org!.type });
    const token = await createUserToken(tx, user!.id, 'email_verify', 48 * 3600_000);
    await notify(tx, {
      recipientType: 'user',
      recipientId: user!.id,
      orgId: org!.id,
      channels: ['email'],
      templateCode: 'auth.verify_email',
      locale: body.locale,
      email: body.email,
      data: { fullName: body.fullName, link: `${env().API_PUBLIC_URL}/verify-email?token=${token}` },
    });
    const s = await issueSession(tx, user!.id, { mfa: false, req, reply });
    return s.response;
  });
}

export async function verifyEmail(db: Db, actor: ActorContext, token: string) {
  await db.transaction(async (tx) => {
    const userId = await consumeUserToken(tx, token, 'email_verify');
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
    await audit(tx, actor, { action: 'user.email_verified', resourceType: 'user', resourceId: userId });
  });
}

// ---------------------------------------------------------------- login

export async function login(db: Db, actor: ActorContext, body: { email: string; password: string; totp?: string }, req: FastifyRequest, reply: FastifyReply) {
  const [u] = await db.select().from(users).where(eq(users.email, body.email));
  if (!u || !u.passwordHash || u.status !== 'active') {
    await verifyPassword(await dummyHash(), body.password); // equalise timing
    throw unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) throw tooMany('ACCOUNT_LOCKED', `Too many failed attempts. Try again after ${u.lockedUntil.toISOString()}`);
  const fail = async (code: string, msg: string) => {
    const count = u.failedLoginCount + 1;
    await db
      .update(users)
      .set({ failedLoginCount: count >= LOCK_AFTER ? 0 : count, lockedUntil: count >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
      .where(eq(users.id, u.id));
    await db.transaction((tx) => audit(tx, { ...actor, principal: { type: 'user', userId: u.id, mfa: false } }, { action: 'auth.login_failed', resourceType: 'user', resourceId: u.id, after: { code } }));
    throw unauthorized(code, msg);
  };
  if (!(await verifyPassword(u.passwordHash, body.password))) return fail('INVALID_CREDENTIALS', 'Email or password is incorrect');
  let mfa = false;
  if (u.mfaEnabledAt && u.mfaTotpSecret) {
    if (!body.totp) throw unauthorized('MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app');
    if (!verifyTotp(decryptPii(u.mfaTotpSecret), body.totp)) return fail('MFA_INVALID', 'Invalid authentication code');
    mfa = true;
  }
  return db.transaction(async (tx) => {
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
    await audit(tx, { ...actor, principal: { type: 'user', userId: u.id, mfa } }, { action: 'auth.login', resourceType: 'user', resourceId: u.id });
    return (await issueSession(tx, u.id, { mfa, req, reply })).response;
  });
}

// ---------------------------------------------------------------- phone OTP

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_WINDOW_MS = 10 * 60_000;
const OTP_MAX_PER_WINDOW = 3;

/** Create and send an OTP; limited to 3 per 10 minutes per phone and purpose (SPEC §18.1). */
export async function createOtp(
  tx: DbOrTx,
  phone: string,
  purpose: 'login' | 'farmer_login' | 'signature' | 'wallet_verify' | 'delivery_ack',
  locale: string,
  recipient: { type: 'user' | 'farmer' | 'address'; id: string; orgId?: string | null },
  subjectId: string | null = null,
): Promise<void> {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose), gt(otpCodes.createdAt, new Date(Date.now() - OTP_WINDOW_MS))));
  if (n >= OTP_MAX_PER_WINDOW) throw tooMany('OTP_RATE_LIMITED', 'Too many codes requested. Try again in 10 minutes.');
  const code = randomDigits(6);
  await tx.insert(otpCodes).values({ phone, purpose, subjectId, codeHash: sha256(`${phone}:${purpose}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
  await notify(tx, { recipientType: recipient.type, recipientId: recipient.id, orgId: recipient.orgId, channels: ['sms'], templateCode: 'auth.otp', locale, phone, data: { code } });
}

/** Verify the latest unconsumed OTP; max 5 attempts each. */
export async function consumeOtp(db: Db, phone: string, purpose: 'login' | 'farmer_login' | 'signature' | 'wallet_verify' | 'delivery_ack', code: string, subjectId: string | null = null): Promise<void> {
  const ok = await db.transaction(async (tx) => {
    const conds = [eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, new Date())];
    if (subjectId) conds.push(eq(otpCodes.subjectId, subjectId));
    const [otp] = await tx.select().from(otpCodes).where(and(...conds)).orderBy(desc(otpCodes.createdAt)).limit(1).for('update');
    if (!otp) return 'expired' as const;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) return 'locked' as const;
    if (!safeEqual(otp.codeHash, sha256(`${phone}:${purpose}:${code}`))) {
      await tx.update(otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
      return 'invalid' as const;
    }
    await tx.update(otpCodes).set({ consumedAt: new Date(), attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
    return 'ok' as const;
  });
  if (ok === 'expired') throw unauthorized('OTP_EXPIRED', 'Code expired or not found. Request a new code.');
  if (ok === 'locked') throw tooMany('OTP_LOCKED', 'Too many attempts. Request a new code.');
  if (ok === 'invalid') throw unauthorized('OTP_INVALID', 'Incorrect code');
}

export async function requestLoginOtp(db: Db, phone: string) {
  const [u] = await db.select().from(users).where(and(eq(users.phone, phone), eq(users.status, 'active')));
  if (!u) return; // do not reveal whether the phone exists
  await db.transaction((tx) => createOtp(tx, phone, 'login', u.locale, { type: 'user', id: u.id }));
}

export async function verifyLoginOtp(db: Db, actor: ActorContext, phone: string, code: string, req: FastifyRequest, reply: FastifyReply) {
  const [u] = await db.select().from(users).where(and(eq(users.phone, phone), eq(users.status, 'active')));
  if (!u) throw unauthorized('OTP_INVALID', 'Incorrect code');
  await consumeOtp(db, phone, 'login', code);
  // Phone OTP is a single factor: users with MFA must use password + TOTP.
  if (u.mfaEnabledAt) throw unauthorized('MFA_REQUIRED', 'This account requires password and authenticator login');
  return db.transaction(async (tx) => {
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    await audit(tx, { ...actor, principal: { type: 'user', userId: u.id, mfa: false } }, { action: 'auth.login_otp', resourceType: 'user', resourceId: u.id });
    return (await issueSession(tx, u.id, { mfa: false, req, reply })).response;
  });
}

// ---------------------------------------------------------------- password reset

export async function forgotPassword(db: Db, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || u.status !== 'active') return;
  await db.transaction(async (tx) => {
    const token = await createUserToken(tx, u.id, 'password_reset', 3600_000);
    await notify(tx, {
      recipientType: 'user',
      recipientId: u.id,
      channels: ['email'],
      templateCode: 'auth.password_reset',
      locale: u.locale,
      email: u.email,
      data: { fullName: u.fullName, link: `${env().API_PUBLIC_URL}/reset-password?token=${token}` },
    });
  });
}

export async function resetPassword(db: Db, actor: ActorContext, token: string, password: string) {
  assertPasswordPolicy(password);
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const userId = await consumeUserToken(tx, token, 'password_reset');
    await tx.update(users).set({ passwordHash: hash, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    await audit(tx, { ...actor, principal: { type: 'user', userId, mfa: false } }, { action: 'auth.password_reset', resourceType: 'user', resourceId: userId });
  });
}

// ---------------------------------------------------------------- MFA

export async function mfaEnroll(db: Db, actor: ActorContext) {
  const userId = actorUserId(actor);
  if (!userId) throw forbidden('USER_REQUIRED');
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw notFound('User');
  if (u.mfaEnabledAt) throw conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
  const secret = newTotpSecret();
  await db.update(users).set({ mfaTotpSecret: encryptPii(secret) }).where(eq(users.id, userId));
  return { secret, otpauthUrl: totpUrl(secret, u.email ?? u.phone ?? u.id) };
}

export async function mfaActivate(db: Db, actor: ActorContext, code: string, req: FastifyRequest, reply: FastifyReply) {
  const userId = actorUserId(actor);
  if (!userId) throw forbidden('USER_REQUIRED');
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.mfaTotpSecret) throw badRequest('MFA_NOT_ENROLLED', 'Start enrolment first');
  if (u.mfaEnabledAt) throw conflict('MFA_ALREADY_ENABLED');
  if (!verifyTotp(decryptPii(u.mfaTotpSecret), code)) throw unauthorized('MFA_INVALID', 'Invalid authentication code');
  return db.transaction(async (tx) => {
    await tx.update(users).set({ mfaEnabledAt: new Date() }).where(eq(users.id, userId));
    await audit(tx, actor, { action: 'user.mfa_enabled', resourceType: 'user', resourceId: userId });
    return (await issueSession(tx, userId, { mfa: true, req, reply })).response;
  });
}

// ---------------------------------------------------------------- me

export async function me(db: Db, actor: ActorContext) {
  const userId = actorUserId(actor);
  let user = null;
  let ms: Awaited<ReturnType<typeof loadMemberships>> = [];
  if (userId) {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound('User');
    user = {
      id: u.id,
      email: u.email,
      phone: u.phone,
      fullName: u.fullName,
      locale: (u.locale === 'en' ? 'en' : 'fr') as 'fr' | 'en',
      emailVerified: u.emailVerifiedAt !== null,
      mfaEnabled: u.mfaEnabledAt !== null,
    };
    ms = await loadMemberships(db, userId);
  }
  return {
    principalType: actor.principal.type === 'api_key' ? ('api_key' as const) : ('user' as const),
    user,
    memberships: ms.map((m) => ({ orgId: m.orgId, orgType: m.orgType, orgName: m.orgName, roles: m.roles, kycStatus: m.kycStatus as 'pending' })),
    activeOrgId: actor.orgId,
    roles: actor.roles,
    permissions: [...actor.permissions].sort(),
    mfaEnrolmentRequired: actor.mfaEnrolmentRequired,
  };
}

// ---------------------------------------------------------------- organisation

export async function getOrg(db: DbOrTx, id: string): Promise<OrgRow> {
  const [o] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!o) throw notFound('Organisation');
  return o;
}

export async function updateCurrentOrg(db: Db, actor: ActorContext, expectedVersion: number, patch: Record<string, unknown>) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const before = await getOrg(tx, orgId);
    assertVersion(expectedVersion, before.version);
    if (before.kycStatus === 'verified' && ('legalName' in patch || 'ninea' in patch || 'rccm' in patch || 'legalForm' in patch)) {
      throw unprocessable('KYC_LOCKED_FIELDS', 'Legal identity fields cannot change after KYC verification; contact support');
    }
    const values: Partial<typeof organizations.$inferInsert> = { ...(patch as Partial<typeof organizations.$inferInsert>), version: before.version + 1 };
    if ('annualVolumeKgEstimate' in patch) values.annualVolumeKgEstimate = patch.annualVolumeKgEstimate === null ? null : String(patch.annualVolumeKgEstimate);
    const [after] = await tx.update(organizations).set(values).where(and(eq(organizations.id, orgId), eq(organizations.version, before.version))).returning();
    if (!after) throw conflict('VERSION_CONFLICT');
    await audit(tx, actor, { action: 'org.updated', resourceType: 'organization', resourceId: orgId, before: orgDto(before), after: orgDto(after) });
    await emit(tx, actor, 'org.updated', { type: 'organization', id: orgId }, {});
    return after;
  });
}

export async function listKycDocs(db: DbOrTx, orgId: string) {
  const rows = await db
    .select({ d: orgKycDocuments, filename: files.filename })
    .from(orgKycDocuments)
    .innerJoin(files, eq(files.id, orgKycDocuments.fileId))
    .where(eq(orgKycDocuments.orgId, orgId))
    .orderBy(desc(orgKycDocuments.id));
  return rows.map(({ d, filename }) => ({
    id: d.id,
    orgId: d.orgId,
    docType: d.docType,
    fileId: d.fileId,
    filename,
    status: d.status,
    reviewedAt: iso(d.reviewedAt),
    comment: d.comment,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function addKycDoc(tx: DbOrTx, actor: ActorContext, docType: string, fileId: string) {
  const orgId = requireOrg(actor);
  const org = await getOrg(tx, orgId);
  if (org.kycStatus === 'verified') throw unprocessable('KYC_ALREADY_VERIFIED', 'KYC is already verified');
  const [d] = await tx
    .insert(orgKycDocuments)
    .values({ orgId, docType: docType as 'ninea', fileId, createdBy: actorUserId(actor) })
    .returning();
  await audit(tx, actor, { action: 'org.kyc_document_added', resourceType: 'org_kyc_document', resourceId: d!.id, after: { docType } });
  return d!;
}

export async function submitKyc(db: Db, actor: ActorContext) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const org = await getOrg(tx, orgId);
    const docs = await tx.select().from(orgKycDocuments).where(and(eq(orgKycDocuments.orgId, orgId), inArray(orgKycDocuments.status, ['submitted', 'verified'])));
    const have = new Set(docs.map((d) => d.docType));
    const missing = REQUIRED_KYC_DOCS[org.type].filter((t) => !have.has(t as 'ninea'));
    if (missing.length) {
      throw unprocessable('KYC_DOCUMENTS_MISSING', `Missing documents: ${missing.join(', ')}`, missing.map((m) => ({ path: 'docType', message: m, code: 'missing' })));
    }
    const next = transition(orgKycMachine, org.kycStatus, 'submit');
    const [after] = await tx.update(organizations).set({ kycStatus: next, version: org.version + 1 }).where(eq(organizations.id, orgId)).returning();
    await audit(tx, actor, { action: 'org.kyc_submitted', resourceType: 'organization', resourceId: orgId, before: { kycStatus: org.kycStatus }, after: { kycStatus: next } });
    await emit(tx, actor, 'org.kyc_submitted', { type: 'organization', id: orgId }, {});
    const [platform] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.type, 'platform'));
    if (platform) {
      await notifyOrgRoles(tx, platform.id, ['platform_admin'], {
        channels: ['in_app', 'email'],
        templateCode: 'org.kyc_submitted',
        data: { orgName: org.legalName, link: `${env().API_PUBLIC_URL}/admin/kyc/${orgId}` },
        link: `/admin/kyc/${orgId}`,
      });
    }
    return after!;
  });
}

export async function reviewKyc(db: Db, actor: ActorContext, orgId: string, decision: 'verify' | 'reject', comment?: string) {
  if (decision === 'reject' && !comment) throw badRequest('COMMENT_REQUIRED', 'A reason is required to reject', [{ path: 'body.comment', message: 'required' }]);
  return db.transaction(async (tx) => {
    const org = await getOrg(tx, orgId);
    if (org.type === 'platform') throw notFound('Organisation');
    const next = transition(orgKycMachine, org.kycStatus, decision);
    const [after] = await tx.update(organizations).set({ kycStatus: next, version: org.version + 1 }).where(eq(organizations.id, orgId)).returning();
    await tx
      .update(orgKycDocuments)
      .set({ status: decision === 'verify' ? 'verified' : 'rejected', reviewedBy: actorUserId(actor), reviewedAt: new Date(), comment: comment ?? null })
      .where(and(eq(orgKycDocuments.orgId, orgId), eq(orgKycDocuments.status, 'submitted')));
    await audit(tx, actor, { action: `org.kyc_${decision === 'verify' ? 'verified' : 'rejected'}`, resourceType: 'organization', resourceId: orgId, before: { kycStatus: org.kycStatus }, after: { kycStatus: next, comment } });
    await emit(tx, actor, decision === 'verify' ? 'org.kyc_verified' : 'org.kyc_rejected', { type: 'organization', id: orgId }, { comment: comment ?? null }, orgId);
    await notifyOrgRoles(tx, orgId, ['org_admin'], {
      channels: ['in_app', 'email'],
      templateCode: decision === 'verify' ? 'org.kyc_verified' : 'org.kyc_rejected',
      data: { orgName: org.legalName, comment: comment ?? '', link: `${env().API_PUBLIC_URL}/app/settings/organization` },
      link: '/app/settings/organization',
    });
    return after!;
  });
}

// ---------------------------------------------------------------- members & invitations

export async function listMembers(db: DbOrTx, orgId: string) {
  const rows = await db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(users.fullName);
  return rows.map(({ m, u }) => ({
    userId: u.id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    roles: m.roles as Role[],
    status: (m.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
    lastLoginAt: iso(u.lastLoginAt),
  }));
}

function assertRolesForOrg(roles: Role[], orgType: OrgType) {
  const bad = roles.filter((r) => !roleAllowedFor(r, orgType));
  if (bad.length) throw unprocessable('ROLE_NOT_ALLOWED', `Roles not allowed for ${orgType}: ${bad.join(', ')}`);
}

export async function updateMember(db: Db, actor: ActorContext, userId: string, patch: { roles?: Role[]; status?: 'active' | 'disabled' }) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const org = await getOrg(tx, orgId);
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))).for('update');
    if (!m) throw notFound('Member');
    if (patch.roles) assertRolesForOrg(patch.roles, org.type);
    const newRoles = patch.roles ?? (m.roles as Role[]);
    const newStatus = patch.status ?? m.status;
    const losesAdmin = (m.roles as Role[]).includes('org_admin') && (!newRoles.includes('org_admin') || newStatus !== 'active');
    if (losesAdmin) {
      const admins = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.status, 'active'), sql`'org_admin' = any(${memberships.roles})`));
      if (admins.length <= 1) throw unprocessable('LAST_ADMIN', 'An organisation must keep at least one active org_admin');
    }
    await tx.update(memberships).set({ roles: newRoles, status: newStatus, version: m.version + 1 }).where(eq(memberships.id, m.id));
    await audit(tx, actor, { action: 'member.updated', resourceType: 'membership', resourceId: m.id, before: { roles: m.roles, status: m.status }, after: { roles: newRoles, status: newStatus } });
    return (await listMembers(tx, orgId)).find((x) => x.userId === userId)!;
  });
}

const invitationDto = (i: typeof invitations.$inferSelect) => ({
  id: i.id,
  orgId: i.orgId,
  email: i.email,
  phone: i.phone,
  roles: i.roles as Role[],
  expiresAt: i.expiresAt.toISOString(),
  acceptedAt: iso(i.acceptedAt),
  createdAt: i.createdAt.toISOString(),
});

export async function listInvitations(db: DbOrTx, orgId: string) {
  const rows = await db.select().from(invitations).where(and(eq(invitations.orgId, orgId), isNull(invitations.revokedAt))).orderBy(desc(invitations.id));
  return rows.map(invitationDto);
}

export async function createInvitation(db: Db, actor: ActorContext, body: { email?: string; phone?: string; roles: Role[] }) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const org = await getOrg(tx, orgId);
    assertRolesForOrg(body.roles, org.type);
    if (body.roles.includes('platform_admin') && !actor.roles.includes('platform_admin')) throw forbidden('FORBIDDEN', 'Only platform admins can grant platform_admin');
    if (body.email) {
      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, orgId), eq(users.email, body.email)));
      if (existing) throw conflict('ALREADY_MEMBER', 'This person is already a member');
    }
    const raw = randomToken(32);
    const [inv] = await tx
      .insert(invitations)
      .values({ orgId, email: body.email ?? null, phone: body.phone ?? null, roles: body.roles, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 7 * 86400_000), createdBy: actorUserId(actor) })
      .returning();
    const [inviter] = actorUserId(actor) ? await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, actorUserId(actor)!)) : [];
    await notify(tx, {
      recipientType: 'address',
      recipientId: inv!.id,
      orgId,
      channels: body.email ? ['email'] : ['sms'],
      templateCode: 'member.invited',
      locale: org.locale,
      email: body.email,
      phone: body.phone,
      data: { orgName: org.legalName, inviterName: inviter?.fullName ?? org.legalName, roles: body.roles.join(', '), link: `${env().API_PUBLIC_URL}/invite?token=${raw}` },
    });
    await audit(tx, actor, { action: 'invitation.created', resourceType: 'invitation', resourceId: inv!.id, after: { email: body.email, phone: body.phone, roles: body.roles } });
    return { invitation: invitationDto(inv!), token: raw };
  });
}

export async function revokeInvitation(db: Db, actor: ActorContext, id: string) {
  const orgId = requireOrg(actor);
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, id), eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning();
    if (!inv) throw notFound('Invitation');
    await audit(tx, actor, { action: 'invitation.revoked', resourceType: 'invitation', resourceId: id });
  });
}

async function findInvitation(db: DbOrTx, token: string) {
  const [row] = await db
    .select({ i: invitations, orgName: organizations.legalName })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
  if (!row) throw notFound('Invitation');
  return row;
}

export async function lookupInvitation(db: Db, token: string) {
  const { i, orgName } = await findInvitation(db, token);
  const [u] = i.email ? await db.select({ id: users.id }).from(users).where(eq(users.email, i.email)) : i.phone ? await db.select({ id: users.id }).from(users).where(eq(users.phone, i.phone)) : [];
  return { orgName, email: i.email, roles: i.roles as Role[], existingUser: !!u, expiresAt: i.expiresAt.toISOString() };
}

export async function acceptInvitation(db: Db, actor: ActorContext, body: { token: string; fullName?: string; password?: string }, req: FastifyRequest, reply: FastifyReply) {
  const { i } = await findInvitation(db, body.token);
  const [existing] = i.email ? await db.select().from(users).where(eq(users.email, i.email)) : i.phone ? await db.select().from(users).where(eq(users.phone, i.phone)) : [];
  let passwordHash: string | null = null;
  if (existing) {
    const loggedInAs = actorUserId(actor);
    const ok = loggedInAs === existing.id || (body.password && existing.passwordHash && (await verifyPassword(existing.passwordHash, body.password)));
    if (!ok) throw unauthorized('INVALID_CREDENTIALS', 'Sign in (or enter your password) to accept this invitation');
  } else {
    if (!body.fullName || !body.password) {
      throw badRequest('VALIDATION_FAILED', 'fullName and password are required', [
        { path: 'body.fullName', message: 'required' },
        { path: 'body.password', message: 'required' },
      ]);
    }
    assertPasswordPolicy(body.password);
    passwordHash = await hashPassword(body.password);
  }
  return db.transaction(async (tx) => {
    let userId = existing?.id;
    if (!userId) {
      const [u] = await tx
        .insert(users)
        .values({ email: i.email, phone: i.phone, fullName: body.fullName!, passwordHash, status: 'active', emailVerifiedAt: i.email ? new Date() : null })
        .returning();
      userId = u!.id;
    }
    await tx
      .insert(memberships)
      .values({ userId, orgId: i.orgId, roles: i.roles })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.orgId], set: { roles: i.roles, status: 'active' } });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, i.id));
    const a: ActorContext = { ...actor, principal: { type: 'user', userId, mfa: false }, orgId: i.orgId };
    await audit(tx, a, { action: 'invitation.accepted', resourceType: 'invitation', resourceId: i.id, after: { userId, roles: i.roles } });
    await emit(tx, a, 'member.joined', { type: 'organization', id: i.orgId }, { userId });
    return (await issueSession(tx, userId, { mfa: false, req, reply })).response;
  });
}

// ---------------------------------------------------------------- API keys

const apiKeyDto = (k: typeof apiKeys.$inferSelect) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  roles: k.roles as Role[],
  lastUsedAt: iso(k.lastUsedAt),
  revokedAt: iso(k.revokedAt),
  createdAt: k.createdAt.toISOString(),
});

export async function listApiKeys(db: DbOrTx, orgId: string) {
  return (await db.select().from(apiKeys).where(eq(apiKeys.orgId, orgId)).orderBy(desc(apiKeys.id))).map(apiKeyDto);
}

export async function createApiKey(db: Db, actor: ActorContext, body: { name: string; roles: Role[] }) {
  const orgId = requireOrg(actor);
  const org = await getOrg(db, orgId);
  assertRolesForOrg(body.roles, org.type);
  if (body.roles.some((r) => r === 'platform_admin' || r === 'platform_support')) throw unprocessable('ROLE_NOT_ALLOWED', 'Platform roles cannot be given to API keys');
  // org_admin can already grant any org role to members, so keys may carry any role valid for the org type (D-012).
  const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8).padEnd(8, 'x');
  const key = `jpk_${prefix}_${randomToken(30)}`;
  return db.transaction(async (tx) => {
    const [k] = await tx.insert(apiKeys).values({ orgId, name: body.name, prefix, keyHash: sha256(key), roles: body.roles, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'api_key.created', resourceType: 'api_key', resourceId: k!.id, after: { name: body.name, roles: body.roles, prefix } });
    return { ...apiKeyDto(k!), key };
  });
}

export async function revokeApiKey(db: Db, actor: ActorContext, id: string) {
  const orgId = requireOrg(actor);
  await db.transaction(async (tx) => {
    const [k] = await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt))).returning();
    if (!k) throw notFound('API key');
    await audit(tx, actor, { action: 'api_key.revoked', resourceType: 'api_key', resourceId: id });
  });
}

export async function directory(db: Db, type?: string) {
  const allowed = ['lender', 'buyer', 'guarantor', 'insurer', 'supplier'] as const;
  const types = type && (allowed as readonly string[]).includes(type) ? [type as (typeof allowed)[number]] : [...allowed];
  const rows = await db
    .select()
    .from(organizations)
    .where(and(inArray(organizations.type, types), eq(organizations.kycStatus, 'verified'), eq(organizations.status, 'active')))
    .orderBy(organizations.legalName);
  return rows.map((o) => ({ id: o.id, type: o.type, legalName: o.legalName, tradeName: o.tradeName, region: o.region, lenderKind: o.lenderKind }));
}
