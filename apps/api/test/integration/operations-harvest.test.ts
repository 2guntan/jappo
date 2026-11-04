import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activeSeasonScenario, adminSession, auth, createTestApp, expectStatus, json, lastCode, multipartBody, PNG_BYTES, resetDb, verifiedLender, verifiedOrg, type TestApp } from '../helpers';
import { runAlertsForBlock } from '../../src/modules/operations/service';
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

type Alert = { id: string; ruleCode: string | null; severity: string; status: string; dedupeKey?: string; data: Record<string, unknown> };
type Session = Parameters<typeof auth>[0];
const addDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

async function photo(s: Session) {
  const mp = multipartBody({}, { name: 'p.png', content: PNG_BYTES, type: 'image/png' });
  return json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(s), ...mp.headers }, payload: mp.payload })).id;
}

describe('operations & harvest (P7)', () => {
  it('records services and visits, raises rule alerts, weighs harvest, dispatches, invoices with grades and confirms escrow receipts', async () => {
    const s = await activeSeasonScenario(t);
    const alerts = async (who: Session = s.op, status?: string) => json<{ data: Alert[] }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}/alerts${status ? `?status=${status}` : ''}`, headers: auth(who) })).data;

    // Service deliveries: photo acknowledgement, SMS-code acknowledgement, offline idempotency.
    const lines = json<{ data: { id: string; plotId: string | null }[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/budget-lines`, headers: auth(s.op) })).data;
    const line0 = lines.find((l) => l.plotId === s.plots[0]!.id)!;
    const noPhoto = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/service-deliveries`, headers: auth(s.op), payload: { budgetLineId: line0.id, farmerId: s.farmers[0]!.id, qty: 1, farmerAckMethod: 'signature_photo' } });
    expect(noPhoto.statusCode).toBe(400);
    const sd = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/service-deliveries`, headers: auth(s.op), payload: { budgetLineId: line0.id, farmerId: s.farmers[0]!.id, qty: 1, supplierName: 'Intrants Delta SARL', farmerAckMethod: 'signature_photo', photoFileId: await photo(s.op), offlineClientId: 'sd-offline-0001' } });
    expectStatus(sd, 201);
    expect(sd.json()).toMatchObject({ unit: 'kg', farmerAckMethod: 'signature_photo', farmerAckAt: expect.any(String) });
    const again = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/service-deliveries`, headers: auth(s.op), payload: { budgetLineId: line0.id, qty: 1, offlineClientId: 'sd-offline-0001' } });
    expect(again.json().id).toBe(sd.json().id);
    const line1 = lines.find((l) => l.plotId === s.plots[1]!.id)!;
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/farmers/${s.farmers[1]!.id}/actions/request-ack-code`, headers: auth(s.op) }), 202);
    const code = await lastCode(t, '+221772000010');
    const bad = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/service-deliveries`, headers: auth(s.op), payload: { budgetLineId: line1.id, farmerId: s.farmers[1]!.id, qty: 1, farmerAckMethod: 'otp', ackCode: '000000' } });
    expect(bad.json().code).toBe('OTP_INVALID');
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/service-deliveries`, headers: auth(s.op), payload: { budgetLineId: line1.id, farmerId: s.farmers[1]!.id, qty: 1, farmerAckMethod: 'otp', ackCode: code } }), 201);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/service-deliveries`, headers: auth(s.op) })).data).toHaveLength(2);

    // Visit with health 1 → critical HEALTH_LOW alert immediately, visible to the lender.
    const v = await t.app.inject({ method: 'POST', url: `/v1/plots/${s.plots[0]!.id}/visits`, headers: auth(s.op), payload: { cropStage: 'vegetative', healthScore: 1, estimatedYieldTHa: 4, issues: ['pest'], notes: 'Chenille légionnaire', geo: { type: 'Point', coordinates: [-16.27, 12.58] } } });
    expectStatus(v, 201);
    let open = await alerts();
    expect(open.map((a) => [a.ruleCode, a.severity])).toEqual(expect.arrayContaining([['HEALTH_LOW', 'critical'], ['YIELD_FORECAST_DROP', 'critical']]));
    expect((await alerts(s.alpha)).length).toBe(open.length);
    const stranger = await verifiedLender(t, 'Banque Beta SA', 'bank');
    expect((await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}/alerts`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/plots/${s.plots[0]!.id}/visits`, headers: auth(s.alpha), payload: { cropStage: 'vegetative', healthScore: 3 } })).statusCode).toBe(403);
    const visits = json<{ data: { healthScore: number; geo: unknown }[] }>(await t.app.inject({ method: 'GET', url: `/v1/plots/${s.plots[0]!.id}/visits`, headers: auth(s.alpha) })).data;
    expect(visits[0]).toMatchObject({ healthScore: 1, geo: { type: 'Point' } });

    // Nightly evaluation 30 days later: visit gaps on all planted plots; no duplicate HEALTH_LOW.
    expect(await runAlertsForBlock(t.ctx.db, s.blockId, addDays(30))).toMatchObject({ raised: 3 });
    open = await alerts();
    expect(open.filter((a) => a.ruleCode === 'VISIT_GAP')).toHaveLength(3);
    expect(open.filter((a) => a.ruleCode === 'HEALTH_LOW')).toHaveLength(1);
    expect((await runAlertsForBlock(t.ctx.db, s.blockId, addDays(30))).raised).toBe(0);

    // Acknowledge / resolve; a healthy visit auto-resolves HEALTH_LOW.
    const hl = open.find((a) => a.ruleCode === 'HEALTH_LOW')!;
    expect((await t.app.inject({ method: 'POST', url: `/v1/alerts/${hl.id}/actions/acknowledge`, headers: auth(s.alpha), payload: {} })).statusCode).toBe(403);
    expect(json<Alert>(await t.app.inject({ method: 'POST', url: `/v1/alerts/${hl.id}/actions/acknowledge`, headers: auth(s.op), payload: {} })).status).toBe('acknowledged');
    expect((await t.app.inject({ method: 'POST', url: `/v1/alerts/${hl.id}/actions/resolve`, headers: auth(s.op), payload: {} })).statusCode).toBe(400);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/plots/${s.plots[0]!.id}/visits`, headers: auth(s.op), payload: { cropStage: 'flowering', healthScore: 4, estimatedYieldTHa: 7.5 } }), 201);
    expect((await alerts(s.op, 'resolved')).map((a) => a.ruleCode)).toEqual(expect.arrayContaining(['HEALTH_LOW']));
    const manual = await t.app.inject({ method: 'POST', url: `/v1/blocks/${s.blockId}/alerts`, headers: auth(s.op), payload: { severity: 'info', type: 'note', message: 'Visite du préfet prévue' } });
    expect(manual.json()).toMatchObject({ source: 'manual', status: 'open' });
    expect(json<{ data: { templateCode: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: auth(s.alpha) })).data.map((n) => n.templateCode)).toContain('alert.raised');

    // Admin tunes a rule; operators cannot.
    const admin = await adminSession(t);
    expect((await t.app.inject({ method: 'PATCH', url: '/v1/alert-rules/VISIT_GAP', headers: auth(s.op), payload: { params: { days: 14 } } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'PATCH', url: '/v1/alert-rules/VISIT_GAP', headers: auth(admin), payload: { params: { nope: 1 } } })).statusCode).toBe(400);
    expect(json<{ params: Record<string, number> }>(await t.app.inject({ method: 'PATCH', url: '/v1/alert-rules/VISIT_GAP', headers: auth(admin), payload: { params: { days: 14 } } })).params.days).toBe(14);

    // Graded offtake for the harvest (A at par, B −10 %).
    const maize = json<{ data: { id: string; code: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/crops', headers: auth(s.op) })).data.find((c) => c.code === 'maize')!;
    const oc = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/offtake-contracts', headers: auth(s.op), payload: { blockId: s.blockId, seasonId: s.seasonId, buyerOrgId: s.buyer.orgId, cropId: maize.id, minVolumeKg: 10000, maxVolumeKg: 20000, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30, paysIntoEscrow: true, qualitySpec: [{ grade: 'A', adjustmentPct: 0 }, { grade: 'B', adjustmentPct: -10 }] } }));
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/offtake-contracts/${oc.id}/actions/mark-signed`, headers: auth(s.op, { 'if-match': '"1"' }), payload: {} }), 200);

    // Weighing tickets: grade validated, farmer must be on the plot, season moves to harvest.
    const weigh = (i: number, gross: number, tare: number, grade: string, extra: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/harvest-deliveries`, headers: auth(s.op), payload: { plotId: s.plots[i]!.id, farmerId: s.farmers[i]!.id, grossKg: gross, tareKg: tare, grade, moisturePct: 13.5, ...extra } });
    expect((await weigh(0, 1000, 0, 'Z')).json().code).toBe('GRADE_INVALID');
    expect((await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/harvest-deliveries`, headers: auth(s.op), payload: { plotId: s.plots[0]!.id, farmerId: s.farmers[1]!.id, grossKg: 10, grade: 'A' } })).json().code).toBe('FARMER_NOT_ON_PLOT');
    expect((await weigh(0, 100, 100, 'A')).statusCode).toBe(400);
    const t1 = json<{ id: string; ticketNo: string; netKg: number; version: number }>(await weigh(0, 6100, 100, 'A', { farmerAckMethod: 'signature_photo', photoFileId: await photo(s.op) }));
    expect(t1).toMatchObject({ ticketNo: 'T-000001', netKg: 6000 });
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}`, headers: auth(s.op) })).status).toBe('harvest');
    const wrong = json<{ id: string; version: number }>(await weigh(1, 4500, 50, 'B'));
    expect(json<{ status: string }>(await t.app.inject({ method: 'POST', url: `/v1/harvest-deliveries/${wrong.id}/actions/void`, headers: auth(s.op, { 'if-match': `"${wrong.version}"` }), payload: { reason: 'Erreur de pesée' } })).status).toBe('void');
    const t2 = json<{ id: string; netKg: number }>(await weigh(1, 4050, 50, 'B'));
    const t3 = json<{ id: string; netKg: number }>(await weigh(2, 2000, 0, 'A'));
    expect([t2.netKg, t3.netKg]).toEqual([4000, 2000]);
    const tickets = json<{ data: { ticketNo: string; status: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/harvest-deliveries`, headers: auth(s.alpha) })).data;
    expect(tickets.map((x) => x.ticketNo).sort()).toEqual(['T-000001', 'T-000002', 'T-000003', 'T-000004']);

    // Dispatches and buyer acceptance.
    const d1 = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dispatches`, headers: auth(s.op), payload: { offtakeContractId: oc.id, deliveryIds: [t1.id, t2.id], vehicle: 'DK-1234-AB' } });
    expectStatus(d1, 201);
    expect(d1.json()).toMatchObject({ netKgTotal: 10000, status: 'in_transit' });
    expect((await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dispatches`, headers: auth(s.op), payload: { offtakeContractId: oc.id, deliveryIds: [t1.id] } })).json().code).toBe('DELIVERY_NOT_DISPATCHABLE');
    const d2 = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dispatches`, headers: auth(s.op), payload: { offtakeContractId: oc.id, deliveryIds: [t3.id] } }));
    const buyerList = json<{ data: { id: string; allowedActions: string[] }[] }>(await t.app.inject({ method: 'GET', url: '/v1/dispatches', headers: auth(s.buyer) })).data;
    expect(buyerList).toHaveLength(2);
    expect(buyerList[0]!.allowedActions).toEqual(['accept']);
    const otherBuyer = await verifiedOrg(t, { orgType: 'buyer', legalName: 'Négoce Omega SA', legalForm: 'SA', email: `omega${Date.now()}@omega.test` });
    expect((await t.app.inject({ method: 'POST', url: `/v1/dispatches/${d2.id}/actions/accept`, headers: auth(otherBuyer, { 'if-match': '"1"' }), payload: { acceptedKg: 2000, rejectedKg: 0 } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/dispatches/${d1.json().id}/actions/accept`, headers: auth(s.buyer, { 'if-match': '"1"' }), payload: { acceptedKg: 9500, rejectedKg: 600 } })).json().code).toBe('KG_EXCEEDS_DISPATCH');
    expect((await t.app.inject({ method: 'POST', url: `/v1/dispatches/${d1.json().id}/actions/accept`, headers: auth(s.buyer, { 'if-match': '"1"' }), payload: { acceptedKg: 9500, rejectedKg: 500 } })).statusCode).toBe(400);
    expect(json<{ status: string }>(await t.app.inject({ method: 'POST', url: `/v1/dispatches/${d1.json().id}/actions/accept`, headers: auth(s.buyer, { 'if-match': '"1"' }), payload: { acceptedKg: 9500, rejectedKg: 500, comment: 'Humidité trop élevée sur 10 sacs' } })).status).toBe('partially_accepted');
    expect(json<{ status: string }>(await t.app.inject({ method: 'POST', url: `/v1/dispatches/${d2.id}/actions/accept`, headers: auth(s.buyer, { 'if-match': '"1"' }), payload: { acceptedKg: 2000, rejectedKg: 0 } })).status).toBe('accepted');

    // Invoice: (6000 A + 4000 B) × 0.95 + 2000 A → 7700 kg A × 250 + 3800 kg B × 225 = 2 780 000 XOF.
    expect((await t.app.inject({ method: 'POST', url: '/v1/buyer-invoices', headers: auth(s.buyer), payload: { dispatchIds: [d2.id] } })).statusCode).toBe(403);
    const inv = await t.app.inject({ method: 'POST', url: '/v1/buyer-invoices', headers: auth(s.op), payload: { dispatchIds: [d1.json().id, d2.id] } });
    expectStatus(inv, 201);
    expect(inv.json()).toMatchObject({ amountXof: 2_780_000, acceptedKg: 11500, status: 'issued', dueDate: addDays(30), hasPdf: true });
    expect(inv.json().lines).toEqual([
      { grade: 'A', acceptedKg: 7700, adjustmentPct: 0, unitPriceXof: 250, amountXof: 1_925_000 },
      { grade: 'B', acceptedKg: 3800, adjustmentPct: -10, unitPriceXof: 225, amountXof: 855_000 },
    ]);
    const invoiceId = inv.json().id as string;
    expect((await t.app.inject({ method: 'POST', url: '/v1/buyer-invoices', headers: auth(s.op), payload: { dispatchIds: [d2.id] } })).json().code).toBe('DISPATCH_NOT_INVOICEABLE');
    expect(json<{ data: { id: string; allowedActions: string[] }[] }>(await t.app.inject({ method: 'GET', url: '/v1/buyer-invoices', headers: auth(s.buyer) })).data[0]!.allowedActions).toContain('record_payment');
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/buyer-invoices', headers: auth(otherBuyer) })).data).toHaveLength(0);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/buyer-invoices?blockId=${s.blockId}`, headers: auth(s.alpha) })).data).toHaveLength(1);
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/buyer-invoices/${invoiceId}/pdf`, headers: auth(s.buyer) }), 200);

    // Escrow receipts: buyer declares (pending), lender confirms; lender records the balance (confirmed at once).
    const r1 = await t.app.inject({ method: 'POST', url: '/v1/escrow-receipts', headers: auth(s.buyer), payload: { escrowAccountId: s.escrowAccountId, amountXof: 1_000_000, valueDate: addDays(0), bankReference: 'ZETA-VIR-001', buyerInvoiceId: invoiceId } });
    expectStatus(r1, 201);
    expect(r1.json()).toMatchObject({ status: 'recorded', allowedActions: [] });
    expect((await t.app.inject({ method: 'POST', url: '/v1/escrow-receipts', headers: auth(s.buyer), payload: { escrowAccountId: s.escrowAccountId, amountXof: 5, valueDate: addDays(0), bankReference: 'ZETA-VIR-001' } })).json().code).toBe('RECEIPT_DUPLICATE');
    expect((await t.app.inject({ method: 'POST', url: '/v1/escrow-receipts', headers: auth(otherBuyer), payload: { escrowAccountId: s.escrowAccountId, amountXof: 5, valueDate: addDays(0), bankReference: 'X-1' } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/escrow-receipts/${r1.json().id}/actions/confirm`, headers: auth(stranger, { 'if-match': '"1"' }), payload: {} })).statusCode).toBe(404);
    expect(json<{ status: string }>(await t.app.inject({ method: 'POST', url: `/v1/escrow-receipts/${r1.json().id}/actions/confirm`, headers: auth(s.alpha, { 'if-match': '"1"' }), payload: {} })).status).toBe('confirmed');
    let invNow = json<{ data: { status: string; paidXof: number }[] }>(await t.app.inject({ method: 'GET', url: '/v1/buyer-invoices', headers: auth(s.op) })).data[0]!;
    expect(invNow).toMatchObject({ status: 'partially_paid', paidXof: 1_000_000 });
    const r2 = await t.app.inject({ method: 'POST', url: '/v1/escrow-receipts', headers: auth(s.alpha), payload: { escrowAccountId: s.escrowAccountId, amountXof: 1_780_000, valueDate: addDays(1), bankReference: 'ALPHA-CR-002', buyerInvoiceId: invoiceId } });
    expect(r2.json()).toMatchObject({ status: 'confirmed', payerOrgId: s.buyer.orgId });
    invNow = json<{ data: { status: string; paidXof: number }[] }>(await t.app.inject({ method: 'GET', url: '/v1/buyer-invoices', headers: auth(s.op) })).data[0]!;
    expect(invNow).toMatchObject({ status: 'paid', paidXof: 2_780_000 });
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/escrow-receipts?blockId=${s.blockId}&status=confirmed`, headers: auth(s.op) })).data).toHaveLength(2);

    // Season end + 20 days: farmers 2 and 3 delivered < 85 % of expected base deliverable kg → side-selling suspicion.
    await runAlertsForBlock(t.ctx.db, s.blockId, '2027-05-20');
    const short = (await alerts()).filter((a) => a.ruleCode === 'DELIVERY_SHORTFALL');
    expect(short.map((a) => a.data.farmerId).sort()).toEqual([s.farmers[1]!.id, s.farmers[2]!.id].sort());
    expect(short.every((a) => a.data.sideSellingSuspected === true && Number(a.data.deliveredKg) < 0.85 * Number(a.data.expectedKg))).toBe(true);
  });

  it('applies visit, service and harvest operations from the field PWA idempotently', async () => {
    const s = await activeSeasonScenario(t);
    const boot = json<{ seasons: { id: string; status: string }[]; plantings: unknown[]; budgetLines: { id: string; plotId: string }[]; lastVisits: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/field/bootstrap?blockIds=${s.blockId}`, headers: auth(s.op) }));
    expect(boot.seasons).toEqual([expect.objectContaining({ id: s.seasonId, status: 'in_progress' })]);
    expect(boot.plantings).toHaveLength(3);
    const line = boot.budgetLines.find((l) => l.plotId === s.plots[2]!.id)!;
    const ops = [
      { clientId: 'visit-client-0001', type: 'visit.create', createdAt: new Date().toISOString(), payload: { plotId: s.plots[2]!.id, cropStage: 'sowing', healthScore: 5 } },
      { clientId: 'svc-client-0001', type: 'serviceDelivery.create', createdAt: new Date().toISOString(), payload: { seasonId: s.seasonId, budgetLineId: line.id, qty: 1 } },
      { clientId: 'hv-client-0001', type: 'harvestDelivery.create', createdAt: new Date().toISOString(), payload: { seasonId: s.seasonId, plotId: s.plots[2]!.id, farmerId: s.farmers[2]!.id, grossKg: 500, tareKg: 5, grade: 'A' } },
      { clientId: 'hv-client-0002', type: 'harvestDelivery.create', createdAt: new Date().toISOString(), payload: { seasonId: s.seasonId, plotId: s.plots[2]!.id, farmerId: s.farmers[0]!.id, grossKg: 500, grade: 'A' } },
    ];
    const r1 = json<{ results: { clientId: string; status: string; error: { code: string } | null }[] }>(await t.app.inject({ method: 'POST', url: '/v1/field/sync', headers: auth(s.op), payload: { blockIds: [s.blockId], ops } }));
    expect(r1.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'rejected']);
    expect(r1.results[3]!.error!.code).toBe('FARMER_NOT_ON_PLOT');
    const r2 = json<{ results: { status: string }[] }>(await t.app.inject({ method: 'POST', url: '/v1/field/sync', headers: auth(s.op), payload: { blockIds: [s.blockId], ops: ops.slice(0, 3) } }));
    expect(r2.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect(json<{ data: { netKg: number }[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}/harvest-deliveries`, headers: auth(s.op) })).data.map((h) => h.netKg)).toEqual([495]);
  });
});
