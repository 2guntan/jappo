import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, auth, createBlock, createFarmer, createTestApp, expectStatus, json, rectangle, resetDb, setBoundary, signup, type Session, type TestApp } from '../helpers';

let t: TestApp;
let op: Session;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t);
  op = await signup(t);
});

const get = async <T>(s: Session, url: string) => json<T>(await t.app.inject({ method: 'GET', url, headers: auth(s) }));
const crop = async (code: string) => (await get<{ data: { id: string; code: string }[] }>(op, '/v1/crops')).data.find((c) => c.code === code)!;
const service = async (code: string) => (await get<{ data: { id: string; code: string; defaultUnitPriceXof: number }[] }>(op, '/v1/services')).data.find((s) => s.code === code)!;

/** Block in Ziguinchor (zone casamance, drip irrigation) with 3 plots and 3 farmers (F3 shares plot 3 with F2? no: one each). */
async function setup() {
  const b = await createBlock(t, op, { irrigationType: 'drip', waterSource: 'borehole' });
  await setBoundary(t, op, b.id);
  const plots: { id: string; areaHa: number; code: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots`, headers: auth(op), payload: { geometry: rectangle(-16.2699 + i * 0.001, 12.5801, 100, 100) } });
    expectStatus(p, 201);
    plots.push(p.json());
  }
  const fs = [];
  for (let i = 0; i < 3; i++) {
    const f = await createFarmer(t, op, { phone: `+22177000000${i}` });
    fs.push(f);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/plots/${plots[i]!.id}/allocations`, headers: auth(op), payload: { farmerId: f.id } }), 201);
  }
  const s = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/seasons`, headers: auth(op), payload: { name: 'Contre-saison 2026-27', kind: 'cold_dry', startDate: '2026-11-15', endDate: '2027-04-30' } });
  expectStatus(s, 201);
  return { block: b, plots, farmers: fs, season: s.json() as { id: string; version: number } };
}

describe('catalogue', () => {
  it('serves the seeded catalogue and resolves operator overrides', async () => {
    const crops = await get<{ data: { code: string }[] }>(op, '/v1/crops');
    expect(crops.data).toHaveLength(10);
    const services = await get<{ data: unknown[] }>(op, '/v1/services');
    expect(services.data.length).toBeGreaterThanOrEqual(30);
    const maize = await crop('maize');
    const tpl = await get<{ data: { id: string; yieldBaseTHa: number; isOverride: boolean; inputs: unknown[]; version: number }[] }>(op, `/v1/crop-templates?crop=${maize.id}&zone=casamance&irrigated=true`);
    expect(tpl.data).toHaveLength(1);
    expect(tpl.data[0]).toMatchObject({ yieldBaseTHa: 4, isOverride: false });
    expect(tpl.data[0]!.inputs.length).toBeGreaterThan(5);
    const forbid = await t.app.inject({ method: 'PATCH', url: `/v1/crop-templates/${tpl.data[0]!.id}`, headers: auth(op, { 'if-match': '"1"' }), payload: { yieldBaseTHa: 9 } });
    expect(forbid.json().code).toBe('PLATFORM_TEMPLATE');
    const ov = await t.app.inject({ method: 'POST', url: '/v1/crop-templates', headers: auth(op), payload: { cropId: maize.id, zone: 'casamance', irrigated: true, cycleDays: 105, yieldBaseTHa: 4.5, yieldStressTHa: 3.5, postHarvestLossPct: 4 } });
    expectStatus(ov, 201);
    expect(ov.json()).toMatchObject({ isOverride: true, baseTemplateId: tpl.data[0]!.id, deliveryRatePct: 95 });
    const eff = await get<{ data: { yieldBaseTHa: number; isOverride: boolean }[] }>(op, `/v1/crop-templates?crop=${maize.id}&zone=casamance&irrigated=true`);
    expect(eff.data).toEqual([expect.objectContaining({ yieldBaseTHa: 4.5, isOverride: true })]);
    const other = await signup(t, { legalName: 'Autre SARL' });
    const effOther = await get<{ data: { yieldBaseTHa: number }[] }>(other, `/v1/crop-templates?crop=${maize.id}&zone=casamance&irrigated=true`);
    expect(effOther.data[0]!.yieldBaseTHa).toBe(4);
    const admin = await adminSession(t);
    const adm = await t.app.inject({ method: 'PATCH', url: `/v1/crop-templates/${tpl.data[0]!.id}`, headers: auth(admin, { 'if-match': '"1"' }), payload: { notes: 'Révisé 2026' } });
    expectStatus(adm, 200);
    const bad = await t.app.inject({ method: 'POST', url: '/v1/crop-templates', headers: auth(op), payload: { cropId: maize.id, zone: 'niayes', irrigated: true, cycleDays: 105, yieldBaseTHa: 2, yieldStressTHa: 3, postHarvestLossPct: 4 } });
    expect(bad.json().code).toBe('STRESS_ABOVE_BASE');
  });
});

describe('seasons, plantings and budget', () => {
  it('plants maize in bulk with template yields and offtake/market prices', async () => {
    const { block, plots, season } = await setup();
    const maize = await crop('maize');
    const bulk = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/plantings/actions/bulk-assign`, headers: auth(op), payload: { cropId: maize.id, plotIds: plots.map((p) => p.id), plannedHarvestDate: '2027-03-15' } });
    expectStatus(bulk, 201);
    expect(bulk.json().created).toBe(3);
    const again = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/plantings/actions/bulk-assign`, headers: auth(op), payload: { cropId: maize.id, plotIds: plots.map((p) => p.id) } });
    expect(again.json().created).toBe(0);
    let pl = (await get<{ data: { yieldBaseTHa: number; yieldStressTHa: number; postHarvestLossPct: number; deliveryRatePct: number; priceXofPerKgBase: number; priceXofPerKgStress: number; priceSource: string; areaHa: number }[] }>(op, `/v1/seasons/${season.id}/plantings`)).data;
    expect(pl[0]).toMatchObject({ yieldBaseTHa: 4, yieldStressTHa: 3.2, postHarvestLossPct: 5, deliveryRatePct: 95, priceXofPerKgBase: 230, priceXofPerKgStress: 196, priceSource: 'market' });
    expect(pl[0]!.areaHa).toBeCloseTo(plots[0]!.areaHa, 4);
    // Offtake LOI at 250 XOF/kg becomes the default price; stress = 250 × 0.85 = 212.5 → 212 (half-even)
    const buyer = await signup(t, { orgType: 'buyer', legalName: 'Agro-Négoce Zeta SA', legalForm: 'SA' });
    const c = await t.app.inject({ method: 'POST', url: '/v1/offtake-contracts', headers: auth(op), payload: { blockId: block.id, buyerOrgId: buyer.orgId, cropId: maize.id, minVolumeKg: 9000, maxVolumeKg: 12000, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30, qualitySpec: [{ grade: 'A', adjustmentPct: 0 }, { grade: 'B', adjustmentPct: -10 }] } });
    expectStatus(c, 201);
    pl = (await get<typeof pl extends (infer U)[] ? { data: U[] } : never>(op, `/v1/seasons/${season.id}/plantings`)).data;
    expect(pl[0]!.priceSource).toBe('market'); // draft contracts do not count
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/offtake-contracts/${c.json().id}/actions/mark-loi`, headers: auth(op, { 'if-match': '"1"' }), payload: {} }), 200);
    pl = (await get<{ data: typeof pl }>(op, `/v1/seasons/${season.id}/plantings`)).data;
    expect(pl[0]).toMatchObject({ priceXofPerKgBase: 250, priceXofPerKgStress: 212, priceSource: 'offtake' });
    const tooBig = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/plantings`, headers: auth(op), payload: { plotId: plots[0]!.id, cropId: (await crop('onion')).id, areaHa: 0.5 } });
    expect(tooBig.json().code).toBe('PLANTING_AREA_EXCEEDS_PLOT');
  });

  it('generates the budget from templates (cheapest valid quote) and allocates it per farmer', async () => {
    const { block, plots, farmers, season } = await setup();
    const maize = await crop('maize');
    await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/plantings/actions/bulk-assign`, headers: auth(op), payload: { cropId: maize.id, plotIds: plots.map((p) => p.id) } });
    const npk = await service('npk_15_15_15');
    for (const [price, until] of [[430, '2027-06-30'], [410, '2026-01-01'], [440, '2027-06-30']] as const) {
      expectStatus(await t.app.inject({ method: 'POST', url: '/v1/supplier-quotes', headers: auth(op), payload: { supplierName: 'Intrants Eta', serviceId: npk.id, unit: 'kg', unitPriceXof: price, validUntil: until } }), 201);
    }
    const gen = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/budget-lines/actions/generate-from-templates`, headers: auth(op), payload: {} });
    expectStatus(gen, 201);
    const lines = gen.json().data as { serviceId: string; unitPriceXof: number; qty: number; scope: string; quoteId: string | null; totalXof: number; tranche: string }[];
    expect(gen.json().created).toBe(11);
    const npkLine = lines.find((l) => l.serviceId === npk.id)!;
    expect(npkLine).toMatchObject({ unitPriceXof: 430, scope: 'per_ha_crop', tranche: 'seasonal' });
    expect(npkLine.quoteId).toBeTruthy();
    expect((await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/budget-lines/actions/generate-from-templates`, headers: auth(op), payload: {} })).json().code).toBe('TEMPLATE_LINES_EXIST');
    // Plot-scoped and block-scoped lines
    const ploughing = await service('ploughing');
    const training = await service('farmer_training');
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/budget-lines`, headers: auth(op), payload: { scope: 'plot', plotId: plots[0]!.id, serviceId: ploughing.id, qty: 1, unitPriceXof: 20001, payer: 'farmer_credit' } }), 201);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/budget-lines`, headers: auth(op), payload: { scope: 'block', serviceId: training.id, qty: 3, payer: 'operator', notes: 'interne' } }), 201);
    const sum = await get<{ totals: Record<string, number>; farmers: { farmerId: string; farmerCreditXof: number; ha: number }[]; plantedHa: number; quotedSharePct: number }>(op, `/v1/seasons/${season.id}/budget-summary`);
    // Manual calculation: per-ha template total × farmer area (rounded per line), plus the plot line for F1
    const perHaLines = lines.filter((l) => l.scope === 'per_ha_crop');
    const expected = farmers.map((f, i) => perHaLines.reduce((s, l) => s + Math.round(l.qty * l.unitPriceXof * plots[i]!.areaHa), 0) + (i === 0 ? 20001 : 0));
    for (const [i, f] of farmers.entries()) {
      const got = sum.farmers.find((x) => x.farmerId === f.id)!;
      expect(Math.abs(got.farmerCreditXof - expected[i]!)).toBeLessThanOrEqual(perHaLines.length); // at most 1 XOF residual per line
      expect(got.ha).toBeCloseTo(plots[i]!.areaHa, 4);
    }
    expect(sum.farmers.reduce((s, f) => s + f.farmerCreditXof, 0)).toBe(sum.totals.farmer_credit);
    expect(sum.totals.operator).toBe(30000);
    expect(sum.quotedSharePct).toBeGreaterThan(0);
    const lender = await signup(t, { orgType: 'lender', lenderKind: 'sfd', legalName: 'Mutuelle Alpha SFD', legalForm: 'mutuelle' });
    const { grant } = await import('../../src/core/authz/visibility');
    await t.ctx.db.transaction((tx) => grant(tx, { resourceType: 'block', resourceId: block.id, granteeOrgId: lender.orgId!, scope: 'read', grantedByEvent: 'test' }));
    const lenderLines = await get<{ data: { notes: string | null }[] }>(lender, `/v1/seasons/${season.id}/budget-lines`);
    expect(lenderLines.data.every((l) => l.notes === null)).toBe(true);
  });

  it('starts a self-financed season and then locks the plan', async () => {
    const { plots, season } = await setup();
    const noPlant = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/actions/start`, headers: auth(op, { 'if-match': `"${season.version}"` }), payload: { selfFinanced: true } });
    expect(noPlant.json().code).toBe('NO_PLANTINGS');
    const maize = await crop('maize');
    await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/plantings`, headers: auth(op), payload: { plotId: plots[0]!.id, cropId: maize.id } });
    const cur = await get<{ version: number; allowedActions: string[] }>(op, `/v1/seasons/${season.id}`);
    expect(cur.allowedActions).toContain('start');
    const noFin = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/actions/start`, headers: auth(op, { 'if-match': `"${cur.version}"` }), payload: {} });
    expect(noFin.json().code).toBe('DISBURSEMENT_REQUIRED');
    const ok = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/actions/start`, headers: auth(op, { 'if-match': `"${cur.version}"` }), payload: { selfFinanced: true } });
    expectStatus(ok, 200);
    expect(ok.json()).toMatchObject({ status: 'in_progress', selfFinanced: true });
    const locked = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/plantings`, headers: auth(op), payload: { plotId: plots[1]!.id, cropId: maize.id } });
    expect(locked.json().code).toBe('SEASON_LOCKED');
    const cancel = await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/actions/cancel`, headers: auth(op, { 'if-match': `"${ok.json().version}"` }), payload: { reason: 'Inondation' } });
    expect(cancel.json().code).toBe('INVALID_STATE_TRANSITION');
  });

  it('manages capex, opex and the fee policy (history kept)', async () => {
    const { block } = await setup();
    expect((await t.app.inject({ method: 'GET', url: `/v1/blocks/${block.id}/fee-policy`, headers: auth(op) })).statusCode).toBe(404);
    const f1 = await t.app.inject({ method: 'PUT', url: `/v1/blocks/${block.id}/fee-policy`, headers: auth(op), payload: { operatorServiceFeeXofPerFarmerSeason: 50000, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 100000 } });
    expectStatus(f1, 200);
    await t.app.inject({ method: 'PUT', url: `/v1/blocks/${block.id}/fee-policy`, headers: auth(op), payload: { operatorServiceFeeXofPerFarmerSeason: 45000, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 100000 } });
    expect((await get<{ operatorServiceFeeXofPerFarmerSeason: number }>(op, `/v1/blocks/${block.id}/fee-policy`)).operatorServiceFeeXofPerFarmerSeason).toBe(45000);
    const capex = await t.app.inject({ method: 'POST', url: `/v1/blocks/${block.id}/capex-items`, headers: auth(op), payload: { description: 'Forage + pompe solaire', assetType: 'solar_pump', amountXof: 10000000, usefulLifeYears: 10, tranche: 'investment', plannedDate: '2026-12-01' } });
    expectStatus(capex, 201);
    const opex = await t.app.inject({ method: 'POST', url: `/v1/blocks/${block.id}/operator-opex`, headers: auth(op), payload: { description: 'Gardiennage', kind: 'security', amountXofPerMonth: 75000, startDate: '2026-11-01' } });
    expectStatus(opex, 201);
    expect((await get<{ data: unknown[] }>(op, `/v1/blocks/${block.id}/capex-items`)).data).toHaveLength(1);
    expectStatus(await t.app.inject({ method: 'DELETE', url: `/v1/operator-opex/${opex.json().id}`, headers: auth(op) }), 200);
    expect((await get<{ data: unknown[] }>(op, `/v1/blocks/${block.id}/operator-opex`)).data).toHaveLength(0);
  });
});

describe('offtake', () => {
  it('runs the contract lifecycle; the buyer sees its contracts; strangers do not', async () => {
    const { block } = await setup();
    const maize = await crop('maize');
    const buyer = await signup(t, { orgType: 'buyer', legalName: 'Agro-Négoce Zeta SA', legalForm: 'SA' });
    const notBuyer = await signup(t, { orgType: 'lender', lenderKind: 'bank', legalName: 'Banque Beta SA', legalForm: 'SA' });
    const bad = await t.app.inject({ method: 'POST', url: '/v1/offtake-contracts', headers: auth(op), payload: { blockId: block.id, buyerOrgId: notBuyer.orgId, cropId: maize.id, minVolumeKg: 1, maxVolumeKg: 2, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30 } });
    expect(bad.json().code).toBe('BUYER_NOT_FOUND');
    const range = await t.app.inject({ method: 'POST', url: '/v1/offtake-contracts', headers: auth(op), payload: { blockId: block.id, buyerOrgId: buyer.orgId, cropId: maize.id, minVolumeKg: 10, maxVolumeKg: 2, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30 } });
    expect(range.json().code).toBe('VOLUME_RANGE_INVALID');
    const c = json<{ id: string; ref: string; status: string; allowedActions: string[] }>(
      await t.app.inject({ method: 'POST', url: '/v1/offtake-contracts', headers: auth(op), payload: { blockId: block.id, buyerOrgId: buyer.orgId, cropId: maize.id, minVolumeKg: 9000, maxVolumeKg: 12000, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30 } }),
    );
    expect(c.ref).toMatch(/^OFT-\d{4}-0001$/);
    expect(c.allowedActions).toEqual(['update', 'mark_loi', 'mark_signed']);
    const signed = await t.app.inject({ method: 'POST', url: `/v1/offtake-contracts/${c.id}/actions/mark-signed`, headers: auth(op, { 'if-match': '"1"' }), payload: {} });
    expect(signed.json()).toMatchObject({ status: 'signed' });
    expect(signed.json().signedAt).toBeTruthy();
    const edit = await t.app.inject({ method: 'PATCH', url: `/v1/offtake-contracts/${c.id}`, headers: auth(op, { 'if-match': '"2"' }), payload: { priceXofPerKg: 260 } });
    expect(edit.json().code).toBe('OFFTAKE_LOCKED');
    const bc = await get<{ data: { id: string; buyerName: string }[] }>(buyer, '/v1/buyer/contracts');
    expect(bc.data.map((x) => x.id)).toEqual([c.id]);
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/offtake-contracts/${c.id}`, headers: auth(buyer) }), 200);
    expect((await t.app.inject({ method: 'POST', url: `/v1/offtake-contracts/${c.id}/actions/terminate`, headers: auth(buyer, { 'if-match': '"2"' }), payload: { reason: 'x' } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: `/v1/offtake-contracts/${c.id}`, headers: auth(notBuyer) })).statusCode).toBe(404);
    expect((await get<{ data: unknown[] }>(notBuyer, '/v1/offtake-contracts')).data).toHaveLength(0);
    expect((await t.app.inject({ method: 'POST', url: `/v1/offtake-contracts/${c.id}/actions/terminate`, headers: auth(op, { 'if-match': '"2"' }), payload: {} })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: `/v1/offtake-contracts/${c.id}/actions/terminate`, headers: auth(op, { 'if-match': '"2"' }), payload: { reason: 'Acheteur défaillant' } })).json().status).toBe('terminated');
  });
});
