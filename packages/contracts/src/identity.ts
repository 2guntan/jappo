import { z } from 'zod';
import { AllowedActions, IsoDateTime, Locale, Uuid } from './common';
import { KycDocType, KycStatus, LegalForm, LenderKind, OrgStatus, OrgType, Role, SignupOrgType, DocReviewStatus } from './enums';

export const Email = z.email().max(254).transform((s) => s.toLowerCase());
/** E.164-ish phone: + then 8–15 digits (Senegal: +221XXXXXXXXX). */
export const Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in international format, e.g. +221771234567');
export const Password = z.string().min(10).max(200);

export const SignupBody = z.object({
  orgType: SignupOrgType,
  legalName: z.string().min(2).max(200),
  tradeName: z.string().max(200).optional(),
  legalForm: LegalForm,
  ninea: z.string().max(50).optional(),
  rccm: z.string().max(50).optional(),
  region: z.string().max(100).optional(),
  phone: Phone.optional(),
  lenderKind: LenderKind.optional(),
  fullName: z.string().min(2).max(200),
  email: Email,
  password: Password,
  locale: Locale.default('fr'),
});
export type SignupBody = z.infer<typeof SignupBody>;

export const LoginBody = z.object({ email: Email, password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() });

export const TokenResponse = z
  .object({
    accessToken: z.string(),
    expiresIn: z.number().int(),
    tokenType: z.literal('Bearer'),
    mfaEnrolmentRequired: z.boolean(),
    csrfToken: z.string(),
  })
  .meta({ id: 'TokenResponse' });

export const MfaChallenge = z.object({ mfaRequired: z.literal(true) });

export const OtpRequestBody = z.object({ phone: Phone });
export const OtpVerifyBody = z.object({ phone: Phone, code: z.string().regex(/^\d{6}$/) });
export const ForgotPasswordBody = z.object({ email: Email });
export const ResetPasswordBody = z.object({ token: z.string().min(20), password: Password });
export const VerifyEmailBody = z.object({ token: z.string().min(20) });
export const MfaEnrollResponse = z.object({ secret: z.string(), otpauthUrl: z.string() });
export const MfaActivateBody = z.object({ code: z.string().regex(/^\d{6}$/) });

export const Organization = z
  .object({
    id: Uuid,
    type: OrgType,
    legalName: z.string(),
    tradeName: z.string().nullable(),
    legalForm: LegalForm,
    ninea: z.string().nullable(),
    rccm: z.string().nullable(),
    country: z.string(),
    region: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    logoFileId: Uuid.nullable(),
    locale: Locale,
    kycStatus: KycStatus,
    status: OrgStatus,
    lenderKind: LenderKind.nullable(),
    bceaoApprovalNo: z.string().nullable(),
    annualVolumeKgEstimate: z.number().nullable(),
    yearsInBusiness: z.number().int().nullable(),
    version: z.number().int(),
    createdAt: IsoDateTime,
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Organization' });
export type Organization = z.infer<typeof Organization>;

export const OrgUpdateBody = z
  .object({
    legalName: z.string().min(2).max(200),
    tradeName: z.string().max(200).nullable(),
    legalForm: LegalForm,
    ninea: z.string().max(50).nullable(),
    rccm: z.string().max(50).nullable(),
    region: z.string().max(100).nullable(),
    address: z.string().max(500).nullable(),
    phone: Phone.nullable(),
    email: Email.nullable(),
    logoFileId: Uuid.nullable(),
    locale: Locale,
    lenderKind: LenderKind.nullable(),
    bceaoApprovalNo: z.string().max(100).nullable(),
    annualVolumeKgEstimate: z.number().min(0).nullable(),
    yearsInBusiness: z.number().int().min(0).max(200).nullable(),
  })
  .partial();

export const OrgDirectoryEntry = z.object({
  id: Uuid,
  type: OrgType,
  legalName: z.string(),
  tradeName: z.string().nullable(),
  region: z.string().nullable(),
  lenderKind: LenderKind.nullable(),
});

export const KycDocument = z
  .object({
    id: Uuid,
    orgId: Uuid,
    docType: KycDocType,
    fileId: Uuid,
    filename: z.string(),
    status: DocReviewStatus,
    reviewedAt: IsoDateTime.nullable(),
    comment: z.string().nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'KycDocument' });

export const KycDocumentCreateBody = z.object({ docType: KycDocType, fileId: Uuid });

export const Membership = z.object({
  orgId: Uuid,
  orgType: OrgType,
  orgName: z.string(),
  roles: z.array(Role),
  kycStatus: KycStatus,
  /** SPEC §15 billing banner / read-only mode. */
  billingStatus: z.enum(['ok', 'overdue', 'restricted']).optional(),
});

export const Me = z
  .object({
    principalType: z.enum(['user', 'api_key']),
    user: z
      .object({
        id: Uuid,
        email: z.string().nullable(),
        phone: z.string().nullable(),
        fullName: z.string(),
        locale: Locale,
        emailVerified: z.boolean(),
        mfaEnabled: z.boolean(),
      })
      .nullable(),
    memberships: z.array(Membership),
    activeOrgId: Uuid.nullable(),
    roles: z.array(Role),
    permissions: z.array(z.string()),
    mfaEnrolmentRequired: z.boolean(),
  })
  .meta({ id: 'Me' });

export const Member = z.object({
  userId: Uuid,
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roles: z.array(Role),
  status: z.enum(['active', 'disabled']),
  lastLoginAt: IsoDateTime.nullable(),
});

export const MemberUpdateBody = z.object({ roles: z.array(Role).min(1).optional(), status: z.enum(['active', 'disabled']).optional() });

export const InvitationCreateBody = z
  .object({ email: Email.optional(), phone: Phone.optional(), roles: z.array(Role).min(1) })
  .refine((v) => v.email || v.phone, { message: 'email or phone is required' });

export const Invitation = z.object({
  id: Uuid,
  orgId: Uuid,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roles: z.array(Role),
  expiresAt: IsoDateTime,
  acceptedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});

export const InvitationLookup = z.object({
  orgName: z.string(),
  email: z.string().nullable(),
  roles: z.array(Role),
  existingUser: z.boolean(),
  expiresAt: IsoDateTime,
});

export const InvitationAcceptBody = z.object({
  token: z.string().min(20),
  fullName: z.string().min(2).max(200).optional(),
  password: Password.optional(),
});

export const ApiKey = z.object({
  id: Uuid,
  name: z.string(),
  prefix: z.string(),
  roles: z.array(Role),
  lastUsedAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export const ApiKeyCreateBody = z.object({ name: z.string().min(2).max(100), roles: z.array(Role).min(1) });
export const ApiKeyCreated = ApiKey.extend({ key: z.string() });

export const AdminKycAction = z.object({ comment: z.string().max(2000).optional() });

export const FileMeta = z
  .object({
    id: Uuid,
    ownerOrgId: Uuid,
    filename: z.string(),
    mime: z.string(),
    sizeBytes: z.number().int(),
    sha256: z.string(),
    visibility: z.enum(['private', 'shared_via_grant']),
    linkedType: z.string().nullable(),
    linkedId: Uuid.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'FileMeta' });

export const Notification = z.object({
  id: Uuid,
  channel: z.enum(['in_app', 'email', 'sms']),
  templateCode: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});

export const AuditEntry = z.object({
  id: Uuid,
  seq: z.number().int(),
  at: IsoDateTime,
  actorType: z.string(),
  actorId: z.string().nullable(),
  orgId: Uuid.nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  hash: z.string(),
});

export const AuditVerifyResult = z.object({ ok: z.boolean(), checked: z.number().int(), brokenAtSeq: z.number().int().nullable() });

export const ModuleNav = z.object({
  name: z.string(),
  version: z.string(),
  navItems: z.array(z.object({ key: z.string(), href: z.string(), labelKey: z.string(), permission: z.string().optional() })),
});
