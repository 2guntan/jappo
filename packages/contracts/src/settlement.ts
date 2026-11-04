import { z } from 'zod';
import { AllowedActions, IsoDateTime, Uuid, Xof } from './common';

const Arrears = z.object({ seasonalDebtXof: Xof, investmentFeeXof: Xof, operatorFeesXof: Xof });
export const SettlementRun = z
  .object({
    id: Uuid,
    ref: z.string(),
    blockId: Uuid,
    blockRef: z.string(),
    blockName: z.string(),
    seasonId: Uuid,
    status: z.enum(['draft', 'computed', 'approved_operator', 'approved_lenders', 'instructed', 'executed', 'reconciled']),
    receiptsTotalXof: Xof,
    grossCreditTotalXof: Xof,
    engineVersion: z.string(),
    computedAt: IsoDateTime.nullable(),
    approvedOperatorAt: IsoDateTime.nullable(),
    instructedAt: IsoDateTime.nullable(),
    executedAt: IsoDateTime.nullable(),
    reconciledAt: IsoDateTime.nullable(),
    lines: z.array(z.object({ farmerId: Uuid, farmerCode: z.string(), farmerName: z.string(), grossCreditXof: Xof, seasonalPaidXof: Xof, investmentFeePaidXof: Xof, operatorFeesPaidXof: Xof, otherDeductionsXof: Xof, solidarityContributionXof: Xof, solidarityReceivedXof: Xof, payoutXof: Xof, arrears: Arrears })),
    distribution: z.object({ seasonalByFacility: z.array(z.object({ facilityId: Uuid, amountXof: Xof })), investmentToLenderXof: Xof, investmentExcessToOperatorXof: Xof, operatorXof: Xof, farmersTotalXof: Xof, roundingToOperatorXof: Xof }),
    invariantOk: z.boolean(),
    lenderApprovals: z.array(z.object({ lenderOrgId: Uuid, lenderName: z.string(), approvedAt: IsoDateTime.nullable() })),
    version: z.number().int(),
    allowedActions: AllowedActions,
  })
  .meta({ id: 'SettlementRun' });

export const PayoutInstruction = z
  .object({ id: Uuid, ref: z.string(), beneficiaryType: z.enum(['lender', 'operator', 'farmer', 'supplier']), beneficiaryId: Uuid, beneficiaryName: z.string(), facilityId: Uuid.nullable(), channel: z.enum(['bank_transfer', 'mobile_money']), destinationMasked: z.string(), heldForFarmer: z.boolean(), amountXof: Xof, status: z.enum(['pending', 'exported', 'sent', 'confirmed', 'failed']), provider: z.string(), providerRef: z.string().nullable(), confirmedAt: IsoDateTime.nullable(), failureReason: z.string().nullable(), version: z.number().int() })
  .meta({ id: 'PayoutInstruction' });
export const InstructionActionBody = z.object({ providerRef: z.string().max(100).nullish(), reason: z.string().max(2000).nullish() });
export const ImportConfirmationsBody = z.object({ csv: z.string().min(10).max(2_000_000) });
export const ImportConfirmationsResult = z.object({ results: z.array(z.object({ reference: z.string(), status: z.enum(['confirmed', 'failed', 'skipped']), error: z.string().nullable() })) }).meta({ id: 'ImportConfirmationsResult' });
export const FarmerStatement = z.object({ id: Uuid, farmerId: Uuid, farmerCode: z.string(), farmerName: z.string(), smsText: z.string(), hasPdf: z.boolean(), sentAt: IsoDateTime.nullable() }).meta({ id: 'FarmerStatement' });
export const FarmerArrear = z.object({ id: Uuid, blockId: Uuid, originRunId: Uuid, bucket: z.enum(['seasonal_debt', 'investment_fee', 'operator_fees']), amountXof: Xof, remainingXof: Xof, facilityId: Uuid.nullable(), status: z.enum(['open', 'settled', 'written_off', 'claimed_guarantee']), createdAt: IsoDateTime }).meta({ id: 'FarmerArrear' });

export const FarmerOtpRequestBody = z.object({ phone: z.string().regex(/^\+?[0-9]{8,15}$/) });
export const FarmerOtpVerifyBody = z.object({ phone: z.string().regex(/^\+?[0-9]{8,15}$/), code: z.string().regex(/^\d{6}$/) });
export const FarmerToken = z.object({ accessToken: z.string(), expiresIn: z.number().int() }).meta({ id: 'FarmerToken' });
export const MeFarmer = z.object({ id: Uuid, code: z.string(), firstName: z.string(), lastName: z.string(), village: z.string().nullable(), phoneMasked: z.string().nullable(), walletMasked: z.string().nullable(), walletVerified: z.boolean(), operatorName: z.string(), locale: z.string() }).meta({ id: 'MeFarmer' });
export const MeFarmerPlot = z.object({ plotId: Uuid, plotCode: z.string(), blockRef: z.string(), blockName: z.string(), areaHa: z.number(), sharePct: z.number(), status: z.string() }).meta({ id: 'MeFarmerPlot' });
export const MeFarmerStatement = z.object({ id: Uuid, runRef: z.string(), seasonName: z.string(), blockName: z.string(), grossCreditXof: Xof, payoutXof: Xof, arrearsXof: Xof, createdAt: IsoDateTime }).meta({ id: 'MeFarmerStatement' });
