import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, awardedScenario, createTestApp, expectStatus, inviteMember, json, lastCode, multipartBody, PNG_BYTES, resetDb, verifiedLender, type TestApp } from '../helpers';
import { plotAllocations } from '../../src/modules/land/schema';
import { runArrears } from '../../src/modules/facilities/service';
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

type Party = { id: string; partyType: 'org' | 'farmer'; orgId: string | null; farmerId: string | null; signOrder: number; signedAt: string | null; canSign: boolean };
type Contract = { id: string; ref: string; type: string; status: string; contentSha256: string | null; hasPdf: boolean; hasSignedPdf: boolean; parties: Party[]; version: number; allowedActions: string[] };
type Facility = {
  id: string;
  status: string;
  version: number;
  principalXof: number;
  upfrontFeeXof: number;
  startDate: string;
  maturityDate: string;
  escrowAccountId: string | null;
  disbursedXof: number;
  overdueXof: number;
  conditionsPrecedent: { code: string; met: boolean }[];
  schedule: { seq: number; dueDate: string; principalXof: number; interestXof: number; totalXof: number; status: string }[];
  farmerAllocations: { farmerCode: string; principalXof: number; interestXof: number; feesXof: number; dueXof: number }[];
  allowedActions: string[];
};
type Session = Parameters<typeof auth>[0] & { email?: string };

async function signOrg(c: Contract, s: Session, email: string) {
  const otp = await t.app.inject({ method: 'POST', url: `/v1/contracts/${c.id}/signatures/actions/request-otp`, headers: auth(s), payload: {} });
  expectStatus(otp, 202);
  expect(otp.json().channel).toBe('email');
  const code = await lastCode(t, email);
  const r = await t.app.inject({ method: 'POST', url: `/v1/contracts/${c.id}/signatures`, headers: auth(s), payload: { method: 'otp', code } });
  expectStatus(r, 200);
  return r.json() as Contract;
}

async function evidence(s: Session) {
  const mp = multipartBody({}, { name: 'signature.png', content: PNG_BYTES, type: 'image/png' });
  return json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(s), ...mp.headers }, payload: mp.payload })).id;
}

describe('agreements & facilities (P6)', () => {
  it('creates the facility from the award, signs the full pack, confirms CPs and runs a four-eyes disbursement', async () => {
    const s = await awardedScenario(t);
    const opEmail = json<{ user: { email: string } }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s.op) })).user.email;
    const buyerEmail = json<{ user: { email: string } }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s.buyer) })).user.email;

    // Facility mirrors the bid: 18 % flat, 6 months bullet → one line 3 000 000 + 270 000; split pro rata to farmer credit.
    const f0 = json<Facility>(await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}`, headers: auth(s.alpha) }));
    expect(f0).toMatchObject({ status: 'pending_cp', principalXof: 3_000_000, upfrontFeeXof: 30_000, escrowAccountId: null });
    expect(f0.schedule).toEqual([expect.objectContaining({ seq: 1, principalXof: 3_000_000, interestXof: 270_000, totalXof: 3_270_000, status: 'due' })]);
    // Fees are charged to the operator in the scenario assumptions → farmer due = principal + interest (SPEC §9.6.3: 1 308 000 / 1 090 000 / 872 000).
    expect(f0.farmerAllocations.map((a) => [a.principalXof, a.interestXof, a.feesXof])).toEqual(
      expect.arrayContaining([
        [1_200_000, 108_000, 0],
        [1_000_000, 90_000, 0],
        [800_000, 72_000, 0],
      ]),
    );
    expect(f0.conditionsPrecedent.every((c) => !c.met)).toBe(true);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/facilities?blockId=${s.blockId}`, headers: auth(s.op) })).data).toHaveLength(1);

    // Authorisation negatives: an unrelated lender sees nothing.
    const other = await verifiedLender(t, 'Banque Beta SA', 'bank');
    expect((await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}`, headers: auth(other) })).statusCode).toBe(404);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/facilities', headers: auth(other) })).data).toHaveLength(0);
    expect((await t.app.inject({ method: 'POST', url: '/v1/escrow-accounts', headers: auth(other), payload: { blockId: s.blockId, bankName: 'Banque Beta', accountLabel: 'Séquestre', accountNumber: 'SN012 01001 000123456789' } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/actions/confirm-cp`, headers: auth(s.op, { 'if-match': '"1"' }) })).statusCode).toBe(403);
    const early = await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/actions/confirm-cp`, headers: auth(s.alpha, { 'if-match': `"${f0.version}"` }) });
    expect(early.json().code).toBe('CONDITIONS_PRECEDENT_NOT_MET');

    // Escrow account by the lender: linked to the facility.
    const esc = await t.app.inject({ method: 'POST', url: '/v1/escrow-accounts', headers: auth(s.alpha), payload: { blockId: s.blockId, bankName: 'Mutuelle Alpha SFD', accountLabel: 'Séquestre bloc', accountNumber: 'SN012 01001 000123456789', iban: 'SN08 SN0120100100012345678901' } });
    expectStatus(esc, 201);
    expect(esc.json()).toMatchObject({ accountNumberMasked: '**** 6789', hasIban: true });
    expect(json<{ data: { id: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/escrow-accounts?blockId=${s.blockId}`, headers: auth(s.op) })).data).toHaveLength(1);

    // Contract pack: framework, 3 plot contracts, seasonal loan, escrow mandate — all sent with a content hash and PDF.
    const pack = await t.app.inject({ method: 'POST', url: `/v1/blocks/${s.blockId}/contracts/actions/generate-pack`, headers: auth(s.op), payload: { seasonId: s.seasonId, send: true } });
    expectStatus(pack, 200);
    const contracts = pack.json().data as Contract[];
    expect(pack.json().created).toBe(6);
    expect(contracts.map((c) => c.type).sort()).toEqual(['block_framework', 'escrow_mandate', 'loan_seasonal', 'plot_production', 'plot_production', 'plot_production']);
    for (const c of contracts) expect(c).toMatchObject({ status: 'out_for_signature', hasPdf: true, contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const again = await t.app.inject({ method: 'POST', url: `/v1/blocks/${s.blockId}/contracts/actions/generate-pack`, headers: auth(s.op), payload: { seasonId: s.seasonId } });
    expect(again.json().created).toBe(0);
    const byType = (ty: string) => contracts.filter((c) => c.type === ty);
    const framework = byType('block_framework')[0]!;

    // Lender cannot see drafts of others, the unrelated lender sees no contract, and sign order is enforced.
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/contracts', headers: auth(other) })).data).toHaveLength(0);
    expect((await t.app.inject({ method: 'GET', url: `/v1/contracts/${framework.id}`, headers: auth(other) })).statusCode).toBe(404);
    const lenderView = json<{ data: Contract[] }>(await t.app.inject({ method: 'GET', url: '/v1/contracts', headers: auth(s.alpha) })).data;
    expect(lenderView.map((c) => c.type).sort()).toEqual(['block_framework', 'escrow_mandate', 'loan_seasonal']);
    expect((await t.app.inject({ method: 'POST', url: `/v1/contracts/${framework.id}/signatures/actions/request-otp`, headers: auth(s.alpha), payload: {} })).json().code).toBe('SIGN_ORDER');
    expect((await t.app.inject({ method: 'PATCH', url: `/v1/contracts/${framework.id}`, headers: auth(s.op, { 'if-match': `"${framework.version}"` }), payload: { clauses: { specialConditions: 'x' } } })).json().code).toBe('CONTRACT_NOT_DRAFT');

    // Wrong code is rejected and counted.
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/contracts/${framework.id}/signatures/actions/request-otp`, headers: auth(s.op), payload: {} }), 202);
    expect((await t.app.inject({ method: 'POST', url: `/v1/contracts/${framework.id}/signatures`, headers: auth(s.op), payload: { method: 'otp', code: '000000' } })).json().code).toBe('OTP_INVALID');

    // Framework: operator → lender + buyer.
    let fw = await signOrg(framework, s.op, opEmail);
    expect(fw.status).toBe('partially_signed');
    fw = await signOrg(fw, s.alpha, s.alpha.email);
    fw = await signOrg(fw, s.buyer, buyerEmail);
    expect(fw).toMatchObject({ status: 'signed', hasSignedPdf: true });
    const pdf = await t.app.inject({ method: 'GET', url: `/v1/contracts/${fw.id}/pdf`, headers: auth(s.alpha) });
    expect(pdf.json()).toMatchObject({ signed: true });

    // Plot contracts: farmer signs (in person with photo, or SMS code), then the operator countersigns.
    const plotContracts = byType('plot_production');
    for (const [i, pc] of plotContracts.entries()) {
      const farmerParty = pc.parties.find((p) => p.partyType === 'farmer')!;
      if (i === 1) {
        const otp = await t.app.inject({ method: 'POST', url: `/v1/contracts/${pc.id}/signatures/actions/request-otp`, headers: auth(s.op), payload: { partyId: farmerParty.id } });
        expect(otp.json()).toMatchObject({ channel: 'sms' });
        const idx = s.farmers.findIndex((f) => f.id === farmerParty.farmerId);
        const code = await lastCode(t, `+2217720000${idx}0`);
        expectStatus(await t.app.inject({ method: 'POST', url: `/v1/contracts/${pc.id}/signatures`, headers: auth(s.op), payload: { partyId: farmerParty.id, method: 'otp', code } }), 200);
      } else {
        const noPhoto = await t.app.inject({ method: 'POST', url: `/v1/contracts/${pc.id}/signatures`, headers: auth(s.op), payload: { partyId: farmerParty.id, method: 'in_person_witnessed' } });
        expect(noPhoto.statusCode).toBe(400);
        const r = await t.app.inject({ method: 'POST', url: `/v1/contracts/${pc.id}/signatures`, headers: auth(s.op), payload: { partyId: farmerParty.id, method: 'in_person_witnessed', evidenceFileId: await evidence(s.op), geo: { type: 'Point', coordinates: [-16.27, 12.58] } } });
        expectStatus(r, 200);
      }
      const signed = await signOrg(json<Contract>(await t.app.inject({ method: 'GET', url: `/v1/contracts/${pc.id}`, headers: auth(s.op) })), s.op, opEmail);
      expect(signed.status).toBe('signed');
    }
    const allocs = await t.ctx.db.select().from(plotAllocations).where(eq(plotAllocations.blockId, s.blockId));
    expect(allocs.every((a) => a.contractId)).toBe(true);

    // Loan contract (operator → lender) and escrow mandate (operator + buyer → lender).
    const loan = byType('loan_seasonal')[0]!;
    await signOrg(loan, s.op, opEmail);
    expect((await signOrg(json<Contract>(await t.app.inject({ method: 'GET', url: `/v1/contracts/${loan.id}`, headers: auth(s.alpha) })), s.alpha, s.alpha.email)).status).toBe('signed');
    const mandate = byType('escrow_mandate')[0]!;
    await signOrg(mandate, s.op, opEmail);
    await signOrg(mandate, s.buyer, buyerEmail);
    expect((await signOrg(json<Contract>(await t.app.inject({ method: 'GET', url: `/v1/contracts/${mandate.id}`, headers: auth(s.alpha) })), s.alpha, s.alpha.email)).status).toBe('signed');

    // CPs met → active; block financed; financing request contracted.
    const f1 = json<Facility>(await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}`, headers: auth(s.alpha) }));
    expect(f1.conditionsPrecedent.every((c) => c.met)).toBe(true);
    expect(f1.allowedActions).toContain('confirm_cp');
    const act = await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/actions/confirm-cp`, headers: auth(s.alpha, { 'if-match': `"${f1.version}"` }) });
    expectStatus(act, 200);
    const today = new Date().toISOString().slice(0, 10);
    expect(act.json()).toMatchObject({ status: 'active', startDate: today });
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}`, headers: auth(s.op) })).status).toBe('financed');
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/financing-requests/${s.frId}`, headers: auth(s.op) })).status).toBe('contracted');
    const patched = await t.app.inject({ method: 'PATCH', url: `/v1/facilities/${s.facilityId}`, headers: auth(s.alpha, { 'if-match': `"${act.json().version}"` }), payload: { lenderLoanRef: 'ALPHA-2026-0042' } });
    expect(patched.json().lenderLoanRef).toBe('ALPHA-2026-0042');

    // Season cannot start before a confirmed disbursement.
    const season = json<{ version: number }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}`, headers: auth(s.op) }));
    expect((await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/actions/start`, headers: auth(s.op, { 'if-match': `"${season.version}"` }), payload: { selfFinanced: false } })).json().code).toBe('DISBURSEMENT_REQUIRED');

    // Disbursement: request (operator), approve (A), execute must be another credit officer (B), confirm.
    const over = await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/disbursements`, headers: auth(s.op), payload: { amountXof: 3_000_001, purpose: 'Intrants', beneficiaryType: 'operator' } });
    expect(over.json().code).toBe('DISBURSEMENT_EXCEEDS_FACILITY');
    expect((await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/disbursements`, headers: auth(s.alpha), payload: { amountXof: 1000, purpose: 'x', beneficiaryType: 'operator' } })).statusCode).toBe(403);
    const req = await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/disbursements`, headers: auth(s.op), payload: { amountXof: 3_000_000, purpose: 'Intrants campagne (NPK, semences)', beneficiaryType: 'supplier', beneficiaryName: 'Intrants Delta SARL' } });
    expectStatus(req, 201);
    const d = req.json() as { id: string; ref: string; version: number; status: string };
    expect(d.ref).toMatch(/^DSB-\d{4}-\d{4,}$/);
    const officerB = await inviteMember(t, s.alpha, ['credit_officer'], 'Ibrahima Ndoye');
    expect((await t.app.inject({ method: 'POST', url: `/v1/disbursements/${d.id}/actions/approve`, headers: auth(other, { 'if-match': '"1"' }), payload: {} })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/disbursements/${d.id}/actions/approve`, headers: auth(s.op, { 'if-match': '"1"' }), payload: {} })).statusCode).toBe(403);
    const ap = await t.app.inject({ method: 'POST', url: `/v1/disbursements/${d.id}/actions/approve`, headers: auth(s.alpha, { 'if-match': '"1"' }), payload: {} });
    expect(ap.json()).toMatchObject({ status: 'approved' });
    expect(ap.json().allowedActions).not.toContain('execute');
    const same = await t.app.inject({ method: 'POST', url: `/v1/disbursements/${d.id}/actions/execute`, headers: auth(s.alpha, { 'if-match': '"2"' }), payload: { bankReference: 'VIR-2026-1101' } });
    expect(same.json().code).toBe('FOUR_EYES_REQUIRED');
    const noRef = await t.app.inject({ method: 'POST', url: `/v1/disbursements/${d.id}/actions/execute`, headers: auth(officerB, { 'if-match': '"2"' }), payload: {} });
    expect(noRef.statusCode).toBe(400);
    const ex = await t.app.inject({ method: 'POST', url: `/v1/disbursements/${d.id}/actions/execute`, headers: auth(officerB, { 'if-match': '"2"' }), payload: { bankReference: 'VIR-2026-1101' } });
    expect(ex.json()).toMatchObject({ status: 'executed', bankReference: 'VIR-2026-1101' });
    const cf = await t.app.inject({ method: 'POST', url: `/v1/disbursements/${d.id}/actions/confirm`, headers: auth(s.alpha, { 'if-match': '"3"' }), payload: {} });
    expect(cf.json()).toMatchObject({ status: 'confirmed' });
    const f2 = json<Facility>(await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}`, headers: auth(s.op) }));
    expect(f2).toMatchObject({ disbursedXof: 3_000_000 });
    expect(f2.allowedActions).not.toContain('request_disbursement');
    const opInbox = json<{ data: { templateCode: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: auth(s.op) }));
    expect(opInbox.data.map((n) => n.templateCode)).toEqual(expect.arrayContaining(['facility.created', 'facility.activated', 'disbursement.executed', 'disbursement.confirmed', 'contract.signed']));

    // Season start now allowed; block becomes active.
    const season2 = json<{ version: number }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}`, headers: auth(s.op) }));
    const st = await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/actions/start`, headers: auth(s.op, { 'if-match': `"${season2.version}"` }), payload: { selfFinanced: false } });
    expectStatus(st, 200);
    expect(st.json().status).toBe('in_progress');

    // Arrears job: past maturity the line is overdue and the facility goes in_arrears; restructure pushes it back.
    expect(await runArrears(t.ctx.db, '2099-01-01')).toMatchObject({ overdueLines: 1, facilitiesInArrears: 1 });
    const f3 = json<Facility>(await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}`, headers: auth(s.alpha) }));
    expect(f3).toMatchObject({ status: 'in_arrears', overdueXof: 3_270_000 });
    expect(f3.allowedActions).toEqual(expect.arrayContaining(['mark_default', 'restructure']));
    const def = await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/actions/mark-default`, headers: auth(s.alpha, { 'if-match': `"${f3.version}"` }), payload: { reason: 'Impayé' } });
    expect(def.json().code).toBe('DEFAULT_THRESHOLD_NOT_REACHED');
    const rs = await t.app.inject({ method: 'POST', url: `/v1/facilities/${s.facilityId}/actions/restructure`, headers: auth(s.alpha, { 'if-match': `"${f3.version}"` }), payload: { reason: 'Récolte retardée', extendMonths: 3 } });
    expectStatus(rs, 200);
    expect(rs.json()).toMatchObject({ status: 'restructured', schedule: [expect.objectContaining({ status: 'due' })] });
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/facilities/${s.facilityId}/repayments`, headers: auth(s.op) })).data).toEqual([]);
  });

  it('creates, edits, voids single contracts and revises templates (admin only)', async () => {
    const s = await awardedScenario(t);
    const tpl = json<{ data: { id: string; code: string; locale: string; version: number; templateVersion: number }[] }>(await t.app.inject({ method: 'GET', url: '/v1/contract-templates?locale=fr', headers: auth(s.op) }));
    expect(tpl.data.map((x) => x.code).sort()).toEqual(['block_framework', 'escrow_mandate', 'loan_investment', 'loan_seasonal', 'offtake', 'plot_production']);
    const fwT = tpl.data.find((x) => x.code === 'block_framework')!;
    expect((await t.app.inject({ method: 'PATCH', url: `/v1/contract-templates/${fwT.id}`, headers: auth(s.op, { 'if-match': '"1"' }), payload: { title: 'X' } })).statusCode).toBe(403);
    const bad = await t.app.inject({ method: 'PATCH', url: `/v1/contract-templates/${fwT.id}`, headers: auth(s.admin, { 'if-match': '"1"' }), payload: { bodyHbs: '<h1>{{#if}}</h1> broken template text' } });
    expect(bad.json().code).toBe('TEMPLATE_INVALID');
    const rev = await t.app.inject({ method: 'PATCH', url: `/v1/contract-templates/${fwT.id}`, headers: auth(s.admin, { 'if-match': '"1"' }), payload: { title: 'Convention-cadre de bloc (v2)' } });
    expect(rev.json()).toMatchObject({ templateVersion: 2, active: true });

    const c = await t.app.inject({ method: 'POST', url: '/v1/contracts', headers: auth(s.op), payload: { type: 'block_framework', relatedId: s.seasonId, clauses: { disputeResolution: 'Tribunal de commerce hors classe de Dakar' } } });
    expectStatus(c, 201);
    expect(c.json()).toMatchObject({ status: 'draft', title: 'Convention-cadre de bloc (v2)', clauses: expect.objectContaining({ disputeResolution: 'Tribunal de commerce hors classe de Dakar' }) });
    expect((await t.app.inject({ method: 'POST', url: '/v1/contracts', headers: auth(s.op), payload: { type: 'block_framework', relatedId: s.seasonId } })).json().code).toBe('CONTRACT_EXISTS');
    expect((await t.app.inject({ method: 'POST', url: '/v1/contracts', headers: auth(s.op), payload: { type: 'block_framework', relatedId: s.seasonId, clauses: { waterfall: 'x' } } })).statusCode).toBe(409); // exists check precedes clause validation
    const notEditable = await t.app.inject({ method: 'PATCH', url: `/v1/contracts/${c.json().id}`, headers: auth(s.op, { 'if-match': '"1"' }), payload: { clauses: { lenders: 'x' } } });
    expect(notEditable.json().code).toBe('CLAUSE_NOT_EDITABLE');
    expect((await t.app.inject({ method: 'GET', url: `/v1/contracts/${c.json().id}`, headers: auth(s.alpha) })).statusCode).toBe(404); // draft hidden from parties
    expect((await t.app.inject({ method: 'GET', url: `/v1/contracts/${c.json().id}/pdf`, headers: auth(s.op) })).json().code).toBe('PDF_NOT_AVAILABLE');
    const ed = await t.app.inject({ method: 'PATCH', url: `/v1/contracts/${c.json().id}`, headers: auth(s.op, { 'if-match': '"1"' }), payload: { clauses: { specialConditions: 'Rapport hebdomadaire pendant la récolte.' } } });
    expect(ed.json().clauses.specialConditions).toBe('Rapport hebdomadaire pendant la récolte.');
    expect((await t.app.inject({ method: 'POST', url: '/v1/contracts', headers: auth(s.op), payload: { type: 'loan_investment', relatedId: s.facilityId } })).json().code).toBe('CONTRACT_TYPE_MISMATCH');
    expect((await t.app.inject({ method: 'POST', url: '/v1/contracts', headers: auth(s.alpha), payload: { type: 'loan_seasonal', relatedId: s.facilityId } })).statusCode).toBe(403);
    const v = await t.app.inject({ method: 'POST', url: `/v1/contracts/${c.json().id}/actions/void`, headers: auth(s.op, { 'if-match': '"2"' }), payload: { reason: 'Clause de juridiction à revoir' } });
    expect(v.json()).toMatchObject({ status: 'voided', voidReason: 'Clause de juridiction à revoir' });
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/contracts', headers: auth(s.op), payload: { type: 'block_framework', relatedId: s.seasonId } }), 201);
  });
});
