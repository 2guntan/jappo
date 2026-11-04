import { z } from 'zod';
import { AllowedActions, IsoDate, IsoDateTime, Pct, Uuid, Xof } from './common';

// ---------------------------------------------------------------- catalogue
export const CROP_CATEGORIES = ['cereal', 'vegetable', 'legume', 'root', 'fruit', 'oilseed', 'other'] as const;
export const SERVICE_KINDS = ['seed', 'fertiliser', 'crop_protection', 'mechanisation', 'irrigation_opex', 'labour', 'training', 'transport', 'storage', 'insurance_premium', 'land_fee', 'operator_service_fee', 'investment_recovery_fee', 'platform_fee', 'other'] as const;
export const SERVICE_UNITS = ['kg', 'l', 'ha', 'hour', 'day', 'unit', 'season', 'bag'] as const;

export const Crop = z.object({ id: Uuid, code: z.string(), nameFr: z.string(), nameEn: z.string(), category: z.enum(CROP_CATEGORIES), perishable: z.boolean(), varieties: z.array(z.object({ id: Uuid, name: z.string(), cycleDays: z.number().int().nullable() })) }).meta({ id: 'Crop' });
export const CropCreateBody = z.object({ code: z.string().regex(/^[a-z0-9_]{2,30}$/), nameFr: z.string().min(2), nameEn: z.string().min(2), category: z.enum(CROP_CATEGORIES), perishable: z.boolean().default(false) });
export const Zone = z.object({ id: Uuid, code: z.string(), name: z.string(), regionList: z.array(z.string()) });

export const TemplateInputItem = z.object({ serviceId: Uuid, qtyPerHa: z.number().min(0), unit: z.enum(SERVICE_UNITS) });
const TemplateFields = z.object({
  cropId: Uuid,
  varietyId: Uuid.nullable(),
  zone: z.string().min(2).max(50),
  irrigated: z.boolean(),
  cycleDays: z.number().int().min(20).max(800),
  yieldBaseTHa: z.number().min(0).max(500),
  yieldStressTHa: z.number().min(0).max(500),
  postHarvestLossPct: Pct,
  deliveryRatePct: Pct,
  waterM3Ha: z.number().min(0).nullable(),
  labourDaysHa: z.number().min(0).nullable(),
  inputs: z.array(TemplateInputItem),
  notes: z.string().max(2000).nullable(),
});
export const CropTemplateCreateBody = TemplateFields.partial().required({ cropId: true, zone: true, irrigated: true, cycleDays: true, yieldBaseTHa: true, yieldStressTHa: true, postHarvestLossPct: true });
export const CropTemplateUpdateBody = TemplateFields.omit({ cropId: true, zone: true, irrigated: true }).partial();
export const CropTemplate = z
  .object({
    id: Uuid,
    ownerOrgId: Uuid.nullable(),
    isOverride: z.boolean(),
    baseTemplateId: Uuid.nullable(),
    cropId: Uuid,
    cropCode: z.string(),
    varietyId: Uuid.nullable(),
    zone: z.string(),
    irrigated: z.boolean(),
    cycleDays: z.number().int(),
    yieldBaseTHa: z.number(),
    yieldStressTHa: z.number(),
    postHarvestLossPct: z.number(),
    deliveryRatePct: z.number(),
    waterM3Ha: z.number().nullable(),
    labourDaysHa: z.number().nullable(),
    inputs: z.array(TemplateInputItem),
    notes: z.string().nullable(),
    version: z.number().int(),
  })
  .meta({ id: 'CropTemplate' });

export const Service = z.object({ id: Uuid, ownerOrgId: Uuid.nullable(), code: z.string(), nameFr: z.string(), nameEn: z.string(), kind: z.enum(SERVICE_KINDS), unit: z.enum(SERVICE_UNITS), defaultUnitPriceXof: Xof, active: z.boolean(), version: z.number().int() }).meta({ id: 'Service' });
export const ServiceCreateBody = z.object({ code: z.string().regex(/^[a-z0-9_]{2,40}$/), nameFr: z.string().min(2), nameEn: z.string().min(2), kind: z.enum(SERVICE_KINDS), unit: z.enum(SERVICE_UNITS), defaultUnitPriceXof: Xof.min(0) });
export const ServiceUpdateBody = ServiceCreateBody.omit({ code: true }).extend({ active: z.boolean() }).partial();
export const MarketPrice = z.object({ id: Uuid, cropId: Uuid, market: z.string(), date: IsoDate, priceXofPerKg: Xof, source: z.string() });
export const MarketPriceCreateBody = z.object({ cropId: Uuid, market: z.string().min(2), date: IsoDate, priceXofPerKg: Xof.min(0), source: z.string().min(2) });

// ---------------------------------------------------------------- planning
export const SEASON_KINDS = ['rainy', 'cold_dry', 'hot_dry'] as const;
export const SEASON_STATUSES = ['planning', 'financing', 'in_progress', 'harvest', 'settlement', 'closed', 'cancelled'] as const;
export const BUDGET_SCOPES = ['block', 'plot', 'per_ha_all', 'per_ha_crop'] as const;
export const BUDGET_PAYERS = ['farmer_credit', 'farmer_cash', 'operator', 'grant'] as const;

export const Season = z
  .object({ id: Uuid, blockId: Uuid, name: z.string(), kind: z.enum(SEASON_KINDS), startDate: IsoDate, endDate: IsoDate, status: z.enum(SEASON_STATUSES), planVersion: z.number().int(), selfFinanced: z.boolean(), stats: z.object({ plantings: z.number().int(), plantedHa: z.number(), budgetXof: Xof }), version: z.number().int(), createdAt: IsoDateTime, allowedActions: AllowedActions })
  .meta({ id: 'Season' });
export const SeasonCreateBody = z.object({ name: z.string().min(2).max(200), kind: z.enum(SEASON_KINDS), startDate: IsoDate, endDate: IsoDate });
export const SeasonUpdateBody = SeasonCreateBody.partial();
export const SeasonStartBody = z.object({ selfFinanced: z.boolean().default(false) });
export const SeasonCancelBody = z.object({ reason: z.string().min(3).max(1000) });

const PlantingFields = z.object({
  plotId: Uuid,
  cropId: Uuid,
  varietyId: Uuid.nullable(),
  templateId: Uuid.nullable(),
  areaHa: z.number().positive(),
  plannedSowingDate: IsoDate.nullable(),
  plannedHarvestDate: IsoDate.nullable(),
  yieldBaseTHa: z.number().min(0).nullable(),
  yieldStressTHa: z.number().min(0).nullable(),
  postHarvestLossPct: Pct.nullable(),
  deliveryRatePct: Pct.nullable(),
  priceXofPerKgBase: Xof.min(0).nullable(),
  priceXofPerKgStress: Xof.min(0).nullable(),
});
export const PlantingCreateBody = PlantingFields.partial().required({ plotId: true, cropId: true });
export const PlantingUpdateBody = PlantingFields.omit({ plotId: true }).partial();
export const BulkAssignBody = z.object({ cropId: Uuid, plotIds: z.array(Uuid).min(1).max(1000), templateId: Uuid.nullable().optional(), plannedSowingDate: IsoDate.nullable().optional(), plannedHarvestDate: IsoDate.nullable().optional(), priceXofPerKgBase: Xof.min(0).nullable().optional() });
export const Planting = z
  .object({
    id: Uuid,
    seasonId: Uuid,
    plotId: Uuid,
    plotCode: z.string(),
    cropId: Uuid,
    cropCode: z.string(),
    varietyId: Uuid.nullable(),
    templateId: Uuid.nullable(),
    areaHa: z.number(),
    plannedSowingDate: IsoDate.nullable(),
    plannedHarvestDate: IsoDate.nullable(),
    yieldBaseTHa: z.number().nullable(),
    yieldStressTHa: z.number().nullable(),
    postHarvestLossPct: z.number().nullable(),
    deliveryRatePct: z.number().nullable(),
    priceXofPerKgBase: Xof.nullable(),
    priceXofPerKgStress: Xof.nullable(),
    priceSource: z.enum(['manual', 'offtake', 'market', 'none']),
    version: z.number().int(),
  })
  .meta({ id: 'Planting' });

const BudgetLineFields = z.object({
  scope: z.enum(BUDGET_SCOPES),
  plotId: Uuid.nullable(),
  cropId: Uuid.nullable(),
  serviceId: Uuid,
  qty: z.number().min(0),
  unit: z.enum(SERVICE_UNITS),
  unitPriceXof: Xof.min(0),
  quoteId: Uuid.nullable(),
  payer: z.enum(BUDGET_PAYERS),
  tranche: z.enum(['seasonal', 'none']),
  plannedDate: IsoDate.nullable(),
  notes: z.string().max(2000).nullable(),
});
export const BudgetLineCreateBody = BudgetLineFields.partial().required({ scope: true, serviceId: true, qty: true, payer: true });
export const BudgetLineUpdateBody = BudgetLineFields.partial();
export const BudgetLine = z
  .object({ id: Uuid, seasonId: Uuid, scope: z.enum(BUDGET_SCOPES), plotId: Uuid.nullable(), cropId: Uuid.nullable(), serviceId: Uuid, serviceName: z.string(), serviceKind: z.enum(SERVICE_KINDS), qty: z.number(), unit: z.enum(SERVICE_UNITS), unitPriceXof: Xof, totalXof: Xof, quoteId: Uuid.nullable(), payer: z.enum(BUDGET_PAYERS), tranche: z.enum(['seasonal', 'none']), plannedDate: IsoDate.nullable(), notes: z.string().nullable(), source: z.string(), version: z.number().int() })
  .meta({ id: 'BudgetLine' });
export const GenerateBudgetBody = z.object({ replace: z.boolean().default(false), payer: z.enum(BUDGET_PAYERS).default('farmer_credit') });
export const BudgetSummary = z
  .object({
    totals: z.object({ farmer_credit: Xof, farmer_cash: Xof, operator: Xof, grant: Xof }),
    plantedHa: z.number(),
    perHaXof: Xof,
    quotedSharePct: z.number(),
    unallocated: z.object({ farmerCreditXof: Xof, farmerCashXof: Xof }),
    farmers: z.array(z.object({ farmerId: Uuid, farmerCode: z.string(), name: z.string(), ha: z.number(), farmerCreditXof: Xof, farmerCashXof: Xof })),
    warnings: z.array(z.object({ code: z.string(), plotId: z.string().optional(), message: z.string() })),
  })
  .meta({ id: 'BudgetSummary' });

export const SupplierQuote = z.object({ id: Uuid, supplierOrgId: Uuid.nullable(), supplierName: z.string(), serviceId: Uuid, unit: z.enum(SERVICE_UNITS), unitPriceXof: Xof, minQty: z.number().nullable(), validUntil: IsoDate, fileId: Uuid.nullable(), private: z.boolean(), createdAt: IsoDateTime }).meta({ id: 'SupplierQuote' });
export const SupplierQuoteCreateBody = z.object({ supplierOrgId: Uuid.nullable().optional(), supplierName: z.string().min(2), serviceId: Uuid, unit: z.enum(SERVICE_UNITS), unitPriceXof: Xof.min(0), minQty: z.number().min(0).nullable().optional(), validUntil: IsoDate, fileId: Uuid.nullable().optional(), private: z.boolean().default(false) });

export const CAPEX_TRANCHES = ['investment', 'equity', 'grant'] as const;
export const CapexItem = z.object({ id: Uuid, blockId: Uuid, description: z.string(), assetType: z.string(), amountXof: Xof, usefulLifeYears: z.number().int(), quoteId: Uuid.nullable(), tranche: z.enum(CAPEX_TRANCHES), plannedDate: IsoDate, version: z.number().int() });
export const CapexCreateBody = z.object({ description: z.string().min(2), assetType: z.string().min(2), amountXof: Xof.min(1), usefulLifeYears: z.number().int().min(1).max(50), quoteId: Uuid.nullable().optional(), tranche: z.enum(CAPEX_TRANCHES), plannedDate: IsoDate });
export const OPEX_KINDS = ['staff', 'fuel', 'maintenance', 'security', 'insurance', 'admin', 'other'] as const;
export const OpexItem = z.object({ id: Uuid, blockId: Uuid, description: z.string(), kind: z.enum(OPEX_KINDS), amountXofPerMonth: Xof, startDate: IsoDate, endDate: IsoDate.nullable(), version: z.number().int() });
export const OpexCreateBody = z.object({ description: z.string().min(2), kind: z.enum(OPEX_KINDS), amountXofPerMonth: Xof.min(0), startDate: IsoDate, endDate: IsoDate.nullable().optional() });
export const FeePolicy = z.object({ id: Uuid, blockId: Uuid, operatorServiceFeeXofPerFarmerSeason: Xof, landFeeXofPerHaSeason: Xof, investmentRecoveryFeeXofPerHaSeason: Xof, effectiveFrom: IsoDate, version: z.number().int() }).meta({ id: 'FeePolicy' });
export const FeePolicyBody = z.object({ operatorServiceFeeXofPerFarmerSeason: Xof.min(0), landFeeXofPerHaSeason: Xof.min(0), investmentRecoveryFeeXofPerHaSeason: Xof.min(0), effectiveFrom: IsoDate.optional() });

// ---------------------------------------------------------------- offtake
export const PRICE_TYPES = ['fixed', 'floor_plus_market', 'formula'] as const;
export const OFFTAKE_STATUSES = ['draft', 'loi', 'signed', 'terminated', 'expired'] as const;
export const QualityGrade = z.object({ grade: z.string().min(1).max(20), adjustmentPct: z.number().min(-100).max(100) });
const OfftakeFields = z.object({
  blockId: Uuid,
  seasonId: Uuid.nullable(),
  buyerOrgId: Uuid,
  cropId: Uuid,
  minVolumeKg: z.number().min(0),
  maxVolumeKg: z.number().min(0),
  priceType: z.enum(PRICE_TYPES),
  priceXofPerKg: Xof.min(0),
  floorXofPerKg: Xof.min(0).nullable(),
  formulaText: z.string().max(2000).nullable(),
  qualitySpec: z.array(QualityGrade),
  paymentTermsDays: z.number().int().min(0).max(365),
  paysIntoEscrow: z.boolean(),
  fileId: Uuid.nullable(),
});
export const OfftakeCreateBody = OfftakeFields.partial().required({ blockId: true, buyerOrgId: true, cropId: true, minVolumeKg: true, maxVolumeKg: true, priceType: true, priceXofPerKg: true, paymentTermsDays: true });
export const OfftakeUpdateBody = OfftakeFields.omit({ blockId: true, buyerOrgId: true }).partial();
export const OfftakeContract = z
  .object({
    id: Uuid,
    ref: z.string(),
    blockId: Uuid,
    blockName: z.string(),
    ownerOrgId: Uuid,
    seasonId: Uuid.nullable(),
    buyerOrgId: Uuid,
    buyerName: z.string(),
    cropId: Uuid,
    cropCode: z.string(),
    minVolumeKg: z.number(),
    maxVolumeKg: z.number(),
    priceType: z.enum(PRICE_TYPES),
    priceXofPerKg: Xof,
    floorXofPerKg: Xof.nullable(),
    formulaText: z.string().nullable(),
    qualitySpec: z.array(QualityGrade),
    paymentTermsDays: z.number().int(),
    paysIntoEscrow: z.boolean(),
    status: z.enum(OFFTAKE_STATUSES),
    fileId: Uuid.nullable(),
    signedAt: IsoDateTime.nullable(),
    version: z.number().int(),
    createdAt: IsoDateTime,
    allowedActions: AllowedActions,
  })
  .meta({ id: 'OfftakeContract' });
export const OfftakeActionBody = z.object({ fileId: Uuid.optional(), reason: z.string().max(1000).optional() });
