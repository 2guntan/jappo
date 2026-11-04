import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { activeSeasonScenario, auth, createTestApp, expectStatus, json, lastCode, resetDb, verifiedLender, type TestApp } from '../helpers';
import { blocks, plots } from '../../src/modules/land/schema';
import { plantings } from '../../src/modules/planning/schema';
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

type Run = {
  id: string;
  status: string;
  version: number;
  receiptsTotalXof: number;
  lines: { farmerCode: string; farmerName: string; grossCreditXof: number; seasonalPaidXof: number; investmentFeePaidXof: number; operatorFeesPaidXof: number; solidarityContributionXof: number; solidarityReceivedXof: number; payoutXof: number; arrears: Record<string, number> }[];
  distribution: { seasonalByFacility: { amountXof: number }[]; investmentToLenderXof: number; investmentExcessToOperatorXof: number; operatorXof: number; farmersTotalXof: number };
  invariantOk: boolean;
  lenderApprovals: { approvedAt: string | null }[];
  allowedActions: string[];
};
type Instruction = { id: string; ref: string; beneficiaryType: string; channel: string; heldForFarmer: boolean; amountXof: number; status: string; provider: string };

/** WF-1 deliveries (12 000 / 8 000 / 3 000 kg at 250 XOF) on exactly 1 ha plots, paid 5 750 000 into escrow. */
async function wf1Harvest(s: Awaited<ReturnType<typeof activeSeasonScenario>>) {
  // Plot geometry gives ≈ 1 ha; pin exactly 1 ha so per-ha fees equal the SPEC fixture (100 000 / farmer).
  for (const p of s.plots) {
    await t.ctx.db.update(plots).set({ areaHa: '1' }).where(eq(plots.id, p.id));
    await t.ctx.db.update(plantings).set({ areaHa: '1' }).where(eq(plantings.plotId, p.id));
  }
  const tickets: string[] = [];
  for (const [i, kg] of [12_000, 8_000, 3_000].entries()) {
    const r = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/harvest-deliveries`, headers: auth(s.op), payload: { plotId: s.plots[i]!.id, farmerId: s.farmers[i]!.id, grossKg: kg, tareKg: 0, grade: 'A' } });
    expectStatus(r, 201);
    tickets.push(r.json().id);
  }
  const d = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dispatches`, headers: auth(s.op), payload: { offtakeContractId: s.offtakeId, deliveryIds: tickets } }));
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/dispatches/${d.id}/actions/accept`, headers: auth(s.buyer, { 'if-match': '"1"' }), payload: { acceptedKg: 23_000, rejectedKg: 0 } }), 200);
  const inv = json<{ id: string; amountXof: number }>(await t.app.inject({ method: 'POST', url: '/v1/buyer-invoices', headers: auth(s.op), payload: { dispatchIds: [d.id] } }));
  expect(inv.amountXof).toBe(5_750_000);
  expectStatus(await t.app.inject({ method: 'POST', url: '/v1/escrow-receipts', headers: auth(s.alpha), payload: { escrowAccountId: s.escrowAccountId, amountXof: 5_750_000, valueDate: new Date().toISOString().slice(0, 10), bankReference: 'ZETA-VIR-5750', buyerInvoiceId: inv.id } }), 201);
}

describe('settlement (P8)', () => {
  it('reproduces golden WF-1 end to end: compute, approvals, instructions, confirmations, repayments, reconciliation, statements, farmer portal', async () => {
    const s = await activeSeasonScenario(t);
    await wf1Harvest(s);

    // Compute: farmer lines equal WF-1 (no investment facility here → the 200 000 investment fees go to the operator).
    const c = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/settlement-runs`, headers: auth(s.op) });
    expectStatus(c, 201);
    let run = c.json() as Run;
    expect(run).toMatchObject({ status: 'computed', receiptsTotalXof: 5_750_000, invariantOk: true });
    expect(run.lines.map((l) => [l.grossCreditXof, l.seasonalPaidXof, l.investmentFeePaidXof, l.operatorFeesPaidXof, l.payoutXof])).toEqual([
      [3_000_000, 1_308_000, 100_000, 50_000, 1_542_000],
      [2_000_000, 1_090_000, 100_000, 50_000, 760_000],
      [750_000, 750_000, 0, 0, 0],
    ]);
    expect(run.lines[2]!.arrears).toEqual({ seasonalDebtXof: 122_000, investmentFeeXof: 100_000, operatorFeesXof: 50_000 });
    expect(run.distribution).toMatchObject({ seasonalByFacility: [{ amountXof: 3_148_000 }], investmentToLenderXof: 0, investmentExcessToOperatorXof: 200_000, operatorXof: 300_000, farmersTotalXof: 2_302_000 });
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}`, headers: auth(s.op) })).status).toBe('settlement');
    expect((await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/settlement-runs`, headers: auth(s.op) })).json().code).toBe('SETTLEMENT_EXISTS');

    // Authorisation: the lender sees the run (no farmer names), an unrelated lender does not.
    const lenderView = json<Run & { lines: { farmerName: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}`, headers: auth(s.alpha) }));
    expect(lenderView.lines.every((l) => l.farmerName === '')).toBe(true);
    const stranger = await verifiedLender(t, 'Banque Beta SA', 'bank');
    expect((await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/approve-lender`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}/statements`, headers: auth(s.alpha) })).statusCode).toBe(404);

    // Approvals: lender cannot approve before the operator; recompute voids approvals.
    expect((await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/approve-lender`, headers: auth(s.alpha) })).json().code).toBe('INVALID_STATE_TRANSITION');
    run = json<Run>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/approve-operator`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) }));
    expect(run.status).toBe('approved_operator');
    run = json<Run>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/recompute`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) }));
    expect(run.status).toBe('computed');
    run = json<Run>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/approve-operator`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) }));
    run = json<Run>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/approve-lender`, headers: auth(s.alpha) }));
    expect(run).toMatchObject({ status: 'approved_lenders', lenderApprovals: [expect.objectContaining({ approvedAt: expect.any(String) })] });

    // Instruct: one instruction per beneficiary; farmers with a verified wallet are paid by mobile money, others held in trust.
    run = json<Run>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/instruct`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) }));
    expect(run.status).toBe('instructed');
    const ins = json<{ data: Instruction[] }>(await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}/instructions`, headers: auth(s.op) })).data;
    expect(ins.map((i) => [i.beneficiaryType, i.amountXof])).toEqual([['lender', 3_148_000], ['operator', 300_000], ['farmer', 1_542_000], ['farmer', 760_000]]);
    expect(ins.reduce((x, i) => x + i.amountXof, 0)).toBe(5_750_000);
    expect(ins.filter((i) => i.beneficiaryType === 'farmer').every((i) => i.heldForFarmer && i.channel === 'bank_transfer')).toBe(true);
    const generic = await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}/instructions?format=generic`, headers: auth(s.op) });
    expect(generic.headers['content-type']).toContain('text/csv');
    expect(generic.body.split('\n')[0]).toBe('reference,beneficiary_type,beneficiary,channel,provider,destination,held_for_farmer,amount_xof');
    expect(generic.body).toContain('"3148000"');
    expect((await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}/instructions?format=wave`, headers: auth(s.op) })).body.split('\n')[0]).toBe('phone_number,amount,currency,name,client_reference');
    expect((await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}/instructions?format=generic`, headers: auth(s.alpha) })).statusCode).toBe(404);

    // Arrears for F3 and statements.
    const arrears = json<{ data: { bucket: string; remainingXof: number; status: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/farmers/${s.farmers[2]!.id}/arrears`, headers: auth(s.op) })).data;
    expect(arrears.map((a) => [a.bucket, a.remainingXof]).sort()).toEqual([['investment_fee', 100_000], ['operator_fees', 50_000], ['seasonal_debt', 122_000]]);
    const st = json<{ data: { id: string; smsText: string; hasPdf: boolean }[] }>(await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}/statements`, headers: auth(s.op) })).data;
    expect(st).toHaveLength(3);
    expect(st.every((x) => x.hasPdf)).toBe(true);
    expect(st[0]!.smsText).toMatch(/1\s542\s000/);
    expect(json<{ sent: number }>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/statements/actions/send`, headers: auth(s.op) })).sent).toBe(3);

    // Confirmations: lender confirms its own line (posts the repayment), operator imports the rest from a CSV.
    const lenderIns = ins.find((i) => i.beneficiaryType === 'lender')!;
    expect((await t.app.inject({ method: 'POST', url: `/v1/payout-instructions/${ins.find((i) => i.beneficiaryType === 'operator')!.id}/actions/confirm`, headers: auth(s.alpha), payload: {} })).statusCode).toBe(404);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/payout-instructions/${lenderIns.id}/actions/confirm`, headers: auth(s.alpha), payload: { providerRef: 'ALPHA-INT-1' } }), 200);
    const fac = json<{ status: string; repaidXof: number; schedule: { status: string; paidXof: number }[] }>(await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}`, headers: auth(s.alpha) }));
    expect(fac).toMatchObject({ repaidXof: 3_148_000, schedule: [expect.objectContaining({ status: 'partial', paidXof: 3_148_000 })] });
    const reps = json<{ data: { principalXof: number; interestXof: number; source: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}/repayments`, headers: auth(s.op) })).data;
    expect(reps).toEqual([expect.objectContaining({ interestXof: 270_000, principalXof: 2_878_000, source: 'settlement' })]);
    expect((await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/mark-executed`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) })).json().code).toBe('INSTRUCTIONS_PENDING');
    const others = ins.filter((i) => i.beneficiaryType !== 'lender');
    const csv = ['reference,status,provider_ref,reason', `${others[0]!.ref},confirmed,BK-1,`, `${others[1]!.ref},failed,,Compte clôturé`, `${others[2]!.ref},confirmed,BK-3,`, 'UNKNOWN-REF,confirmed,,'].join('\n');
    const imp = json<{ results: { status: string }[] }>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/instructions/actions/import-confirmations`, headers: auth(s.op), payload: { csv } }));
    expect(imp.results.map((r) => r.status)).toEqual(['confirmed', 'failed', 'confirmed', 'skipped']);
    run = json<Run>(await t.app.inject({ method: 'GET', url: `/v1/settlement-runs/${run.id}`, headers: auth(s.op) }));
    run = json<Run>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/mark-executed`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) }));
    expect(run.status).toBe('executed');
    // A failed payout blocks reconciliation until it is paid and confirmed.
    expect((await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/reconcile`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) })).json().code).toBe('RECONCILIATION_MISMATCH');
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/payout-instructions/${others[1]!.id}/actions/confirm`, headers: auth(s.op), payload: { providerRef: 'BK-2-RETRY' } }), 200);
    run = json<Run>(await t.app.inject({ method: 'POST', url: `/v1/settlement-runs/${run.id}/actions/reconcile`, headers: auth(s.op, { 'if-match': `"${run.version}"` }) }));
    expect(run.status).toBe('reconciled');
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}`, headers: auth(s.op) })).status).toBe('closed');
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}`, headers: auth(s.op) })).status).toBe('financed');

    // Farmer portal: SMS login, own statement only.
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/farmer/otp/request', payload: { phone: '+221772000000' } }), 202);
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/farmer/otp/request', payload: { phone: '+221779999999' } }), 202);
    const code = await lastCode(t, '+221772000000');
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/farmer/otp/verify', payload: { phone: '+221772000000', code: '000000' } })).statusCode).toBe(401);
    const tok = json<{ accessToken: string }>(await t.app.inject({ method: 'POST', url: '/v1/auth/farmer/otp/verify', payload: { phone: '+221772000000', code } }));
    const fh = { authorization: `Bearer ${tok.accessToken}` };
    expect(json<{ code: string; walletMasked: string }>(await t.app.inject({ method: 'GET', url: '/v1/me/farmer', headers: fh }))).toMatchObject({ code: s.farmers[0]!.code });
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/me/farmer/plots', headers: fh })).data).toHaveLength(1);
    const mine = json<{ data: { id: string; payoutXof: number; grossCreditXof: number }[] }>(await t.app.inject({ method: 'GET', url: '/v1/me/farmer/statements', headers: fh })).data;
    expect(mine).toEqual([expect.objectContaining({ grossCreditXof: 3_000_000, payoutXof: 1_542_000 })]);
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/me/farmer/statements/${mine[0]!.id}/pdf`, headers: fh }), 200);
    const otherStatement = st.find((x) => x.id !== mine[0]!.id)!;
    expect((await t.app.inject({ method: 'GET', url: `/v1/me/farmer/statements/${otherStatement.id}/pdf`, headers: fh })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/farmers/${s.farmers[0]!.id}`, headers: fh })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/farmer', headers: auth(s.op) })).statusCode).toBe(401);
  });

  it('applies group solidarity (WF-2) when the block is in group mode', async () => {
    const s = await activeSeasonScenario(t);
    // Group mode needs a farmer group org (P2 rule); the fixture sets the block settings directly.
    await t.ctx.db.update(blocks).set({ solidarityMode: 'group', solidarityCapPct: '20' }).where(eq(blocks.id, s.blockId));
    await wf1Harvest(s);
    const run = json<Run & { lines: { solidarityContributionXof: number; solidarityReceivedXof: number }[] }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/settlement-runs`, headers: auth(s.op) }));
    expect(run.lines.map((l) => [l.solidarityContributionXof, l.solidarityReceivedXof, l.payoutXof])).toEqual([[81_722, 0, 1_460_278], [40_278, 0, 719_722], [0, 122_000, 0]]);
    expect(run.distribution).toMatchObject({ seasonalByFacility: [{ amountXof: 3_270_000 }], farmersTotalXof: 2_180_000 });
    expect(run.lines[2]!.arrears).toEqual({ seasonalDebtXof: 0, investmentFeeXof: 100_000, operatorFeesXof: 50_000 });
  });
});
