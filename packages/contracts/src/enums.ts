import { z } from 'zod';

export const ORG_TYPES = ['platform', 'operator', 'lender', 'buyer', 'guarantor', 'insurer', 'supplier', 'farmer_group'] as const;
export const OrgType = z.enum(ORG_TYPES);
export type OrgType = z.infer<typeof OrgType>;

export const SIGNUP_ORG_TYPES = ['operator', 'lender', 'buyer', 'guarantor', 'insurer', 'supplier'] as const;
export const SignupOrgType = z.enum(SIGNUP_ORG_TYPES);

export const LEGAL_FORMS = ['SA', 'SARL', 'SAS', 'GIE', 'cooperative', 'association', 'mutuelle', 'etablissement_credit', 'sfd', 'other'] as const;
export const LegalForm = z.enum(LEGAL_FORMS);

export const KYC_STATUSES = ['pending', 'submitted', 'verified', 'rejected'] as const;
export const KycStatus = z.enum(KYC_STATUSES);

export const ORG_STATUSES = ['active', 'suspended'] as const;
export const OrgStatus = z.enum(ORG_STATUSES);

export const LENDER_KINDS = ['bank', 'sfd', 'dfi', 'fund', 'leasing'] as const;
export const LenderKind = z.enum(LENDER_KINDS);

export const KYC_DOC_TYPES = ['ninea', 'rccm', 'statuts', 'id_representative', 'approval_bceao', 'other'] as const;
export const KycDocType = z.enum(KYC_DOC_TYPES);

export const DOC_REVIEW_STATUSES = ['submitted', 'verified', 'rejected'] as const;
export const DocReviewStatus = z.enum(DOC_REVIEW_STATUSES);

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export const UserStatus = z.enum(USER_STATUSES);

export const ROLES = [
  'platform_admin',
  'platform_support',
  'org_admin',
  'operator_manager',
  'agronomist',
  'field_agent',
  'finance_officer',
  'credit_officer',
  'credit_committee',
  'buyer_rep',
  'viewer',
] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** Which roles may be granted within which organisation types (SPEC §5.3). */
export const ROLE_ORG_TYPES: Record<Role, readonly OrgType[] | 'any'> = {
  platform_admin: ['platform'],
  platform_support: ['platform'],
  org_admin: 'any',
  operator_manager: ['operator'],
  agronomist: ['operator'],
  field_agent: ['operator'],
  finance_officer: ['operator', 'buyer'],
  credit_officer: ['lender', 'guarantor', 'insurer'],
  credit_committee: ['lender'],
  buyer_rep: ['buyer'],
  viewer: 'any',
};

export const roleAllowedFor = (role: Role, orgType: OrgType): boolean => {
  const allowed = ROLE_ORG_TYPES[role];
  return allowed === 'any' || allowed.includes(orgType);
};

/** Roles that must use TOTP MFA (SPEC §18.1). */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['credit_committee', 'platform_admin'];

export const GRANT_SCOPES = ['read', 'comment', 'act'] as const;
export const GrantScope = z.enum(GRANT_SCOPES);

export const FILE_VISIBILITIES = ['private', 'shared_via_grant'] as const;

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'] as const;
export const NotificationChannel = z.enum(NOTIFICATION_CHANNELS);
