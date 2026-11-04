import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activeSeasonScenario, auth, createTestApp, expectStatus, json, resetDb, settleSeason, verifiedLender, verifiedOrg, wf1Harvest, type TestApp } from '../helpers';
import { snapshotKpis } from '../../src/modules/monitoring/service';
import { pdfRenderer } from '../../src/core/adapters/pdf';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await pdfRenderer().close();
  await t.close();
});
beforeEach(async () => resetDb(t));

type Kpis = Record<string, unknown> & { disbursedXof: { seasonal: number; total: number }; outstandingXof: { seasonal: number; total: number }; alerts: Record<string, number> };

describe('monitoring (P9)', () => {
  it('snapshots KPIs, serves operator / lender / block / guarantor dashboards and generates reports', async () => {
    const s = await activeSeasonScenario(t);
    // Guarantor covering the block (committed cover after the facility exists → read grants).
    const g = await verifiedOrg(t, { orgType: 'guarantor', legalName: 'Fonds de Garantie Delta', legalForm: 'SA', email: `garant${Date.now()}@delta.test` });
    const cover = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/blocks/${s.blockId}/risk-covers`, headers: auth(s.op), payload: { type: 'guarantee', providerOrgId: g.orgId, providerName: 'Fonds de Garantie Delta', coveragePct: 50, capXof: 1_000_000, status: 'committed' } }));
    expect(cover.id).toBeTruthy();
    await wf1Harvest(t, s);
    await settleSeason(t, s);

    // Snapshot job and series.
    expect(await snapshotKpis(t.ctx.db)).toMatchObject({ blocks: 1, lenders: 1 });
    expect(await snapshotKpis(t.ctx.db)).toMatchObject({ blocks: 1 }); // idempotent per date
    const series = json<{ data: { date: string; metrics: Kpis }[] }>(await t.app.inject({ method: 'GET', url: `/v1/kpis?scopeType=block&scopeId=${s.blockId}`, headers: auth(s.op) })).data;
    expect(series).toHaveLength(1);
    const k = series[0]!.metrics;
    expect(k).toMatchObject({
      areaFinancedHa: 3,
      farmers: 3,
      womenPct: 100,
      disbursedXof: { seasonal: 3_000_000, investment: 0, total: 3_000_000 },
      outstandingXof: { seasonal: 122_000, investment: 0, total: 122_000 },
      deliveredKg: 23_000,
      farmerNetIncomeAvgXof: 767_333,
      farmerNetIncomeMedianXof: 760_000,
      daysSubmissionToFirstDisbursement: 0,
      buyerPaymentDelayDays: 0,
    });
    expect((await t.app.inject({ method: 'GET', url: `/v1/kpis?scopeType=lender_portfolio&scopeId=${s.alpha.orgId}`, headers: auth(s.alpha) })).statusCode).toBe(200);
    const stranger = await verifiedLender(t, 'Banque Beta SA', 'bank');
    expect((await t.app.inject({ method: 'GET', url: `/v1/kpis?scopeType=block&scopeId=${s.blockId}`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/kpis?scopeType=lender_portfolio&scopeId=${s.alpha.orgId}`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/v1/kpis?scopeType=platform', headers: auth(s.op) })).statusCode).toBe(404);

    // Dashboards.
    const op = json<{ blocksByStatus: Record<string, number>; kpis: Kpis; tasks: Record<string, number> }>(await t.app.inject({ method: 'GET', url: '/v1/dashboards/operator', headers: auth(s.op) }));
    expect(op.blocksByStatus).toEqual({ financed: 1 });
    expect(op.kpis.farmers).toBe(3);
    expect(op.tasks).toMatchObject({ contractsPendingSignature: 0, settlementsOpen: 0 });
    const ld = json<{ kpis: Kpis; facilities: unknown[]; pending: Record<string, number> }>(await t.app.inject({ method: 'GET', url: '/v1/dashboards/lender', headers: auth(s.alpha) }));
    expect(ld.kpis.outstandingXof.total).toBe(122_000);
    expect(ld.facilities).toHaveLength(1);
    expect(json<{ facilities: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/dashboards/lender', headers: auth(stranger) })).facilities).toHaveLength(0);
    const bd = json<{ block: { ref: string }; harvestProgressPct: number | null; kpis: Kpis }>(await t.app.inject({ method: 'GET', url: `/v1/dashboards/block/${s.blockId}`, headers: auth(s.alpha) }));
    expect(bd.kpis.deliveredKg).toBe(23_000);
    expect((await t.app.inject({ method: 'GET', url: `/v1/dashboards/block/${s.blockId}`, headers: auth(stranger) })).statusCode).toBe(404);

    // Guarantor: covered facility, exposure = 50 % of outstanding (capped), block read-only.
    const gd = json<{ totalExposureXof: number; facilities: { outstandingXof: number; exposureXof: number; claimCandidate: boolean }[] }>(await t.app.inject({ method: 'GET', url: '/v1/dashboards/guarantor', headers: auth(g) }));
    expect(gd.facilities).toEqual([expect.objectContaining({ outstandingXof: 122_000, exposureXof: 61_000, claimCandidate: false })]);
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/dashboards/block/${s.blockId}`, headers: auth(g) }), 200);
    expect((await t.app.inject({ method: 'PATCH', url: `/v1/blocks/${s.blockId}`, headers: auth(g, { 'if-match': '"1"' }), payload: { name: 'x' } })).statusCode).toBeGreaterThanOrEqual(403);
    expect(json<{ facilities: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/dashboards/guarantor', headers: auth(stranger) })).facilities).toHaveLength(0);

    // Reports (PDF).
    const lr = await t.app.inject({ method: 'POST', url: '/v1/reports', headers: auth(s.alpha), payload: { type: 'lender_monthly', period: '2027-05' } });
    expectStatus(lr, 201);
    expect(lr.json()).toMatchObject({ status: 'ready', hasPdf: true });
    expect(json<{ url: string }>(await t.app.inject({ method: 'GET', url: `/v1/reports/${lr.json().id}`, headers: auth(s.alpha) })).url).toContain('/v1/files/');
    expect((await t.app.inject({ method: 'GET', url: `/v1/reports/${lr.json().id}`, headers: auth(s.op) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/v1/reports', headers: auth(s.op), payload: { type: 'lender_monthly', period: '2027-05' } })).statusCode).toBe(404);
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/reports', headers: auth(s.op), payload: { type: 'season_close', scopeId: s.blockId, period: '2027' } }), 201);
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/reports', headers: auth(g), payload: { type: 'guarantor_portfolio', period: '2027-05' } }), 201);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/reports', headers: auth(s.op) })).data).toHaveLength(1);
  });
});
