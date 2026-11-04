import type { Role } from '@jappo/contracts';

/**
 * Static role → permission map (SPEC §6.2). Permissions are `resource:action`.
 * Extension modules add their own via JappoModule.permissions (merged at boot).
 */
const READ_OPERATOR = [
  'org:read', 'org:directory', 'file:read', 'notification:read', 'event:read', 'catalogue:read',
  'farmer:read', 'block:read', 'plot:read', 'land_document:read', 'season:read', 'budget:read', 'quote:read',
  'offtake:read', 'model_run:read', 'readiness:read', 'dossier:read', 'risk_cover:read', 'financing_request:read',
  'rfp:read', 'bid:read', 'contract:read', 'facility:read', 'disbursement:read', 'service_delivery:read',
  'visit:read', 'alert:read', 'harvest:read', 'dispatch:read', 'buyer_invoice:read', 'escrow_receipt:read',
  'settlement:read', 'statement:read', 'dashboard:read', 'kpi:read', 'report:read', 'billing:read',
] as const;

const READ_LENDER = [
  'org:read', 'org:directory', 'file:read', 'notification:read', 'event:read', 'catalogue:read',
  'block:read', 'plot:read', 'land_document:read', 'season:read', 'budget:read', 'offtake:read', 'model_run:read',
  'readiness:read', 'dossier:read', 'risk_cover:read', 'lender_profile:read', 'rfp:read', 'bid:read', 'contract:read',
  'facility:read', 'disbursement:read', 'visit:read', 'alert:read', 'harvest:read', 'dispatch:read',
  'buyer_invoice:read', 'escrow_receipt:read', 'settlement:read', 'statement:read', 'dashboard:read', 'kpi:read',
  'report:read', 'billing:read', 'farmer:read',
] as const;

export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  platform_admin: ['*'],
  platform_support: [...READ_OPERATOR, ...READ_LENDER, 'admin:read', 'audit:read'],
  org_admin: [
    'org:read', 'org:update', 'org:directory', 'member:manage', 'apikey:manage', 'webhook:manage', 'billing:read',
    'billing:manage', 'file:create', 'file:read', 'notification:read', 'event:read', 'audit:read',
  ],
  operator_manager: [
    ...READ_OPERATOR,
    'file:create', 'farmer:create', 'farmer:update', 'farmer:verify_kyc', 'farmer:verify_wallet', 'farmer:import',
    'farmer:pii_read', 'block:create', 'block:update', 'block:archive', 'plot:create', 'plot:update',
    'allocation:manage', 'land_document:create', 'asset:manage', 'grievance:manage', 'crop_template:manage',
    'service:manage', 'season:create', 'season:update', 'season:start', 'season:cancel', 'planting:manage',
    'budget:manage', 'quote:manage', 'capex:manage', 'opex:manage', 'fee_policy:manage', 'offtake:manage',
    'model_run:create', 'dossier:freeze', 'risk_cover:manage', 'financing_request:manage', 'financing_request:submit',
    'rfp:manage', 'rfp_question:answer', 'award:decide', 'contract:manage', 'contract:sign', 'disbursement:request',
    'service_delivery:record', 'visit:record', 'alert:manage', 'harvest:record', 'dispatch:create',
    'buyer_invoice:create', 'settlement:compute', 'settlement:approve_operator', 'settlement:instruct',
    'settlement:reconcile', 'payout:confirm', 'statement:send', 'report:create', 'field:sync',
  ],
  agronomist: [
    ...READ_OPERATOR,
    'file:create', 'crop_template:manage', 'planting:manage', 'visit:record', 'alert:manage', 'model_run:create',
    'field:sync',
  ],
  field_agent: [
    'org:read', 'file:read', 'file:create', 'notification:read', 'catalogue:read', 'farmer:read', 'farmer:create',
    'farmer:update', 'block:read', 'plot:read', 'plot:create', 'plot:update', 'allocation:manage', 'season:read',
    'budget:read', 'visit:read', 'visit:record', 'service_delivery:read', 'service_delivery:record', 'harvest:read',
    'harvest:record', 'contract:read', 'contract:witness_sign', 'alert:read', 'field:sync',
  ],
  finance_officer: [
    ...READ_OPERATOR,
    'file:create', 'budget:manage', 'quote:manage', 'capex:manage', 'opex:manage', 'fee_policy:manage',
    'disbursement:request', 'buyer_invoice:create', 'settlement:compute', 'settlement:approve_operator',
    'settlement:instruct', 'settlement:reconcile', 'payout:confirm', 'statement:send', 'escrow_receipt:record',
    'contract:sign', 'billing:read', 'report:create',
  ],
  credit_officer: [
    ...READ_LENDER,
    'file:create', 'lender_profile:manage', 'rfp:respond', 'rfp_question:ask', 'bid:draft', 'facility:manage',
    'escrow_account:manage', 'disbursement:approve', 'disbursement:execute', 'escrow_receipt:record',
    'escrow_receipt:confirm', 'settlement:approve_lender', 'payout:confirm', 'report:create', 'contract:sign',
  ],
  credit_committee: [...READ_LENDER, 'file:create', 'bid:draft', 'bid:submit', 'award:respond', 'contract:sign', 'rfp:respond'],
  buyer_rep: [
    'org:read', 'org:directory', 'file:read', 'file:create', 'notification:read', 'event:read', 'catalogue:read',
    'offtake:read', 'dispatch:read', 'dispatch:accept', 'buyer_invoice:read', 'escrow_receipt:read',
    'escrow_receipt:record', 'contract:read', 'contract:sign',
  ],
  viewer: [...new Set([...READ_OPERATOR, ...READ_LENDER])],
};

export function permissionsFor(roles: readonly Role[], extra: Record<string, readonly string[]> = {}): Set<string> {
  const out = new Set<string>();
  for (const r of roles) {
    for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
    for (const p of extra[r] ?? []) out.add(p);
  }
  return out;
}

export function hasPermission(perms: ReadonlySet<string>, permission: string): boolean {
  if (perms.has('*') || perms.has(permission)) return true;
  const [res] = permission.split(':');
  return perms.has(`${res}:*`);
}

/** Routes whose permission value is not a `resource:action` string. */
export type SpecialPermission = 'public' | 'authenticated' | 'farmer';
