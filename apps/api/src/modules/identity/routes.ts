import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiKey,
  ApiKeyCreateBody,
  ApiKeyCreated,
  ForgotPasswordBody,
  IdParam,
  Invitation,
  InvitationAcceptBody,
  InvitationCreateBody,
  InvitationLookup,
  KycDocType,
  KycDocument,
  LoginBody,
  Me,
  Member,
  MemberUpdateBody,
  MfaActivateBody,
  MfaEnrollResponse,
  Ok,
  OrgDirectoryEntry,
  OrgUpdateBody,
  Organization,
  OtpRequestBody,
  OtpVerifyBody,
  ResetPasswordBody,
  SignupBody,
  TokenResponse,
  VerifyEmailBody,
  Uuid,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireOrg } from '../../core/context';
import { requireIfMatch, setEtag } from '../../core/etag';
import { readMultipart } from '../../core/multipart';
import { storeFile } from '../files/service';
import { badRequest } from '../../core/errors';

const AUTH_RATE = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function identityRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;

  // ---------------------------------------------------------- auth
  r.post('/auth/signup', {
    config: AUTH_RATE,
    schema: { operationId: 'signup', tags: ['auth'], summary: 'Create an organisation and its first admin user', 'x-permission': 'public', body: SignupBody, response: { 201: TokenResponse } },
    handler: async (req, reply) => reply.status(201).send(await svc.signup(db, req.actor, req.body, req, reply)),
  });

  r.post('/auth/verify-email', {
    config: AUTH_RATE,
    schema: { operationId: 'verifyEmail', tags: ['auth'], summary: 'Confirm email address', 'x-permission': 'public', body: VerifyEmailBody, response: { 200: Ok } },
    handler: async (req) => {
      await svc.verifyEmail(db, req.actor, req.body.token);
      return { ok: true as const };
    },
  });

  r.post('/auth/login', {
    config: AUTH_RATE,
    schema: { operationId: 'login', tags: ['auth'], summary: 'Email + password (+ TOTP) login', 'x-permission': 'public', body: LoginBody, response: { 200: TokenResponse } },
    handler: async (req, reply) => svc.login(db, req.actor, req.body, req, reply),
  });

  r.post('/auth/otp/request', {
    config: AUTH_RATE,
    schema: { operationId: 'requestLoginOtp', tags: ['auth'], summary: 'Send a login code by SMS', 'x-permission': 'public', body: OtpRequestBody, response: { 202: Ok } },
    handler: async (req, reply) => {
      await svc.requestLoginOtp(db, req.body.phone);
      return reply.status(202).send({ ok: true as const });
    },
  });

  r.post('/auth/otp/verify', {
    config: AUTH_RATE,
    schema: { operationId: 'verifyLoginOtp', tags: ['auth'], summary: 'Log in with an SMS code', 'x-permission': 'public', body: OtpVerifyBody, response: { 200: TokenResponse } },
    handler: async (req, reply) => svc.verifyLoginOtp(db, req.actor, req.body.phone, req.body.code, req, reply),
  });

  r.post('/auth/refresh', {
    config: AUTH_RATE,
    schema: { operationId: 'refreshSession', tags: ['auth'], summary: 'Rotate refresh token (cookie + X-CSRF-Token)', 'x-permission': 'public', response: { 200: TokenResponse } },
    handler: async (req, reply) => svc.refreshSession(db, req, reply),
  });

  r.post('/auth/logout', {
    schema: { operationId: 'logout', tags: ['auth'], summary: 'Revoke the session family', 'x-permission': 'public', response: { 200: Ok } },
    handler: async (req, reply) => {
      await svc.logout(db, req, reply);
      return { ok: true as const };
    },
  });

  r.post('/auth/password/forgot', {
    config: AUTH_RATE,
    schema: { operationId: 'forgotPassword', tags: ['auth'], summary: 'Email a password reset link', 'x-permission': 'public', body: ForgotPasswordBody, response: { 202: Ok } },
    handler: async (req, reply) => {
      await svc.forgotPassword(db, req.body.email);
      return reply.status(202).send({ ok: true as const });
    },
  });

  r.post('/auth/password/reset', {
    config: AUTH_RATE,
    schema: { operationId: 'resetPassword', tags: ['auth'], summary: 'Set a new password from a reset link', 'x-permission': 'public', body: ResetPasswordBody, response: { 200: Ok } },
    handler: async (req) => {
      await svc.resetPassword(db, req.actor, req.body.token, req.body.password);
      return { ok: true as const };
    },
  });

  r.post('/auth/mfa/enroll', {
    schema: { operationId: 'mfaEnroll', tags: ['auth'], summary: 'Start TOTP enrolment', 'x-permission': 'authenticated', response: { 200: MfaEnrollResponse } },
    handler: async (req) => svc.mfaEnroll(db, req.actor),
  });

  r.post('/auth/mfa/activate', {
    schema: { operationId: 'mfaActivate', tags: ['auth'], summary: 'Confirm TOTP enrolment', 'x-permission': 'authenticated', body: MfaActivateBody, response: { 200: TokenResponse } },
    handler: async (req, reply) => svc.mfaActivate(db, req.actor, req.body.code, req, reply),
  });

  r.get('/me', {
    schema: { operationId: 'getMe', tags: ['auth'], summary: 'Current principal, memberships and permissions', 'x-permission': 'authenticated', response: { 200: Me } },
    handler: async (req) => svc.me(db, req.actor),
  });

  // ---------------------------------------------------------- organisation
  r.get('/orgs/current', {
    schema: { operationId: 'getCurrentOrg', tags: ['orgs'], 'x-permission': 'org:read', response: { 200: Organization } },
    handler: async (req, reply) => {
      const o = await svc.getOrg(db, requireOrg(req.actor));
      setEtag(reply, o.version);
      return svc.orgDto(o, req.actor);
    },
  });

  r.patch('/orgs/current', {
    schema: { operationId: 'updateCurrentOrg', tags: ['orgs'], 'x-permission': 'org:update', body: OrgUpdateBody, response: { 200: Organization } },
    handler: async (req, reply) => {
      const o = await svc.updateCurrentOrg(db, req.actor, requireIfMatch(req), req.body);
      setEtag(reply, o.version);
      return svc.orgDto(o, req.actor);
    },
  });

  r.get('/orgs/current/kyc-documents', {
    schema: { operationId: 'listKycDocuments', tags: ['orgs'], 'x-permission': 'org:read', response: { 200: z.object({ data: z.array(KycDocument) }) } },
    handler: async (req) => ({ data: await svc.listKycDocs(db, requireOrg(req.actor)) }),
  });

  r.post('/orgs/current/kyc-documents', {
    schema: {
      operationId: 'uploadKycDocument',
      tags: ['orgs'],
      summary: 'Upload a KYC document (multipart: docType, file)',
      consumes: ['multipart/form-data'],
      'x-permission': 'org:update',
      response: { 201: KycDocument },
    },
    handler: async (req, reply) => {
      const { fields, file } = await readMultipart(req);
      const docType = KycDocType.safeParse(fields.docType);
      if (!docType.success) throw badRequest('VALIDATION_FAILED', 'docType is invalid', [{ path: 'body.docType', message: 'invalid' }]);
      const doc = await db.transaction(async (tx) => {
        const f = await storeFile(ctx, tx, req.actor, file, { linkedType: 'organization', linkedId: requireOrg(req.actor) });
        return svc.addKycDoc(tx, req.actor, docType.data, f.id);
      });
      const all = await svc.listKycDocs(db, requireOrg(req.actor));
      return reply.status(201).send(all.find((d) => d.id === doc.id)!);
    },
  });

  r.post('/orgs/current/actions/submit-kyc', {
    schema: { operationId: 'submitKyc', tags: ['orgs'], summary: 'Submit KYC documents for review', 'x-permission': 'org:update', response: { 200: Organization } },
    handler: async (req, reply) => {
      const o = await svc.submitKyc(db, req.actor);
      setEtag(reply, o.version);
      return svc.orgDto(o, req.actor);
    },
  });

  r.get('/orgs/directory', {
    schema: {
      operationId: 'orgDirectory',
      tags: ['orgs'],
      summary: 'Public profiles of verified lenders, buyers, guarantors, insurers, suppliers',
      'x-permission': 'org:directory',
      querystring: z.object({ type: z.enum(['lender', 'buyer', 'guarantor', 'insurer', 'supplier']).optional() }),
      response: { 200: z.object({ data: z.array(OrgDirectoryEntry) }) },
    },
    handler: async (req) => ({ data: await svc.directory(db, req.query.type) }),
  });

  // ---------------------------------------------------------- members
  r.get('/orgs/current/members', {
    schema: { operationId: 'listMembers', tags: ['members'], 'x-permission': 'member:manage', response: { 200: z.object({ data: z.array(Member) }) } },
    handler: async (req) => ({ data: await svc.listMembers(db, requireOrg(req.actor)) }),
  });

  r.patch('/orgs/current/members/:userId', {
    schema: { operationId: 'updateMember', tags: ['members'], 'x-permission': 'member:manage', params: z.object({ userId: Uuid }), body: MemberUpdateBody, response: { 200: Member } },
    handler: async (req) => svc.updateMember(db, req.actor, req.params.userId, req.body),
  });

  r.get('/orgs/current/invitations', {
    schema: { operationId: 'listInvitations', tags: ['members'], 'x-permission': 'member:manage', response: { 200: z.object({ data: z.array(Invitation) }) } },
    handler: async (req) => ({ data: await svc.listInvitations(db, requireOrg(req.actor)) }),
  });

  r.post('/orgs/current/invitations', {
    schema: { operationId: 'createInvitation', tags: ['members'], 'x-permission': 'member:manage', body: InvitationCreateBody, response: { 201: Invitation } },
    handler: async (req, reply) => reply.status(201).send((await svc.createInvitation(db, req.actor, req.body)).invitation),
  });

  r.delete('/orgs/current/invitations/:id', {
    schema: { operationId: 'revokeInvitation', tags: ['members'], 'x-permission': 'member:manage', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      await svc.revokeInvitation(db, req.actor, req.params.id);
      return { ok: true as const };
    },
  });

  r.get('/invitations/lookup', {
    config: AUTH_RATE,
    schema: { operationId: 'lookupInvitation', tags: ['members'], 'x-permission': 'public', querystring: z.object({ token: z.string().min(20) }), response: { 200: InvitationLookup } },
    handler: async (req) => svc.lookupInvitation(db, req.query.token),
  });

  r.post('/invitations/accept', {
    config: AUTH_RATE,
    schema: { operationId: 'acceptInvitation', tags: ['members'], 'x-permission': 'public', body: InvitationAcceptBody, response: { 200: TokenResponse } },
    handler: async (req, reply) => svc.acceptInvitation(db, req.actor, req.body, req, reply),
  });

  // ---------------------------------------------------------- api keys
  r.get('/orgs/current/api-keys', {
    schema: { operationId: 'listApiKeys', tags: ['api-keys'], 'x-permission': 'apikey:manage', response: { 200: z.object({ data: z.array(ApiKey) }) } },
    handler: async (req) => ({ data: await svc.listApiKeys(db, requireOrg(req.actor)) }),
  });

  r.post('/orgs/current/api-keys', {
    schema: { operationId: 'createApiKey', tags: ['api-keys'], summary: 'Create an API key (shown once)', 'x-permission': 'apikey:manage', body: ApiKeyCreateBody, response: { 201: ApiKeyCreated } },
    handler: async (req, reply) => reply.status(201).send(await svc.createApiKey(db, req.actor, req.body)),
  });

  r.delete('/orgs/current/api-keys/:id', {
    schema: { operationId: 'revokeApiKey', tags: ['api-keys'], 'x-permission': 'apikey:manage', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      await svc.revokeApiKey(db, req.actor, req.params.id);
      return { ok: true as const };
    },
  });
}
