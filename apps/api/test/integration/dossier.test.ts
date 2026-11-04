import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, expectStatus, json, readyScenario, resetDb, signup, type TestApp } from '../helpers';
import { dispatchOutbox } from '../../src/jobs';
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

type Gate = { code: string; pass: boolean; reasons: { code: string; entityIds: string[] }[] };

describe('model, readiness and dossier', () => {
  it('runs the model, passes every gate, freezes a dossier and renders its PDF', async () => {
    const s = await readyScenario(t, { yieldBase: 7, yieldStress: 6 });
    const before = json<{ gates: Gate[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/readiness`, headers: auth(s.op) }));
    expect(before.gates.find((g) => g.code === 'G7_MODEL')!.pass).toBe(false);
    const run = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) });
    expectStatus(run, 201);
    const out = run.json().outputs;
    expect(run.json().current).toBe(true);
    // 3 farmers with credits 1.2M / 1.0M / 0.8M at 18 % flat 6 months → debts 1 308 000 / 1 090 000 / 872 000
    const debts = out.scenarios.base.farmers.map((f: { seasonalDebtDueXof: number }) => f.seasonalDebtDueXof).sort((a: number, b: number) => b - a);
    expect(debts).toEqual([1308000, 1090000, 872000]);
    expect(out.tranches.seasonalAmountXof).toBe(3000000);
    expect(out.scenarios.base.block.hcr).toBeGreaterThanOrEqual(1.3);
    const r = json<{ gates: Gate[]; allGatesPass: boolean; score: number; grade: string; breakdown: Record<string, number> }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/readiness`, headers: auth(s.op) }));
    expect(r.gates.filter((g) => !g.pass)).toEqual([]);
    expect(r.breakdown.landSecurity).toBe(15);
    const d = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) });
    expectStatus(d, 201);
    const dossier = d.json();
    expect(dossier).toMatchObject({ version: 1, status: 'frozen', readinessScore: r.score, grade: r.grade, pdfStatus: 'pending' });
    expect(dossier.ref).toMatch(/^DOS-\d{4}-0001$/);
    expect(dossier.dataRoom.map((x: { category: string }) => x.category)).toEqual(['land', 'land', 'land']);
    expect(dossier.snapshot.farmers).toMatchObject({ count: 3, women: 3 });
    expect(JSON.stringify(dossier.snapshot)).not.toContain('+221772');
    expect((await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}`, headers: auth(s.op) })).json().status).toBe('ready');
    expect((await t.app.inject({ method: 'GET', url: `/v1/dossiers/${dossier.id}/pdf`, headers: auth(s.op) })).json().code).toBe('PDF_PENDING');
    // worker: outbox → PDF
    await dispatchOutbox(t.ctx);
    const after = json<{ pdfStatus: string; pdfFileId: string }>(await t.app.inject({ method: 'GET', url: `/v1/dossiers/${dossier.id}`, headers: auth(s.op) }));
    expect(after.pdfStatus).toBe('ready');
    const pdf = json<{ url: string }>(await t.app.inject({ method: 'GET', url: `/v1/dossiers/${dossier.id}/pdf`, headers: auth(s.op) }));
    const u = new URL(pdf.url);
    const raw = await t.app.inject({ method: 'GET', url: u.pathname + u.search });
    expect(raw.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(raw.rawPayload.length).toBeGreaterThan(20_000);
    // a second freeze supersedes the first
    const d2 = json<{ version: number }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) }));
    expect(d2.version).toBe(2);
    const list = json<{ data: { status: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) }));
    expect(list.data.map((x) => x.status)).toEqual(['frozen', 'superseded']);
  });

  it('refuses to freeze when gates fail and flags a stale model', async () => {
    const s = await readyScenario(t); // template yields 4 t/ha → HCR below 1.3
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) }), 201);
    const f = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) });
    expect(f.statusCode).toBe(422);
    expect(f.json().code).toBe('GATES_FAILING');
    expect(f.json().errors.map((e: { path: string }) => e.path)).toContain('G8_HCR');
    // edit the plan → model no longer current
    const pl = json<{ data: { id: string; version: number }[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/plantings`, headers: auth(s.op) })).data;
    await t.app.inject({ method: 'PATCH', url: `/v1/plantings/${pl[0]!.id}`, headers: auth(s.op, { 'if-match': `"${pl[0]!.version}"` }), payload: { yieldBaseTHa: 7 } });
    expect(json<{ current: boolean }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/model-runs/current`, headers: auth(s.op) })).current).toBe(false);
    const preview = json<{ outputs: { scenarios: { base: { block: { hcr: number } } } }; current: boolean }>(
      await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs/preview`, headers: auth(s.op), payload: { yieldShockPct: 50 } }),
    );
    expect(preview.current).toBe(false);
    expect(preview.outputs.scenarios.base.block.hcr).toBeLessThan(1);
  });

  it('manages risk covers and scores the guarantee', async () => {
    const s = await readyScenario(t, { yieldBase: 7, yieldStress: 6 });
    const c = await t.app.inject({ method: 'POST', url: `/v1/blocks/${s.blockId}/risk-covers`, headers: auth(s.op), payload: { type: 'guarantee', providerName: 'Fonds de Garantie Delta', coveragePct: 80, status: 'proposed' } });
    expectStatus(c, 201);
    await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) });
    const r1 = json<{ breakdown: { riskCover: number } }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/readiness`, headers: auth(s.op) }));
    expect(r1.breakdown.riskCover).toBe(0);
    expectStatus(await t.app.inject({ method: 'PATCH', url: `/v1/risk-covers/${c.json().id}`, headers: auth(s.op, { 'if-match': '"1"' }), payload: { status: 'committed' } }), 200);
    const r2 = json<{ breakdown: { riskCover: number } }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/readiness`, headers: auth(s.op) }));
    expect(r2.breakdown.riskCover).toBe(8);
  });

  it('hides model runs, readiness and dossiers from unrelated orgs; a dossier grant opens the dossier', async () => {
    const s = await readyScenario(t, { yieldBase: 7, yieldStress: 6 });
    const run = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) }));
    const d = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) }));
    const lender = await signup(t, { orgType: 'lender', lenderKind: 'sfd', legalName: 'Mutuelle Alpha SFD', legalForm: 'mutuelle' });
    for (const url of [`/v1/model-runs/${run.id}`, `/v1/seasons/${s.seasonId}/model-runs/current`, `/v1/seasons/${s.seasonId}/readiness`, `/v1/dossiers/${d.id}`, `/v1/dossiers/${d.id}/data-room`, `/v1/blocks/${s.blockId}/risk-covers`]) {
      expect((await t.app.inject({ method: 'GET', url, headers: auth(lender) })).statusCode, url).toBe(404);
    }
    expect((await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(lender) })).statusCode).toBe(403);
    const { grant } = await import('../../src/core/authz/visibility');
    await t.ctx.db.transaction((tx) => grant(tx, { resourceType: 'dossier', resourceId: d.id, granteeOrgId: lender.orgId!, scope: 'read', grantedByEvent: 'test' }));
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/dossiers/${d.id}`, headers: auth(lender) }), 200);
  });
});
