import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PDF_BYTES, adminSession, auth, createBlock, createFarmer, createTestApp, expectStatus, json, multipartBody, rectangle, resetDb, setBoundary, signup, type Session, type TestApp } from '../helpers';

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

const plotsOf = async (blockId: string) => json<{ data: { id: string; code: string; areaHa: number; status: string; version: number; farmers: unknown[]; allocatedPct: number }[] }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${blockId}/plots`, headers: auth(op) })).data;

describe('blocks and boundary', () => {
  it('creates a block with a ref, sets a boundary with computed area', async () => {
    const b = await createBlock(t, op);
    expect(b.ref).toMatch(/^BLK-\d{4}-0001$/);
    expect(b.status).toBe('draft');
    const after = await setBoundary(t, op, b.id);
    expect(after.areaHa).toBeGreaterThan(9.9);
    expect(after.areaHa).toBeLessThan(10.1);
    const invalid = await t.app.inject({ method: 'PUT', url: `/v1/blocks/${b.id}/boundary`, headers: auth(op, { 'if-match': `"${after.version}"` }), payload: { geometry: { type: 'Point', coordinates: [0, 0] } } });
    expect(invalid.statusCode).toBe(400);
    const map = json<{ features: { properties: { kind: string } }[] }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${b.id}/map`, headers: auth(op) }));
    expect(map.features[0]!.properties.kind).toBe('boundary');
    const lender = await signup(t, { orgType: 'lender', lenderKind: 'bank', legalName: 'Banque Beta SA', legalForm: 'SA' });
    expect((await t.app.inject({ method: 'POST', url: '/v1/blocks', headers: auth(lender), payload: { name: 'X', region: 'Y', tenureType: 'bail' } })).statusCode).toBe(403);
  });

  it('imports the boundary from an uploaded GeoJSON or KML file', async () => {
    const b = await createBlock(t, op);
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: rectangle() }] };
    const mp = multipartBody({}, { name: 'boundary.geojson', content: Buffer.from(JSON.stringify(fc)) });
    const f = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(op), ...mp.headers }, payload: mp.payload }));
    const r = await t.app.inject({ method: 'PUT', url: `/v1/blocks/${b.id}/boundary`, headers: auth(op, { 'if-match': '"1"' }), payload: { fileId: f.id } });
    expectStatus(r, 200);
    expect(r.json().areaHa).toBeGreaterThan(9.9);
    const ring = rectangle(-16.3, 12.6, 100, 100).coordinates[0]!.map((p) => p.join(',')).join(' ');
    const kml = `<?xml version="1.0"?><kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    const b2 = await createBlock(t, op, { name: 'Bloc KML' });
    const mp2 = multipartBody({}, { name: 'b.kml', content: Buffer.from(kml) });
    const f2 = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(op), ...mp2.headers }, payload: mp2.payload }));
    const r2 = await t.app.inject({ method: 'PUT', url: `/v1/blocks/${b2.id}/boundary`, headers: auth(op, { 'if-match': '"1"' }), payload: { fileId: f2.id } });
    expectStatus(r2, 200);
    expect(r2.json().areaHa).toBeCloseTo(1, 1);
  });
});

describe('plots and allocations', () => {
  it('auto-grids 20 plots of ~0.5 ha, then rejects overlapping / outside plots', async () => {
    const b = await createBlock(t, op);
    const noBoundary = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots/actions/auto-grid`, headers: auth(op), payload: { count: 20 } });
    expect(noBoundary.json().code).toBe('BOUNDARY_REQUIRED');
    await setBoundary(t, op, b.id);
    const grid = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots/actions/auto-grid`, headers: auth(op), payload: { targetAreaHa: 0.5 } });
    expectStatus(grid, 201);
    const ps = grid.json().data as { code: string; areaHa: number }[];
    expect(ps).toHaveLength(20);
    expect(ps[0]!.code).toBe('P-001');
    for (const p of ps) expect(Math.abs(p.areaHa - 0.5)).toBeLessThan(0.01);
    const total = ps.reduce((s, p) => s + p.areaHa, 0);
    const block = json<{ areaHa: number; status: string; stats: { plots: number } }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${b.id}`, headers: auth(op) }));
    expect(Math.abs(total - block.areaHa)).toBeLessThan(0.01);
    expect(block.status).toBe('documenting');
    expect(block.stats.plots).toBe(20);
    expect((await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots/actions/auto-grid`, headers: auth(op), payload: { count: 2 } })).json().code).toBe('PLOTS_EXIST');
    const overlap = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots`, headers: auth(op), payload: { geometry: rectangle(-16.2699, 12.5801, 50, 50) } });
    expect(overlap.json().code).toBe('PLOT_OVERLAP');
    const outside = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots`, headers: auth(op), payload: { geometry: rectangle(-16.0, 12.0, 50, 50) } });
    expect(outside.json().code).toBe('PLOT_OUTSIDE_BOUNDARY');
  });

  it('creates plots manually, allocates farmers within 100 %, ends allocations', async () => {
    const b = await createBlock(t, op);
    await setBoundary(t, op, b.id);
    const p = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots`, headers: auth(op), payload: { geometry: rectangle(-16.2699, 12.5801, 100, 100), soilType: 'sableux' } });
    expectStatus(p, 201);
    expect(p.json()).toMatchObject({ code: 'P-001', soilType: 'sableux' });
    expect(p.json().areaHa).toBeCloseTo(1, 1);
    const plotId = p.json().id as string;
    const f1 = await createFarmer(t, op, { phone: '+221770000001' });
    const f2 = await createFarmer(t, op, { phone: '+221770000002' });
    const a1 = await t.app.inject({ method: 'POST', url: `/v1/plots/${plotId}/allocations`, headers: auth(op), payload: { farmerId: f1.id, sharePct: 60 } });
    expectStatus(a1, 201);
    const tooMuch = await t.app.inject({ method: 'POST', url: `/v1/plots/${plotId}/allocations`, headers: auth(op), payload: { farmerId: f2.id, sharePct: 50 } });
    expect(tooMuch.json().code).toBe('SHARE_EXCEEDED');
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/plots/${plotId}/allocations`, headers: auth(op), payload: { farmerId: f2.id, sharePct: 40 } }), 201);
    const plot = json<{ status: string; allocatedPct: number; farmers: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/plots/${plotId}`, headers: auth(op) }));
    expect(plot).toMatchObject({ status: 'allocated', allocatedPct: 100 });
    const hist = json<{ allocations: { plotCode: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/farmers/${f1.id}/history`, headers: auth(op) }));
    expect(hist.allocations[0]!.plotCode).toBe('P-001');
    const blockFarmers = json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/farmers?blockId=${b.id}`, headers: auth(op) }));
    expect(blockFarmers.data).toHaveLength(2);
    expect((await t.app.inject({ method: 'DELETE', url: `/v1/plots/${plotId}`, headers: auth(op) })).json().code).toBe('PLOT_HAS_ALLOCATIONS');
    const ended = await t.app.inject({ method: 'POST', url: `/v1/allocations/${a1.json().id}/actions/end`, headers: auth(op), payload: {} });
    expect(ended.json().status).toBe('ended');
    const other = await signup(t, { legalName: 'Autre SARL' });
    const foreign = await createFarmer(t, other);
    const bad = await t.app.inject({ method: 'POST', url: `/v1/plots/${plotId}/allocations`, headers: auth(op), payload: { farmerId: foreign.id, sharePct: 10 } });
    expect(bad.json().code).toBe('FARMER_NOT_FOUND');
    // move the plot geometry (If-Match) and keep it valid
    const cur = (await plotsOf(b.id))[0]!;
    const moved = await t.app.inject({ method: 'PATCH', url: `/v1/plots/${plotId}`, headers: auth(op, { 'if-match': `"${cur.version}"` }), payload: { geometry: rectangle(-16.2695, 12.5802, 120, 100) } });
    expectStatus(moved, 200);
    expect(moved.json().areaHa).toBeCloseTo(1.2, 1);
  });
});

describe('land documents, assets, grievances', () => {
  it('registers documents and the admin verifies them from the queue', async () => {
    const b = await createBlock(t, op);
    const mp = multipartBody({}, { name: 'deliberation.pdf', content: PDF_BYTES });
    const f = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(op), ...mp.headers }, payload: mp.payload }));
    const d = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/land-documents`, headers: auth(op), payload: { docType: 'deliberation', fileId: f.id, number: 'DEL-2026-14', issuedBy: 'Commune de Niaguis', issueDate: '2026-02-10' } });
    expectStatus(d, 201);
    expect((await t.app.inject({ method: 'GET', url: `/v1/blocks/${b.id}`, headers: auth(op) })).json().status).toBe('documenting');
    const admin = await adminSession(t);
    const queue = json<{ data: { id: string; blockName: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/admin/land-documents?filter[status]=submitted', headers: auth(admin) }));
    expect(queue.data[0]).toMatchObject({ id: d.json().id, blockName: 'Bloc de Niaguis' });
    const fileMeta = await t.app.inject({ method: 'GET', url: `/v1/files/${f.id}`, headers: auth(admin) });
    expectStatus(fileMeta, 200);
    expect((await t.app.inject({ method: 'POST', url: `/v1/admin/land-documents/${d.json().id}/actions/verify`, headers: auth(op), payload: {} })).statusCode).toBe(403);
    const v = await t.app.inject({ method: 'POST', url: `/v1/admin/land-documents/${d.json().id}/actions/verify`, headers: auth(admin), payload: {} });
    expect(v.json().status).toBe('verified');
    const b2 = json<{ stats: { landDocsVerified: number } }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${b.id}`, headers: auth(op) }));
    expect(b2.stats.landDocsVerified).toBe(1);
  });

  it('records assets and grievances; grievance resolution requires text', async () => {
    const b = await createBlock(t, op);
    const a = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/assets`, headers: auth(op), payload: { type: 'borehole', description: 'Forage 60 m', location: { type: 'Point', coordinates: [-16.268, 12.581] } } });
    expectStatus(a, 201);
    expect(a.json().location.type).toBe('Point');
    const g = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/grievances`, headers: auth(op), payload: { reporter: 'Chef de village', category: 'access', description: 'Passage du bétail' } });
    expectStatus(g, 201);
    const noRes = await t.app.inject({ method: 'PATCH', url: `/v1/grievances/${g.json().id}`, headers: auth(op, { 'if-match': '"1"' }), payload: { status: 'resolved' } });
    expect(noRes.json().code).toBe('RESOLUTION_REQUIRED');
    const res = await t.app.inject({ method: 'PATCH', url: `/v1/grievances/${g.json().id}`, headers: auth(op, { 'if-match': '"1"' }), payload: { status: 'resolved', resolution: 'Couloir de passage balisé' } });
    expect(res.json().resolvedAt).toBeTruthy();
  });

  it('archives a block', async () => {
    const b = await createBlock(t, op);
    const r = await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/actions/archive`, headers: auth(op, { 'if-match': '"1"' }) });
    expect(r.json().status).toBe('archived');
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/blocks', headers: auth(op) })).data).toHaveLength(0);
    expect((await t.app.inject({ method: 'PATCH', url: `/v1/blocks/${b.id}`, headers: auth(op, { 'if-match': '"2"' }), payload: { name: 'Bloc X' } })).json().code).toBe('BLOCK_ARCHIVED');
  });
});
