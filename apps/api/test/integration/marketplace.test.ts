import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createTestApp, expectStatus, json, lenderProfile, readyScenario, resetDb, signup, verifiedLender, type TestApp } from '../helpers';
import { rfps } from '../../src/modules/marketplace/schema';
import { runDeadlines } from '../../src/modules/marketplace/rfp';
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

const bidBody = (trancheId: string, o: Record<string, unknown> = {}) => ({ trancheId, amountXof: 3_000_000, rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'bullet', securityRequirements: ['escrow_domiciliation'], cashCollateralPct: 0, conditionsPrecedent: [], daysToDisbursement: 10, validUntil: '2027-06-30', acceptsPartial: true, ...o });

describe('marketplace (P5)', () => {
  it('runs the full tender: matching, RFP, Q&A, sealed bids, deadline close, evaluation, award, acceptance', async () => {
    const s = await readyScenario(t, { yieldBase: 7, yieldStress: 6 });
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) }), 201);
    const dossier = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) }));
    const alpha = await verifiedLender(t, 'Mutuelle Alpha SFD', 'sfd');
    const gamma = await verifiedLender(t, 'Fonds Gamma', 'dfi');
    const beta = await verifiedLender(t, 'Banque Beta SA', 'bank');
    await lenderProfile(t, alpha, { name: 'Campagne Casamance', regions: ['Ziguinchor'], minReadinessScore: 40 });
    await lenderProfile(t, gamma, { name: 'Tout', trancheTypes: ['seasonal', 'investment'], maxTenorMonths: 60 });
    await lenderProfile(t, beta, { name: 'Investissement', trancheTypes: ['investment'], maxTenorMonths: 84 });

    // Financing request from the frozen dossier (tranches default from assumptions)
    const fr = await t.app.inject({ method: 'POST', url: '/v1/financing-requests', headers: auth(s.op), payload: { dossierId: dossier.id } });
    expectStatus(fr, 201);
    expect(fr.json().tranches).toEqual([expect.objectContaining({ type: 'seasonal', amountXof: 3_000_000, requestedTenorMonths: 6, repaymentProfile: 'bullet', borrowerType: 'farmers' })]);
    const trancheId = fr.json().tranches[0].id as string;
    const sub = await t.app.inject({ method: 'POST', url: `/v1/financing-requests/${fr.json().id}/actions/submit`, headers: auth(s.op, { 'if-match': '"1"' }) });
    expect(sub.json().status).toBe('submitted');
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}`, headers: auth(s.op) })).status).toBe('in_financing');
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}`, headers: auth(s.op) })).status).toBe('financing');

    const ms = json<{ data: { lenderName: string; reasons: string[] }[] }>(await t.app.inject({ method: 'GET', url: `/v1/financing-requests/${fr.json().id}/matches`, headers: auth(s.op) }));
    expect(ms.data.map((m) => m.lenderName)).toEqual(['Fonds Gamma', 'Mutuelle Alpha SFD']);
    expect((await t.app.inject({ method: 'POST', url: '/v1/rfps', headers: auth(s.op), payload: { financingRequestId: fr.json().id, lenderOrgIds: [beta.orgId] } })).json().code).toBe('LENDER_NOT_MATCHED');

    // RFP open: 15 working days, invitees get dossier + block grants
    const rfp = json<{ id: string; status: string }>(await t.app.inject({ method: 'POST', url: '/v1/rfps', headers: auth(s.op), payload: { financingRequestId: fr.json().id } }));
    expect(rfp.status).toBe('draft');
    expect((await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}`, headers: auth(alpha) })).statusCode).toBe(404);
    const opened = await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/open`, headers: auth(s.op, { 'if-match': '"1"' }), payload: {} });
    expectStatus(opened, 200);
    expect(opened.json().status).toBe('open');
    const days = (Date.parse(opened.json().deadlineAt) - Date.parse(opened.json().openedAt)) / 86400_000;
    expect(days).toBeGreaterThanOrEqual(19);
    expect(opened.json().invitations).toHaveLength(2);
    const opp = json<{ data: { rfp: { ref: string; readinessScore: number } }[] }>(await t.app.inject({ method: 'GET', url: '/v1/lender/opportunities', headers: auth(alpha) }));
    expect(opp.data).toHaveLength(1);
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/dossiers/${dossier.id}`, headers: auth(alpha) }), 200);
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}`, headers: auth(alpha) }), 200);
    expect((await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}`, headers: auth(beta) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/dossiers/${dossier.id}`, headers: auth(beta) })).statusCode).toBe(404);
    const unverified = await signup(t, { orgType: 'lender', lenderKind: 'sfd', legalName: 'SFD Non Vérifiée', legalForm: 'mutuelle' });
    expect((await t.app.inject({ method: 'GET', url: '/v1/lender/opportunities', headers: auth(unverified) })).json().code).toBe('LENDER_NOT_VERIFIED');

    // Q&A: published answer visible to every invitee, asker anonymised
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/questions`, headers: auth(alpha), payload: { question: 'Le forage est-il déjà opérationnel ?' } }), 201);
    const qs = json<{ data: { id: string; askedByOrgName: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/questions`, headers: auth(s.op) }));
    expect(qs.data[0]!.askedByOrgName).toBe('Mutuelle Alpha SFD');
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/questions`, headers: auth(gamma) })).data).toHaveLength(0);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/questions/${qs.data[0]!.id}/answer`, headers: auth(s.op), payload: { answer: 'Oui, depuis mars 2026.', publish: true } }), 200);
    const gq = json<{ data: { askedByOrgName: string | null; answer: string; askedByMe: boolean }[] }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/questions`, headers: auth(gamma) }));
    expect(gq.data[0]).toMatchObject({ askedByOrgName: null, answer: 'Oui, depuis mars 2026.', askedByMe: false });

    // Sealed bids
    const tooSmall = json<{ id: string; version: number }>(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(alpha), payload: bidBody(trancheId, { amountXof: 100_000 }) }));
    expect((await t.app.inject({ method: 'POST', url: `/v1/bids/${tooSmall.id}/actions/submit`, headers: auth(alpha, { 'if-match': '"1"' }) })).json().code).toBe('BID_SHARE_TOO_LOW');
    expectStatus(await t.app.inject({ method: 'PATCH', url: `/v1/bids/${tooSmall.id}`, headers: auth(alpha, { 'if-match': '"1"' }), payload: { amountXof: 3_000_000 } }), 200);
    const preview = json<{ earBps: number }>(await t.app.inject({ method: 'POST', url: '/v1/bids/preview', headers: auth(alpha), payload: { amountXof: 3_000_000, rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'bullet' } }));
    expect(preview.earBps).toBe(2122);
    const aSub = await t.app.inject({ method: 'POST', url: `/v1/bids/${tooSmall.id}/actions/submit`, headers: auth(alpha, { 'if-match': '"2"' }) });
    expectStatus(aSub, 200);
    expect(aSub.json()).toMatchObject({ status: 'submitted', earBps: 2122 });
    const g = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(gamma), payload: bidBody(trancheId, { rateBps: 2000, upfrontFeeBps: 0, daysToDisbursement: 5 }) }));
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/bids/${g.id}/actions/submit`, headers: auth(gamma, { 'if-match': '"1"' }) }), 200);
    expect((await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(s.op) })).json().code).toBe('BIDS_SEALED');
    expect(json<{ data: { id: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(alpha) })).data.map((b) => b.id)).toEqual([tooSmall.id]);
    expect((await t.app.inject({ method: 'GET', url: `/v1/bids/${g.id}`, headers: auth(alpha) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/evaluation`, headers: auth(s.op) })).statusCode).toBe(403);

    // Deadline job closes and evaluates
    await t.ctx.db.update(rfps).set({ deadlineAt: new Date(Date.now() - 1000) }).where(eq(rfps.id, rfp.id));
    expect(await runDeadlines(t.ctx.db)).toMatchObject({ closed: 1 });
    const closed = json<{ status: string; version: number }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}`, headers: auth(s.op) }));
    expect(closed.status).toBe('evaluation');
    const opBids = json<{ data: { status: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(s.op) }));
    expect(opBids.data.map((b) => b.status)).toEqual(['opened', 'opened']);
    const ev = json<{ tranches: { evaluations: { lenderName: string; effectiveAnnualRateBps: number; rank: number }[]; suggestedAllocation: { bidId: string }[] }[] }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/evaluation`, headers: auth(s.op) }));
    const evs = ev.tranches[0]!.evaluations;
    expect(evs.find((e) => e.lenderName === 'Mutuelle Alpha SFD')!.effectiveAnnualRateBps).toBe(2122);
    expect(evs.find((e) => e.lenderName === 'Fonds Gamma')).toMatchObject({ effectiveAnnualRateBps: 2100, rank: 1 });
    expect(ev.tranches[0]!.suggestedAllocation).toEqual([{ bidId: g.id, amountXof: 3_000_000 }]);

    // Operator overrides the suggestion and awards Alpha (SPEC §17.1 scenario; D-046)
    const tooMuch = await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/award`, headers: auth(s.op, { 'if-match': `"${closed.version}"` }), payload: { awards: [{ bidId: tooSmall.id, amountXof: 3_000_000 }, { bidId: g.id, amountXof: 3_000_000 }] } });
    expect(tooMuch.json().code).toBe('AWARD_EXCEEDS_TRANCHE');
    const awarded = await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/award`, headers: auth(s.op, { 'if-match': `"${closed.version}"` }), payload: { awards: [{ bidId: tooSmall.id, amountXof: 3_000_000 }] } });
    expectStatus(awarded, 200);
    expect(awarded.json()).toMatchObject({ status: 'awarded', tranches: [expect.objectContaining({ status: 'fully_awarded', awardedXof: 3_000_000 })] });
    expect(json<{ data: { status: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(gamma) })).data[0]!.status).toBe('not_awarded');
    const aw = json<{ data: { id: string; allowedActions: string[]; status: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/lender/awards', headers: auth(alpha) }));
    expect(aw.data[0]).toMatchObject({ status: 'proposed', allowedActions: ['accept', 'decline'] });
    expect((await t.app.inject({ method: 'POST', url: `/v1/awards/${aw.data[0]!.id}/actions/accept`, headers: auth(gamma), payload: {} })).statusCode).toBe(404);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/awards/${aw.data[0]!.id}/actions/accept`, headers: auth(alpha), payload: {} }), 200);
    const opInbox = json<{ data: { templateCode: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: auth(s.op) }));
    expect(opInbox.data.map((n) => n.templateCode)).toEqual(expect.arrayContaining(['rfp.closed', 'award.accepted']));
    expect(json<{ status: string }>(await t.app.inject({ method: 'GET', url: `/v1/financing-requests/${fr.json().id}`, headers: auth(s.op) })).status).toBe('awarded');
  });

  it('enforces extension limits, bid submission roles and cancellation', async () => {
    const s = await readyScenario(t, { yieldBase: 7, yieldStress: 6 });
    await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) });
    const dossier = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) }));
    const alpha = await verifiedLender(t, 'Mutuelle Alpha SFD');
    await lenderProfile(t, alpha, {});
    const fr = json<{ id: string; tranches: { id: string }[] }>(await t.app.inject({ method: 'POST', url: '/v1/financing-requests', headers: auth(s.op), payload: { dossierId: dossier.id } }));
    await t.app.inject({ method: 'POST', url: `/v1/financing-requests/${fr.id}/actions/submit`, headers: auth(s.op, { 'if-match': '"1"' }) });
    const rfp = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/rfps', headers: auth(s.op), payload: { financingRequestId: fr.id } }));
    let v = json<{ version: number }>(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/open`, headers: auth(s.op, { 'if-match': '"1"' }), payload: {} })).version;
    for (let i = 0; i < 2; i++) v = json<{ version: number; extensions: number }>(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/extend`, headers: auth(s.op, { 'if-match': `"${v}"` }), payload: { workingDays: 3 } })).version;
    expect((await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/extend`, headers: auth(s.op, { 'if-match': `"${v}"` }), payload: {} })).json().code).toBe('MAX_EXTENSIONS');
    // a credit officer without credit_committee drafts but cannot submit
    const officer = await signup(t, { orgType: 'lender', lenderKind: 'sfd', legalName: 'SFD Officier', legalForm: 'mutuelle' });
    expect((await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(officer), payload: bidBody(fr.tranches[0]!.id) })).statusCode).toBe(404);
    const b = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(alpha), payload: bidBody(fr.tranches[0]!.id) }));
    expect((await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/bids`, headers: auth(alpha), payload: bidBody(fr.tranches[0]!.id) })).json().code).toBe('BID_EXISTS');
    const submitted = json<{ version: number }>(await t.app.inject({ method: 'POST', url: `/v1/bids/${b.id}/actions/submit`, headers: auth(alpha, { 'if-match': '"1"' }) }));
    expect((await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/close-early`, headers: auth(s.op), payload: {} })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: `/v1/bids/${b.id}/actions/withdraw`, headers: auth(alpha, { 'if-match': `"${submitted.version}"` }) })).json().code).toBe('RFP_NOT_OPEN');
    const cur = json<{ version: number }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}`, headers: auth(s.op) }));
    expect((await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/cancel`, headers: auth(s.op, { 'if-match': `"${cur.version}"` }), payload: {} })).statusCode).toBe(400);
    const cancelled = await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/cancel`, headers: auth(s.op, { 'if-match': `"${cur.version}"` }), payload: { reason: 'Conditions de marché' } });
    expect(cancelled.json().status).toBe('cancelled');
    expect(json<{ status: string; allowedActions: string[] }>(await t.app.inject({ method: 'GET', url: `/v1/financing-requests/${fr.id}`, headers: auth(s.op) }))).toMatchObject({ status: 'submitted', allowedActions: expect.arrayContaining(['create_rfp']) });
  });
});

describe('data room watermark', () => {
  it('serves invited lenders a watermarked dossier PDF', async () => {
    const { dispatchOutbox } = await import('../../src/jobs');
    const s = await readyScenario(t, { yieldBase: 7, yieldStress: 6 });
    await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) });
    const dossier = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) }));
    await dispatchOutbox(t.ctx);
    const lender = await verifiedLender(t, 'Mutuelle Alpha SFD');
    const { grant } = await import('../../src/core/authz/visibility');
    await t.ctx.db.transaction((tx) => grant(tx, { resourceType: 'dossier', resourceId: dossier.id, granteeOrgId: lender.orgId!, scope: 'read', grantedByEvent: 'test' }));
    const own = json<{ url: string }>(await t.app.inject({ method: 'GET', url: `/v1/dossiers/${dossier.id}/pdf`, headers: auth(s.op) }));
    const theirs = json<{ url: string }>(await t.app.inject({ method: 'GET', url: `/v1/dossiers/${dossier.id}/pdf`, headers: auth(lender) }));
    expect(own.url).not.toContain('wm=');
    expect(theirs.url).toContain('wm=');
    const u = new URL(theirs.url);
    const pdf = await t.app.inject({ method: 'GET', url: u.pathname + u.search });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const ownPdf = await t.app.inject({ method: 'GET', url: new URL(own.url).pathname + new URL(own.url).search });
    expect(pdf.rawPayload.equals(ownPdf.rawPayload)).toBe(false);
    const tampered = await t.app.inject({ method: 'GET', url: (u.pathname + u.search).replace(/wm=[^&]+/, 'wm=eA') });
    expect(tampered.statusCode).toBe(404);
  });
});
