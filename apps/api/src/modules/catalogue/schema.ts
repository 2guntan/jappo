import { bigint, boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { stdCols } from '../../db/columns';

export const cropCategory = pgEnum('crop_category', ['cereal', 'vegetable', 'legume', 'root', 'fruit', 'oilseed', 'other']);
export const serviceKind = pgEnum('service_kind', ['seed', 'fertiliser', 'crop_protection', 'mechanisation', 'irrigation_opex', 'labour', 'training', 'transport', 'storage', 'insurance_premium', 'land_fee', 'operator_service_fee', 'investment_recovery_fee', 'platform_fee', 'other']);
export const serviceUnit = pgEnum('service_unit', ['kg', 'l', 'ha', 'hour', 'day', 'unit', 'season', 'bag']);

export const zones = pgTable('zones', { ...stdCols(), code: text().notNull().unique(), name: text().notNull(), regionList: text().array().notNull() });

export const crops = pgTable('crops', {
  ...stdCols(),
  code: text().notNull().unique(),
  nameFr: text().notNull(),
  nameEn: text().notNull(),
  category: cropCategory().notNull(),
  perishable: boolean().notNull().default(false),
});

export const cropVarieties = pgTable('crop_varieties', { ...stdCols(), cropId: uuid().notNull().references(() => crops.id), name: text().notNull(), cycleDays: integer() }, (t) => [uniqueIndex().on(t.cropId, t.name)]);

export interface TemplateInput {
  serviceId: string;
  qtyPerHa: number;
  unit: 'kg' | 'l' | 'ha' | 'hour' | 'day' | 'unit' | 'season' | 'bag';
}

export const cropTemplates = pgTable(
  'crop_templates',
  {
    ...stdCols(),
    ownerOrgId: uuid(),
    baseTemplateId: uuid(),
    cropId: uuid().notNull().references(() => crops.id),
    varietyId: uuid(),
    zone: text().notNull(),
    irrigated: boolean().notNull(),
    cycleDays: integer().notNull(),
    yieldBaseTHa: numeric({ precision: 10, scale: 3 }).notNull(),
    yieldStressTHa: numeric({ precision: 10, scale: 3 }).notNull(),
    postHarvestLossPct: numeric({ precision: 7, scale: 4 }).notNull(),
    deliveryRatePct: numeric({ precision: 7, scale: 4 }).notNull().default('95'),
    waterM3Ha: numeric({ precision: 12, scale: 2 }),
    labourDaysHa: numeric({ precision: 10, scale: 2 }),
    inputs: jsonb().$type<TemplateInput[]>().notNull().default([]),
    notes: text(),
  },
  (t) => [
    index().on(t.cropId, t.zone, t.irrigated),
    uniqueIndex('crop_templates_platform_uq').on(t.cropId, t.zone, t.irrigated).where(sql`owner_org_id is null and variety_id is null`),
    uniqueIndex('crop_templates_override_uq').on(t.ownerOrgId, t.cropId, t.zone, t.irrigated).where(sql`owner_org_id is not null and variety_id is null`),
  ],
);

export const serviceCatalog = pgTable(
  'service_catalog',
  {
    ...stdCols(),
    ownerOrgId: uuid(),
    code: text().notNull(),
    nameFr: text().notNull(),
    nameEn: text().notNull(),
    kind: serviceKind().notNull(),
    unit: serviceUnit().notNull(),
    defaultUnitPriceXof: bigint({ mode: 'number' }).notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex('service_platform_code_uq').on(t.code).where(sql`owner_org_id is null`), uniqueIndex('service_org_code_uq').on(t.ownerOrgId, t.code).where(sql`owner_org_id is not null`)],
);

export const marketPrices = pgTable(
  'market_prices',
  { ...stdCols(), cropId: uuid().notNull().references(() => crops.id), market: text().notNull(), date: date({ mode: 'string' }).notNull(), priceXofPerKg: bigint({ mode: 'number' }).notNull(), source: text().notNull() },
  (t) => [index().on(t.cropId, t.date)],
);
