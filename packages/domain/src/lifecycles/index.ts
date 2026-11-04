import { machine } from './machine';
export * from './machine';

// §8.1 Block
export const BLOCK_STATES = ['draft', 'documenting', 'ready', 'in_financing', 'financed', 'active', 'archived'] as const;
export type BlockStatus = (typeof BLOCK_STATES)[number];
export const blockMachine = machine(
  'block',
  BLOCK_STATES,
  [
    { from: 'draft', action: 'document', to: 'documenting', guard: 'first land doc or plot added (automatic)' },
    { from: 'documenting', action: 'check_readiness', to: 'ready', guard: 'all gates pass' },
    { from: 'ready', action: 'gate_failed', to: 'documenting' },
    { from: 'ready', action: 'submit_financing', to: 'in_financing' },
    { from: 'in_financing', action: 'activate_facility', to: 'financed' },
    { from: 'in_financing', action: 'financing_failed', to: 'ready' },
    { from: 'financed', action: 'start_season', to: 'active' },
    { from: 'active', action: 'season_settled', to: 'financed' },
    { from: ['draft', 'documenting', 'ready', 'in_financing', 'financed', 'active'], action: 'archive', to: 'archived', guard: 'no active facility' },
  ] as const,
);

// §8.2 Season
export const SEASON_STATES = ['planning', 'financing', 'in_progress', 'harvest', 'settlement', 'closed', 'cancelled'] as const;
export type SeasonStatus = (typeof SEASON_STATES)[number];
export const seasonMachine = machine('season', SEASON_STATES, [
  { from: 'planning', action: 'enter_financing', to: 'financing' },
  { from: ['planning', 'financing'], action: 'start', to: 'in_progress', guard: 'disbursement confirmed or self-financed' },
  { from: 'in_progress', action: 'first_harvest', to: 'harvest' },
  { from: ['in_progress', 'harvest'], action: 'start_settlement', to: 'settlement' },
  { from: 'settlement', action: 'close', to: 'closed', guard: 'settlement run reconciled' },
  { from: ['planning', 'financing'], action: 'cancel', to: 'cancelled' },
] as const);

// §8.3 RFP
export const RFP_STATES = ['draft', 'open', 'closed', 'evaluation', 'awarded', 'cancelled'] as const;
export type RfpStatus = (typeof RFP_STATES)[number];
export const rfpMachine = machine('rfp', RFP_STATES, [
  { from: 'draft', action: 'open', to: 'open', guard: 'dossier frozen, ≥1 invited lender' },
  { from: 'open', action: 'extend', to: 'open', guard: 'max 2 extensions' },
  { from: 'open', action: 'close', to: 'closed', guard: 'deadline reached' },
  { from: 'open', action: 'close_early', to: 'closed', guard: 'all invitees bid or declined' },
  { from: 'closed', action: 'evaluate', to: 'evaluation' },
  { from: 'evaluation', action: 'award', to: 'awarded', guard: 'Σ awarded per tranche ≤ tranche amount' },
  { from: ['draft', 'open', 'closed', 'evaluation'], action: 'cancel', to: 'cancelled', guard: 'reason required' },
] as const);

// §8.4 Bid
export const BID_STATES = ['draft', 'submitted', 'withdrawn', 'opened', 'awarded', 'not_awarded', 'expired'] as const;
export type BidStatus = (typeof BID_STATES)[number];
export const bidMachine = machine('bid', BID_STATES, [
  { from: 'draft', action: 'submit', to: 'submitted', guard: 'rfp open, before deadline, share ≥ min' },
  { from: 'submitted', action: 'withdraw', to: 'withdrawn', guard: 'rfp open' },
  { from: 'submitted', action: 'open', to: 'opened', guard: 'rfp closed' },
  { from: 'opened', action: 'award', to: 'awarded' },
  { from: 'opened', action: 'not_award', to: 'not_awarded' },
  { from: ['submitted', 'opened'], action: 'expire', to: 'expired' },
] as const);

// §8.5 Contract
export const CONTRACT_STATES = ['draft', 'out_for_signature', 'partially_signed', 'signed', 'voided'] as const;
export type ContractStatus = (typeof CONTRACT_STATES)[number];
export const contractMachine = machine('contract', CONTRACT_STATES, [
  { from: 'draft', action: 'send', to: 'out_for_signature' },
  { from: ['out_for_signature', 'partially_signed'], action: 'sign_partial', to: 'partially_signed' },
  { from: ['out_for_signature', 'partially_signed'], action: 'sign_complete', to: 'signed' },
  { from: ['draft', 'out_for_signature', 'partially_signed'], action: 'void', to: 'voided' },
] as const);

// §8.6 Facility
export const FACILITY_STATES = ['pending_cp', 'active', 'in_arrears', 'repaid', 'defaulted', 'restructured'] as const;
export type FacilityStatus = (typeof FACILITY_STATES)[number];
export const facilityMachine = machine('facility', FACILITY_STATES, [
  { from: 'pending_cp', action: 'confirm_cp', to: 'active' },
  { from: 'active', action: 'mark_overdue', to: 'in_arrears' },
  { from: ['active', 'in_arrears'], action: 'repay', to: 'repaid' },
  { from: 'in_arrears', action: 'cure', to: 'active' },
  { from: 'in_arrears', action: 'mark_default', to: 'defaulted', guard: 'overdue > default days' },
  { from: ['in_arrears', 'defaulted'], action: 'restructure', to: 'restructured' },
] as const);

// §8.7 Disbursement
export const DISBURSEMENT_STATES = ['requested', 'approved', 'executed', 'confirmed', 'rejected'] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATES)[number];
export const disbursementMachine = machine('disbursement', DISBURSEMENT_STATES, [
  { from: 'requested', action: 'approve', to: 'approved' },
  { from: 'approved', action: 'execute', to: 'executed', guard: 'four-eyes' },
  { from: 'executed', action: 'confirm', to: 'confirmed' },
  { from: ['requested', 'approved'], action: 'reject', to: 'rejected' },
] as const);

// §8.8 Settlement run
export const SETTLEMENT_STATES = [
  'draft',
  'computed',
  'approved_operator',
  'approved_lenders',
  'instructed',
  'executed',
  'reconciled',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATES)[number];
export const settlementMachine = machine('settlement', SETTLEMENT_STATES, [
  { from: 'draft', action: 'compute', to: 'computed' },
  { from: 'computed', action: 'approve_operator', to: 'approved_operator' },
  { from: 'approved_operator', action: 'approve_lenders', to: 'approved_lenders', guard: 'every lender approved' },
  { from: ['computed', 'approved_operator', 'approved_lenders'], action: 'recompute', to: 'draft' },
  { from: 'approved_lenders', action: 'instruct', to: 'instructed' },
  { from: 'instructed', action: 'mark_executed', to: 'executed', guard: 'all instructions confirmed/failed-resolved' },
  { from: 'executed', action: 'reconcile', to: 'reconciled', guard: 'Σ confirmed = receipts' },
] as const);

// Org KYC (§5.1) — modelled the same way for consistency.
export const KYC_STATES = ['pending', 'submitted', 'verified', 'rejected'] as const;
export type KycStatus = (typeof KYC_STATES)[number];
export const orgKycMachine = machine('org_kyc', KYC_STATES, [
  { from: ['pending', 'rejected'], action: 'submit', to: 'submitted' },
  { from: 'submitted', action: 'submit', to: 'submitted' },
  { from: ['submitted', 'pending'], action: 'verify', to: 'verified' },
  { from: ['submitted', 'pending'], action: 'reject', to: 'rejected' },
] as const);
