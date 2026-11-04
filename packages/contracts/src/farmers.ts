import { z } from 'zod';
import { AllowedActions, IsoDate, IsoDateTime, Locale, Uuid, Xof } from './common';
import { GeoPoint } from './geo';
import { Phone } from './identity';

export const SEXES = ['F', 'M'] as const;
export const NATIONAL_ID_TYPES = ['cni', 'passport', 'other', 'none'] as const;
export const WALLET_PROVIDERS = ['wave', 'orange_money', 'free_money', 'other', 'none'] as const;
export const FARMER_KYC_STATUSES = ['pending', 'verified', 'rejected'] as const;

const FarmerFields = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  sex: z.enum(SEXES),
  birthYear: z.number().int().min(1900).max(2030).nullable(),
  phone: Phone.nullable(),
  locale: z.enum(['fr', 'en', 'wo']),
  nationalIdType: z.enum(NATIONAL_ID_TYPES),
  nationalIdNumber: z.string().trim().min(4).max(40).nullable(),
  photoFileId: Uuid.nullable(),
  idPhotoFileId: Uuid.nullable(),
  village: z.string().max(100).nullable(),
  commune: z.string().max(100).nullable(),
  homeLocation: GeoPoint.nullable(),
  householdSize: z.number().int().min(1).max(100).nullable(),
  baselineIncomeXof: Xof.min(0).nullable(),
  mobileWalletProvider: z.enum(WALLET_PROVIDERS),
  mobileWalletNumber: Phone.nullable(),
  consentData: z.boolean(),
  consentCreditBureau: z.boolean(),
});

export const FarmerCreateBody = FarmerFields.partial().required({ firstName: true, lastName: true, sex: true, consentData: true }).extend({
  consentCreditBureau: z.boolean().default(false),
});
export type FarmerCreateBody = z.infer<typeof FarmerCreateBody>;
export const FarmerUpdateBody = FarmerFields.partial();
export type FarmerUpdateBody = z.infer<typeof FarmerUpdateBody>;

export const Farmer = z
  .object({
    id: Uuid,
    ownerOrgId: Uuid,
    code: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    sex: z.enum(SEXES),
    birthYear: z.number().int().nullable(),
    phone: z.string().nullable(),
    locale: z.string(),
    nationalIdType: z.enum(NATIONAL_ID_TYPES),
    nationalIdNumberMasked: z.string().nullable(),
    photoFileId: Uuid.nullable(),
    idPhotoFileId: Uuid.nullable(),
    village: z.string().nullable(),
    commune: z.string().nullable(),
    homeLocation: GeoPoint.nullable(),
    householdSize: z.number().int().nullable(),
    baselineIncomeXof: Xof.nullable(),
    mobileWalletProvider: z.enum(WALLET_PROVIDERS),
    mobileWalletNumberMasked: z.string().nullable(),
    walletVerifiedAt: IsoDateTime.nullable(),
    consentDataAt: IsoDateTime.nullable(),
    consentCreditBureauAt: IsoDateTime.nullable(),
    kycStatus: z.enum(FARMER_KYC_STATUSES),
    kycVerifiedAt: IsoDateTime.nullable(),
    status: z.enum(['active', 'inactive']),
    flags: z.array(z.object({ id: Uuid, type: z.string(), detail: z.string().nullable() })),
    version: z.number().int(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    allowedActions: AllowedActions,
  })
  .meta({ id: 'Farmer' });
export type Farmer = z.infer<typeof Farmer>;

export const FarmerPii = z.object({ nationalIdNumber: z.string().nullable(), mobileWalletNumber: z.string().nullable() });
export const FarmerImportRow = z.object({
  row: z.number().int(),
  status: z.enum(['created', 'updated', 'error']),
  farmerId: Uuid.nullable(),
  code: z.string().nullable(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
});
export const FarmerImportResult = z.object({ created: z.number().int(), updated: z.number().int(), failed: z.number().int(), rows: z.array(FarmerImportRow) });
export const WalletConfirmBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const FarmerHistory = z.object({
  allocations: z.array(z.object({ id: Uuid, plotId: Uuid, plotCode: z.string(), blockId: Uuid, blockName: z.string(), sharePct: z.number(), startDate: IsoDate, endDate: IsoDate.nullable(), status: z.string() })),
  deliveries: z.array(z.record(z.string(), z.unknown())),
  statements: z.array(z.record(z.string(), z.unknown())),
  arrears: z.array(z.record(z.string(), z.unknown())),
});
export { Locale };
