import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { crops, cropTemplates, marketPrices, serviceCatalog, zones, type TemplateInput } from '../modules/catalogue/schema';

type Unit = TemplateInput['unit'];
type Kind = typeof serviceCatalog.$inferInsert.kind;

export const ZONES = [
  { code: 'casamance', name: 'Casamance', regionList: ['Ziguinchor', 'Sédhiou', 'Kolda'] },
  { code: 'niayes', name: 'Niayes', regionList: ['Dakar', 'Thiès', 'Louga'] },
  { code: 'vallee', name: 'Vallée du fleuve Sénégal', regionList: ['Saint-Louis', 'Matam'] },
  { code: 'bassin_arachidier', name: 'Bassin arachidier', regionList: ['Kaolack', 'Kaffrine', 'Fatick', 'Diourbel'] },
];

export const CROPS = [
  { code: 'maize', nameFr: 'Maïs', nameEn: 'Maize', category: 'cereal', perishable: false },
  { code: 'rice', nameFr: 'Riz', nameEn: 'Rice', category: 'cereal', perishable: false },
  { code: 'onion', nameFr: 'Oignon', nameEn: 'Onion', category: 'vegetable', perishable: true },
  { code: 'tomato', nameFr: 'Tomate', nameEn: 'Tomato', category: 'vegetable', perishable: true },
  { code: 'groundnut', nameFr: 'Arachide', nameEn: 'Groundnut', category: 'oilseed', perishable: false },
  { code: 'millet', nameFr: 'Mil', nameEn: 'Millet', category: 'cereal', perishable: false },
  { code: 'sorghum', nameFr: 'Sorgho', nameEn: 'Sorghum', category: 'cereal', perishable: false },
  { code: 'cowpea', nameFr: 'Niébé', nameEn: 'Cowpea', category: 'legume', perishable: false },
  { code: 'potato', nameFr: 'Pomme de terre', nameEn: 'Potato', category: 'root', perishable: true },
  { code: 'chilli', nameFr: 'Piment', nameEn: 'Chilli', category: 'vegetable', perishable: true },
] as const;

export const SERVICES: { code: string; nameFr: string; nameEn: string; kind: Kind; unit: Unit; price: number }[] = [
  { code: 'seed_maize', nameFr: 'Semence de maïs', nameEn: 'Maize seed', kind: 'seed', unit: 'kg', price: 1500 },
  { code: 'seed_rice', nameFr: 'Semence de riz', nameEn: 'Rice seed', kind: 'seed', unit: 'kg', price: 600 },
  { code: 'seed_onion', nameFr: "Semence d'oignon", nameEn: 'Onion seed', kind: 'seed', unit: 'kg', price: 40000 },
  { code: 'seed_tomato', nameFr: 'Semence de tomate', nameEn: 'Tomato seed', kind: 'seed', unit: 'kg', price: 120000 },
  { code: 'seed_groundnut', nameFr: "Semence d'arachide", nameEn: 'Groundnut seed', kind: 'seed', unit: 'kg', price: 700 },
  { code: 'seed_millet', nameFr: 'Semence de mil', nameEn: 'Millet seed', kind: 'seed', unit: 'kg', price: 500 },
  { code: 'seed_sorghum', nameFr: 'Semence de sorgho', nameEn: 'Sorghum seed', kind: 'seed', unit: 'kg', price: 500 },
  { code: 'seed_cowpea', nameFr: 'Semence de niébé', nameEn: 'Cowpea seed', kind: 'seed', unit: 'kg', price: 800 },
  { code: 'seed_potato', nameFr: 'Plant de pomme de terre', nameEn: 'Seed potato', kind: 'seed', unit: 'kg', price: 650 },
  { code: 'seed_chilli', nameFr: 'Semence de piment', nameEn: 'Chilli seed', kind: 'seed', unit: 'kg', price: 150000 },
  { code: 'npk_15_15_15', nameFr: 'Engrais NPK 15-15-15', nameEn: 'NPK 15-15-15 fertiliser', kind: 'fertiliser', unit: 'kg', price: 450 },
  { code: 'urea', nameFr: 'Urée 46 %', nameEn: 'Urea 46 %', kind: 'fertiliser', unit: 'kg', price: 400 },
  { code: 'dap', nameFr: 'DAP 18-46-0', nameEn: 'DAP 18-46-0', kind: 'fertiliser', unit: 'kg', price: 500 },
  { code: 'organic_manure', nameFr: 'Fumure organique', nameEn: 'Organic manure', kind: 'fertiliser', unit: 'kg', price: 50 },
  { code: 'herbicide', nameFr: 'Herbicide', nameEn: 'Herbicide', kind: 'crop_protection', unit: 'l', price: 6000 },
  { code: 'insecticide', nameFr: 'Insecticide', nameEn: 'Insecticide', kind: 'crop_protection', unit: 'l', price: 9000 },
  { code: 'fungicide', nameFr: 'Fongicide', nameEn: 'Fungicide', kind: 'crop_protection', unit: 'kg', price: 8000 },
  { code: 'ploughing', nameFr: 'Labour mécanisé', nameEn: 'Mechanised ploughing', kind: 'mechanisation', unit: 'ha', price: 35000 },
  { code: 'harrowing', nameFr: 'Hersage', nameEn: 'Harrowing', kind: 'mechanisation', unit: 'ha', price: 25000 },
  { code: 'mechanical_harvest', nameFr: 'Récolte mécanisée', nameEn: 'Mechanised harvest', kind: 'mechanisation', unit: 'ha', price: 40000 },
  { code: 'threshing', nameFr: 'Battage', nameEn: 'Threshing', kind: 'mechanisation', unit: 'hour', price: 15000 },
  { code: 'irrigation_water', nameFr: "Eau d'irrigation (pompage)", nameEn: 'Irrigation water (pumping)', kind: 'irrigation_opex', unit: 'ha', price: 30000 },
  { code: 'irrigation_fuel', nameFr: 'Carburant motopompe', nameEn: 'Pump fuel', kind: 'irrigation_opex', unit: 'l', price: 900 },
  { code: 'casual_labour', nameFr: "Main-d'œuvre journalière", nameEn: 'Casual labour', kind: 'labour', unit: 'day', price: 2500 },
  { code: 'farmer_training', nameFr: 'Formation des producteurs', nameEn: 'Farmer training', kind: 'training', unit: 'season', price: 10000 },
  { code: 'transport_to_gate', nameFr: 'Transport bord-champ → magasin', nameEn: 'Field-to-store transport', kind: 'transport', unit: 'unit', price: 5000 },
  { code: 'storage_bags', nameFr: 'Sacs de stockage', nameEn: 'Storage bags', kind: 'storage', unit: 'bag', price: 500 },
  { code: 'crop_insurance', nameFr: 'Prime assurance récolte', nameEn: 'Crop insurance premium', kind: 'insurance_premium', unit: 'ha', price: 15000 },
  { code: 'land_fee', nameFr: 'Redevance foncière', nameEn: 'Land fee', kind: 'land_fee', unit: 'ha', price: 0 },
  { code: 'operator_service_fee', nameFr: "Frais de service de l'opérateur", nameEn: 'Operator service fee', kind: 'operator_service_fee', unit: 'season', price: 50000 },
  { code: 'investment_recovery_fee', nameFr: "Redevance de récupération d'investissement", nameEn: 'Investment recovery fee', kind: 'investment_recovery_fee', unit: 'ha', price: 100000 },
  { code: 'platform_fee', nameFr: 'Frais de plateforme', nameEn: 'Platform fee', kind: 'platform_fee', unit: 'ha', price: 5000 },
];

/** Agronomic defaults per crop (irrigated / rainfed). Inputs reference service codes, quantities per ha. */
const TEMPLATES: Record<string, { cycle: number; loss: number; irrigated?: [number, number]; rainfed?: [number, number]; inputs: [string, number][]; water?: number; labour?: number }> = {
  maize: { cycle: 110, loss: 5, irrigated: [4.0, 3.2], rainfed: [2.5, 2.0], water: 5000, labour: 27, inputs: [['seed_maize', 25], ['npk_15_15_15', 200], ['urea', 150], ['herbicide', 3], ['insecticide', 2], ['ploughing', 1], ['harrowing', 1], ['irrigation_water', 1], ['casual_labour', 27], ['mechanical_harvest', 1], ['storage_bags', 60]] },
  rice: { cycle: 120, loss: 6, irrigated: [6.0, 4.8], rainfed: [2.0, 1.6], water: 12000, labour: 40, inputs: [['seed_rice', 100], ['npk_15_15_15', 200], ['urea', 200], ['herbicide', 4], ['ploughing', 1], ['irrigation_water', 1], ['casual_labour', 40], ['mechanical_harvest', 1], ['storage_bags', 100]] },
  onion: { cycle: 120, loss: 15, irrigated: [25, 20], water: 6000, labour: 80, inputs: [['seed_onion', 4], ['npk_15_15_15', 400], ['urea', 150], ['organic_manure', 5000], ['fungicide', 3], ['insecticide', 2], ['irrigation_water', 1], ['casual_labour', 80], ['storage_bags', 500]] },
  tomato: { cycle: 100, loss: 20, irrigated: [30, 24], water: 6500, labour: 90, inputs: [['seed_tomato', 0.3], ['npk_15_15_15', 400], ['urea', 150], ['organic_manure', 5000], ['fungicide', 4], ['insecticide', 3], ['irrigation_water', 1], ['casual_labour', 90]] },
  groundnut: { cycle: 90, loss: 6, irrigated: [2.5, 2.0], rainfed: [1.2, 0.96], labour: 30, inputs: [['seed_groundnut', 120], ['npk_15_15_15', 150], ['ploughing', 1], ['casual_labour', 30], ['storage_bags', 40]] },
  millet: { cycle: 90, loss: 5, rainfed: [1.0, 0.8], labour: 20, inputs: [['seed_millet', 5], ['npk_15_15_15', 100], ['urea', 50], ['casual_labour', 20], ['storage_bags', 20]] },
  sorghum: { cycle: 110, loss: 5, rainfed: [1.2, 0.96], labour: 22, inputs: [['seed_sorghum', 8], ['npk_15_15_15', 100], ['urea', 50], ['casual_labour', 22], ['storage_bags', 25]] },
  cowpea: { cycle: 70, loss: 8, rainfed: [0.8, 0.64], labour: 18, inputs: [['seed_cowpea', 25], ['dap', 50], ['insecticide', 2], ['casual_labour', 18], ['storage_bags', 16]] },
  potato: { cycle: 100, loss: 12, irrigated: [25, 20], water: 5000, labour: 70, inputs: [['seed_potato', 2000], ['npk_15_15_15', 500], ['urea', 100], ['fungicide', 4], ['irrigation_water', 1], ['casual_labour', 70], ['storage_bags', 500]] },
  chilli: { cycle: 150, loss: 15, irrigated: [12, 9.6], water: 7000, labour: 100, inputs: [['seed_chilli', 0.25], ['npk_15_15_15', 300], ['urea', 100], ['organic_manure', 4000], ['fungicide', 3], ['insecticide', 3], ['irrigation_water', 1], ['casual_labour', 100]] },
};

export const MARKET_PRICES: Record<string, number> = { maize: 230, rice: 280, onion: 300, tomato: 250, groundnut: 350, millet: 220, sorghum: 210, cowpea: 450, potato: 320, chilli: 900 };

/** Idempotent seed of the platform catalogue (SPEC §16). */
export async function seedCatalogue(db: Db): Promise<void> {
  for (const z of ZONES) await db.insert(zones).values(z).onConflictDoNothing();
  for (const c of CROPS) await db.insert(crops).values({ ...c }).onConflictDoNothing();
  for (const s of SERVICES) {
    const [ex] = await db.select({ id: serviceCatalog.id }).from(serviceCatalog).where(and(eq(serviceCatalog.code, s.code), isNull(serviceCatalog.ownerOrgId)));
    if (!ex) await db.insert(serviceCatalog).values({ code: s.code, nameFr: s.nameFr, nameEn: s.nameEn, kind: s.kind, unit: s.unit, defaultUnitPriceXof: s.price });
  }
  const cropRows = await db.select().from(crops);
  const svcRows = await db.select().from(serviceCatalog).where(isNull(serviceCatalog.ownerOrgId));
  const svc = new Map(svcRows.map((s) => [s.code, s]));
  for (const [code, t] of Object.entries(TEMPLATES)) {
    const crop = cropRows.find((c) => c.code === code)!;
    const inputs = t.inputs.map(([sc, qty]) => ({ serviceId: svc.get(sc)!.id, qtyPerHa: qty, unit: svc.get(sc)!.unit }));
    for (const zone of ZONES) {
      for (const [irrigated, y] of [[true, t.irrigated], [false, t.rainfed]] as const) {
        if (!y) continue;
        const [ex] = await db.select({ id: cropTemplates.id }).from(cropTemplates).where(and(isNull(cropTemplates.ownerOrgId), eq(cropTemplates.cropId, crop.id), eq(cropTemplates.zone, zone.code), eq(cropTemplates.irrigated, irrigated)));
        if (ex) continue;
        await db.insert(cropTemplates).values({
          cropId: crop.id,
          zone: zone.code,
          irrigated,
          cycleDays: t.cycle,
          yieldBaseTHa: String(y[0]),
          yieldStressTHa: String(y[1]),
          postHarvestLossPct: String(t.loss),
          deliveryRatePct: '95',
          waterM3Ha: irrigated && t.water ? String(t.water) : null,
          labourDaysHa: t.labour ? String(t.labour) : null,
          inputs: irrigated ? inputs : inputs.filter((i) => svc.get('irrigation_water')!.id !== i.serviceId),
        });
      }
    }
    const [mp] = await db.select({ id: marketPrices.id }).from(marketPrices).where(eq(marketPrices.cropId, crop.id));
    if (!mp) await db.insert(marketPrices).values({ cropId: crop.id, market: 'Ziguinchor', date: '2026-10-01', priceXofPerKg: MARKET_PRICES[code]!, source: 'Jappo référence (indicatif)' });
  }
}
