import { expect, test } from '@playwright/test';
import { ADMIN, E2eApi, PASSWORD, boundaryFile, dbQuery, latestLinkToken, lenderViaApi, login, logout, pdf, png, signAsOrg, signupOperator, verifiedOrgViaApi } from './helpers';

/**
 * SPEC §17.1 — full lifecycle acceptance (`pnpm e2e:full`). UI at the decision points (signup, award, settlement,
 * approvals, farmer portal, dashboards); the rest through the same public API the UI uses. Every figure is checked
 * against the golden values (WF-1, BE-1, §17.1 steps 11, 13, 14).
 */
test('full lifecycle: signup → block → dossier → tender → contracts → disbursement → season → harvest → escrow → settlement → statements', async ({ page }) => {
  test.setTimeout(600_000);
  const stamp = Date.now();
  const opEmail = `full.op.${stamp}@kawral.test`;
  const admin = await E2eApi.login(page.request, ADMIN.email, ADMIN.password, ADMIN.totp);

  // 1. Operator signs up (UI) and uploads KYC; admin verifies.
  await signupOperator(page, opEmail, `Ferme Commune Kawral ${stamp % 10000} SARL`);
  const op = await E2eApi.login(page.request, opEmail, PASSWORD);
  for (const d of ['ninea', 'rccm']) await op.upload('/v1/orgs/current/kyc-documents', { docType: d }, pdf(`${d}.pdf`));
  await op.call('POST', '/v1/orgs/current/actions/submit-kyc');
  await admin.call('POST', `/v1/admin/orgs/${op.orgId}/kyc/actions/verify`, {});
  const buyerEmail = `full.buyer.${stamp}@zeta.test`;
  const buyer = await verifiedOrgViaApi(page.request, { orgType: 'buyer', legalName: 'Agro-Négoce Zeta SA', legalForm: 'SA', email: buyerEmail });
  const guarantor = await verifiedOrgViaApi(page.request, { orgType: 'guarantor', legalName: 'Fonds de Garantie Delta', legalForm: 'SA', email: `full.garant.${stamp}@delta.test` });

  // 2. Block, boundary GeoJSON, land documents verified by the admin.
  const block = await op.call<{ id: string; version: number }>('POST', '/v1/blocks', { name: 'Bloc de Niaguis', region: 'Ziguinchor', commune: 'Niaguis', tenureType: 'deliberation', irrigationType: 'drip', waterSource: 'borehole' });
  const bnd = await op.upload('/v1/files', {}, boundaryFile(-16.27, 12.58, 300, 100));
  await op.call('PUT', `/v1/blocks/${block.id}/boundary`, { fileId: bnd.id }, { 'if-match': `"${block.version}"` });
  for (const docType of ['deliberation', 'approval_prefect', 'community_agreement']) {
    const f = await op.upload('/v1/files', {}, pdf(`${docType}.pdf`));
    const d = await op.call<{ id: string }>('POST', `/v1/blocks/${block.id}/land-documents`, { docType, fileId: f.id, number: `${docType.toUpperCase()}-2026` });
    await admin.call('POST', `/v1/admin/land-documents/${d.id}/actions/verify`, {});
  }

  // 3. Auto-grid 3 plots of ~1 ha (pinned to exactly 1 ha); field agent enrols 3 farmers with wallets offline and syncs.
  const plots = (await op.call<{ data: { id: string; code: string }[] }>('POST', `/v1/blocks/${block.id}/plots/actions/auto-grid`, { count: 3, soilType: 'sablo-argileux' })).data;
  await dbQuery('update plots set area_ha = 1 where block_id = $1', [block.id]);
  const phones = [0, 1, 2].map((i) => `+2217${String(stamp).slice(-6)}${i}0`.slice(0, 13));
  const names = [['Awa', 'Diatta'], ['Fatou', 'Sané'], ['Mariama', 'Badji']];
  const ops = names.flatMap(([fn, ln], i) => [
    { clientId: `full-farmer-${stamp}-${i}`, type: 'farmer.create', createdAt: new Date().toISOString(), payload: { firstName: fn, lastName: ln, sex: 'F', birthYear: 1990 + i, phone: phones[i], village: 'Niaguis', consentData: true, consentCreditBureau: true, nationalIdType: 'cni', nationalIdNumber: `1751${String(stamp).slice(-6)}${i}00`, mobileWalletProvider: 'wave', mobileWalletNumber: phones[i] } },
    { clientId: `full-alloc-${stamp}-${i}`, type: 'allocation.create', createdAt: new Date().toISOString(), payload: { plotId: plots[i]!.id, farmerClientId: `full-farmer-${stamp}-${i}`, sharePct: 100 } },
  ]);
  const sync = await op.call<{ results: { status: string; entityId: string }[] }>('POST', '/v1/field/sync', { blockIds: [block.id], ops });
  expect(sync.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied', 'applied']);
  const farmerIds = [0, 2, 4].map((k) => sync.results[k]!.entityId);
  for (const [i, id] of farmerIds.entries()) {
    const f = await op.call<{ version: number }>('GET', `/v1/farmers/${id}`);
    await op.call('POST', `/v1/farmers/${id}/actions/verify-kyc`, undefined, { 'if-match': `"${f.version}"` });
    await op.call('POST', `/v1/farmers/${id}/actions/verify-wallet`);
    const [c] = await dbQuery<{ code: string }>("select data->>'code' as code from notifications where destination = $1 and template_code = 'auth.otp' order by id desc limit 1", [phones[i]]);
    await op.call('POST', `/v1/farmers/${id}/actions/confirm-wallet`, { code: c!.code });
  }

  // 4. Season (maize), budget 1 200 000 / 1 000 000 / 800 000, fees, signed escrow offtake at 250 XOF/kg, guarantee 80 %.
  const season = await op.call<{ id: string }>('POST', `/v1/blocks/${block.id}/seasons`, { name: 'Contre-saison 2026-27', kind: 'cold_dry', startDate: '2026-11-15', endDate: '2027-04-30' });
  const maize = (await op.call<{ data: { id: string; code: string }[] }>('GET', '/v1/crops')).data.find((c) => c.code === 'maize')!;
  const pls = (await op.call<{ data: { id: string; version: number }[] }>('POST', `/v1/seasons/${season.id}/plantings/actions/bulk-assign`, { cropId: maize.id, plotIds: plots.map((p) => p.id), plannedHarvestDate: '2027-03-15' })).data;
  for (const p of pls) await op.call('PATCH', `/v1/plantings/${p.id}`, { yieldBaseTHa: 7, yieldStressTHa: 6 }, { 'if-match': `"${p.version}"` });
  await dbQuery('update plantings set area_ha = 1 where season_id = $1', [season.id]);
  const npk = (await op.call<{ data: { id: string; code: string }[] }>('GET', '/v1/services')).data.find((s) => s.code === 'npk_15_15_15')!;
  for (const [i, amount] of [1_200_000, 1_000_000, 800_000].entries()) await op.call('POST', `/v1/seasons/${season.id}/budget-lines`, { scope: 'plot', plotId: plots[i]!.id, serviceId: npk.id, qty: 1, unitPriceXof: amount, payer: 'farmer_credit', plannedDate: '2026-11-20' });
  await op.call('PUT', `/v1/blocks/${block.id}/fee-policy`, { operatorServiceFeeXofPerFarmerSeason: 50000, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 100000 });
  const oc = await op.call<{ id: string }>('POST', '/v1/offtake-contracts', { blockId: block.id, buyerOrgId: buyer.orgId, cropId: maize.id, minVolumeKg: 15000, maxVolumeKg: 25000, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30, paysIntoEscrow: true });
  await op.call('POST', `/v1/offtake-contracts/${oc.id}/actions/mark-signed`, {}, { 'if-match': '"1"' });
  await op.call('POST', `/v1/blocks/${block.id}/risk-covers`, { type: 'guarantee', providerOrgId: guarantor.orgId, providerName: 'Fonds de Garantie Delta', coveragePct: 80, status: 'committed' });
  await op.call('PUT', `/v1/seasons/${season.id}/model-assumptions`, { seasonal: { rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'bullet', feesChargedTo: 'operator', borrowerType: 'farmers' }, investment: null });

  // 5. Model run, readiness gates all pass, dossier frozen with PDF.
  await op.call('POST', `/v1/seasons/${season.id}/model-runs`);
  const readiness = await op.call<{ gates: { pass: boolean }[] }>('GET', `/v1/seasons/${season.id}/readiness`);
  expect(readiness.gates.every((g) => g.pass)).toBe(true);
  const dossier = await op.call<{ id: string }>('POST', `/v1/seasons/${season.id}/dossiers`);
  await expect.poll(async () => (await dbQuery<{ s: string }>('select pdf_status as s from dossiers where id = $1', [dossier.id]))[0]?.s, { timeout: 60_000 }).toBe('ready');

  // 6. Financing request (seasonal 3 000 000, 6 months bullet) and RFP to the matched lenders Alpha and Gamma.
  const alpha = await lenderViaApi(page.request, `Mutuelle Alpha ${stamp % 10000} SFD`, 'sfd', { name: 'Campagne', regions: ['Ziguinchor'] }, stamp);
  const gamma = await lenderViaApi(page.request, `Fonds Gamma ${stamp % 10000}`, 'dfi', { name: 'Tout', trancheTypes: ['seasonal', 'investment'], maxTenorMonths: 60 }, stamp + 1);
  const fr = await op.call<{ id: string; version: number; tranches: { id: string; amountXof: number }[] }>('POST', '/v1/financing-requests', { dossierId: dossier.id });
  expect(fr.tranches.map((x) => x.amountXof)).toEqual([3_000_000]);
  await op.call('POST', `/v1/financing-requests/${fr.id}/actions/submit`, undefined, { 'if-match': `"${fr.version}"` });
  const matches = await op.call<{ data: { lenderOrgId: string }[] }>('GET', `/v1/financing-requests/${fr.id}/matches`);
  expect(matches.data.map((m) => m.lenderOrgId)).toEqual(expect.arrayContaining([alpha.api.orgId, gamma.api.orgId]));
  const rfp = await op.call<{ id: string; version: number }>('POST', '/v1/rfps', { financingRequestId: fr.id });
  await op.call('POST', `/v1/rfps/${rfp.id}/actions/open`, {}, { 'if-match': `"${rfp.version}"` });

  // 7. Bids; the deadline job closes the RFP; evaluation (EAR 2122 / 2100); operator awards Alpha (UI); Alpha accepts.
  const tr = fr.tranches[0]!.id;
  const ab = await alpha.api.call<{ id: string; version: number }>('POST', `/v1/rfps/${rfp.id}/bids`, { trancheId: tr, amountXof: 3_000_000, rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'bullet', daysToDisbursement: 10, validUntil: '2027-06-30' });
  await alpha.api.call('POST', `/v1/bids/${ab.id}/actions/submit`, undefined, { 'if-match': `"${ab.version}"` });
  const gb = await gamma.api.call<{ id: string; version: number }>('POST', `/v1/rfps/${rfp.id}/bids`, { trancheId: tr, amountXof: 3_000_000, rateBps: 2000, rateMethod: 'flat', upfrontFeeBps: 0, tenorMonths: 6, repaymentProfile: 'bullet', daysToDisbursement: 5, validUntil: '2027-06-30' });
  await gamma.api.call('POST', `/v1/bids/${gb.id}/actions/submit`, undefined, { 'if-match': `"${gb.version}"` });
  await dbQuery("update rfps set deadline_at = now() - interval '1 minute' where id = $1", [rfp.id]);
  await expect.poll(async () => (await op.call<{ status: string }>('GET', `/v1/rfps/${rfp.id}`)).status, { timeout: 120_000, intervals: [5_000] }).toBe('evaluation');
  await page.context().clearCookies();
  await login(page, opEmail, PASSWORD);
  await page.goto(`/app/rfps/${rfp.id}`);
  await expect(page.getByTestId(`ear-Mutuelle Alpha ${stamp % 10000} SFD`)).toHaveText('2122');
  await expect(page.getByTestId(`ear-Fonds Gamma ${stamp % 10000}`)).toHaveText('2100');
  await page.getByLabel(`Montant attribué Mutuelle Alpha ${stamp % 10000} SFD`).fill('3000000');
  await page.getByLabel(`Montant attribué Fonds Gamma ${stamp % 10000}`).fill('0');
  await page.getByRole('button', { name: 'Attribuer' }).click();
  await expect(page.getByTestId('rfp-status')).toHaveText('Attribué');
  const award = (await alpha.api.call<{ data: { id: string }[] }>('GET', '/v1/lender/awards')).data[0]!;
  await alpha.api.call('POST', `/v1/awards/${award.id}/actions/accept`, {});
  const facility = (await alpha.api.call<{ data: { id: string }[] }>('GET', `/v1/facilities?blockId=${block.id}`)).data[0]!;

  // 8. Escrow account; contract pack signed (OTP for organisations, in person for farmers); CPs; four-eyes disbursement.
  const esc = await alpha.api.call<{ id: string }>('POST', '/v1/escrow-accounts', { blockId: block.id, bankName: `Mutuelle Alpha ${stamp % 10000} SFD`, accountLabel: 'Séquestre bloc de Niaguis', accountNumber: 'SN012 01001 000123456789' });
  const pack = await op.call<{ created: number; data: { id: string; type: string; parties: { id: string; partyType: string }[] }[] }>('POST', `/v1/blocks/${block.id}/contracts/actions/generate-pack`, { seasonId: season.id, send: true });
  expect(pack.created).toBe(6);
  const photo = await op.upload('/v1/files', {}, png('signature.png'));
  for (const c of pack.data) {
    if (c.type === 'plot_production') {
      await op.call('POST', `/v1/contracts/${c.id}/signatures`, { partyId: c.parties.find((p) => p.partyType === 'farmer')!.id, method: 'in_person_witnessed', evidenceFileId: photo.id });
      await signAsOrg(op, c.id, opEmail);
    } else {
      await signAsOrg(op, c.id, opEmail);
      if (c.type === 'escrow_mandate') await signAsOrg(buyer, c.id, buyerEmail);
      await signAsOrg(alpha.api, c.id, alpha.email);
      if (c.type === 'block_framework') await signAsOrg(buyer, c.id, buyerEmail);
    }
  }
  const signedCount = (await op.call<{ data: { status: string }[] }>('GET', `/v1/contracts?seasonId=${season.id}`)).data.filter((c) => c.status === 'signed').length;
  expect(signedCount).toBe(6);
  const fac0 = await alpha.api.call<{ version: number }>('GET', `/v1/facilities/${facility.id}`);
  await alpha.api.call('POST', `/v1/facilities/${facility.id}/actions/confirm-cp`, undefined, { 'if-match': `"${fac0.version}"` });
  // Second Alpha credit officer (invited) for four-eyes execution.
  const officerEmail = `officer.${stamp}@alpha.test`;
  await alpha.api.call('POST', '/v1/orgs/current/invitations', { email: officerEmail, roles: ['credit_officer'] });
  await expect.poll(async () => (await dbQuery('select 1 from notifications where destination = $1', [officerEmail])).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const token = await latestLinkToken(officerEmail, 'member.invited');
  await new E2eApi(page.request).call('POST', '/v1/invitations/accept', { token, fullName: 'Ibrahima Ndoye', password: PASSWORD });
  const officer = await E2eApi.login(page.request, officerEmail, PASSWORD);
  const dsb = await op.call<{ id: string }>('POST', `/v1/facilities/${facility.id}/disbursements`, { amountXof: 3_000_000, purpose: 'Intrants campagne (NPK, semences)', beneficiaryType: 'supplier', beneficiaryName: 'Intrants Delta SARL' });
  await alpha.api.call('POST', `/v1/disbursements/${dsb.id}/actions/approve`, {}, { 'if-match': '"1"' });
  await officer.call('POST', `/v1/disbursements/${dsb.id}/actions/execute`, { bankReference: 'VIR-2026-1101' }, { 'if-match': '"2"' });
  await officer.call('POST', `/v1/disbursements/${dsb.id}/actions/confirm`, {}, { 'if-match': '"3"' });

  // 9. Service deliveries, 2 visits per plot, season started.
  const lines = (await op.call<{ data: { id: string; plotId: string }[] }>('GET', `/v1/seasons/${season.id}/budget-lines`)).data;
  for (const [i, l] of lines.entries()) await op.call('POST', `/v1/seasons/${season.id}/service-deliveries`, { budgetLineId: l.id, farmerId: farmerIds[i], qty: 1, supplierName: 'Intrants Delta SARL' });
  for (const p of plots) for (const h of [4, 5]) await op.call('POST', `/v1/plots/${p.id}/visits`, { cropStage: h === 4 ? 'vegetative' : 'flowering', healthScore: h, estimatedYieldTHa: 7 });
  const s0 = await op.call<{ version: number }>('GET', `/v1/seasons/${season.id}`);
  await op.call('POST', `/v1/seasons/${season.id}/actions/start`, { selfFinanced: false }, { 'if-match': `"${s0.version}"` });

  // 10. Harvest 12 000 / 8 000 / 3 000 kg, dispatch accepted fully, invoice 5 750 000, buyer records receipt, Alpha confirms.
  const tickets: string[] = [];
  for (const [i, kg] of [12_000, 8_000, 3_000].entries()) tickets.push((await op.call<{ id: string }>('POST', `/v1/seasons/${season.id}/harvest-deliveries`, { plotId: plots[i]!.id, farmerId: farmerIds[i], grossKg: kg, grade: 'A' })).id);
  const dsp = await op.call<{ id: string }>('POST', `/v1/seasons/${season.id}/dispatches`, { offtakeContractId: oc.id, deliveryIds: tickets, vehicle: 'DK-1234-AB' });
  await buyer.call('POST', `/v1/dispatches/${dsp.id}/actions/accept`, { acceptedKg: 23_000, rejectedKg: 0 }, { 'if-match': '"1"' });
  const inv = await op.call<{ id: string; amountXof: number }>('POST', '/v1/buyer-invoices', { dispatchIds: [dsp.id] });
  expect(inv.amountXof).toBe(5_750_000);
  const rec = await buyer.call<{ id: string }>('POST', '/v1/escrow-receipts', { escrowAccountId: esc.id, amountXof: 5_750_000, valueDate: new Date().toISOString().slice(0, 10), bankReference: `ZETA-${stamp}`, buyerInvoiceId: inv.id });
  await alpha.api.call('POST', `/v1/escrow-receipts/${rec.id}/actions/confirm`, {}, { 'if-match': '"1"' });

  // 11. Settlement = WF-1 figures; operator and Alpha approve (UI); Wave CSV export; confirmations imported; reconciled.
  await page.context().clearCookies(); // API logins share the browser cookie jar
  await login(page, opEmail, PASSWORD);
  await page.goto(`/app/seasons/${season.id}?tab=harvest`);
  await page.getByTestId('compute-settlement').click();
  await page.waitForURL(/\/app\/settlements\//);
  const runId = page.url().split('/settlements/')[1]!;
  const codes = (await op.call<{ data: { id: string; code: string }[] }>('GET', `/v1/farmers?limit=50`)).data.filter((f) => farmerIds.includes(f.id)).sort((a, b) => farmerIds.indexOf(a.id) - farmerIds.indexOf(b.id)).map((f) => f.code);
  await expect(page.getByTestId(`payout-${codes[0]}`)).toHaveText(/1\s542\s000 FCFA/);
  await expect(page.getByTestId(`payout-${codes[1]}`)).toHaveText(/760\s000 FCFA/);
  await expect(page.getByTestId(`payout-${codes[2]}`)).toHaveText(/^0 FCFA/);
  await expect(page.getByTestId('dist-seasonal')).toHaveText(/3\s148\s000 FCFA/);
  await expect(page.getByTestId('dist-farmers')).toHaveText(/2\s302\s000 FCFA/);
  await page.getByTestId('settlement-approve_operator').click();
  await expect(page.getByTestId('settlement-status')).toHaveText('Approuvé (opérateur)');
  await logout(page);
  await login(page, alpha.email, PASSWORD, alpha.totpSecret);
  await page.goto(`/app/settlements/${runId}`);
  await page.getByTestId('settlement-approve_lender').click();
  await expect(page.getByTestId('settlement-status')).toHaveText('Approuvé (prêteurs)');
  await logout(page);
  let run = await op.call<{ version: number }>('GET', `/v1/settlement-runs/${runId}`);
  await op.call('POST', `/v1/settlement-runs/${runId}/actions/instruct`, undefined, { 'if-match': `"${run.version}"` });
  const wave = await (await page.request.fetch(`http://localhost:4100/v1/settlement-runs/${runId}/instructions?format=wave`, { headers: op.headers() })).text();
  const waveRows = wave.trim().split('\n');
  expect(waveRows[0]).toBe('phone_number,amount,currency,name,client_reference');
  expect(waveRows.slice(1).map((r) => r.split(',')[1])).toEqual(['"1542000"', '"760000"']);
  const ins = (await op.call<{ data: { id: string; ref: string; beneficiaryType: string; amountXof: number }[] }>('GET', `/v1/settlement-runs/${runId}/instructions`)).data;
  expect(ins.reduce((s, i) => s + i.amountXof, 0)).toBe(5_750_000);
  await alpha.api.call('POST', `/v1/payout-instructions/${ins.find((i) => i.beneficiaryType === 'lender')!.id}/actions/confirm`, { providerRef: 'ALPHA-INT-1' });
  const csv = ['reference,status,provider_ref,reason', ...ins.filter((i) => i.beneficiaryType !== 'lender').map((i) => `${i.ref},confirmed,WAVE-${i.ref},`)].join('\n');
  const imp = await op.call<{ results: { status: string }[] }>('POST', `/v1/settlement-runs/${runId}/instructions/actions/import-confirmations`, { csv });
  expect(imp.results.every((r) => r.status === 'confirmed')).toBe(true);
  run = await op.call('GET', `/v1/settlement-runs/${runId}`);
  run = await op.call('POST', `/v1/settlement-runs/${runId}/actions/mark-executed`, undefined, { 'if-match': `"${run.version}"` });
  await op.call('POST', `/v1/settlement-runs/${runId}/actions/reconcile`, undefined, { 'if-match': `"${run.version}"` });
  const fac = await alpha.api.call<{ status: string; repaidXof: number }>('GET', `/v1/facilities/${facility.id}`);
  expect(fac).toMatchObject({ status: 'in_arrears', repaidXof: 3_148_000 });
  const f3Arrears = await op.call<{ data: { bucket: string; remainingXof: number }[] }>('GET', `/v1/farmers/${farmerIds[2]}/arrears`);
  expect(f3Arrears.data.find((a) => a.bucket === 'seasonal_debt')!.remainingXof).toBe(122_000);

  // 12. Statements sent by SMS (3 messages); F1 logs in at /me via OTP and downloads the statement.
  await op.call('POST', `/v1/settlement-runs/${runId}/statements/actions/send`);
  await expect.poll(async () => (await dbQuery("select 1 from notifications where template_code = 'settlement.statement_sms' and destination = any($1) and status = 'sent'", [phones])).length, { timeout: 30_000 }).toBe(3);
  await page.context().clearCookies();
  await page.goto('/me');
  await page.getByLabel('Téléphone').fill(phones[0]!);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await expect(page.getByLabel('Code reçu par SMS')).toBeVisible();
  const [otp] = await dbQuery<{ code: string }>("select data->>'code' as code from notifications where destination = $1 and template_code = 'auth.otp' order by id desc limit 1", [phones[0]]);
  await page.getByLabel('Code reçu par SMS').fill(otp!.code);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  const st = page.locator('[data-testid^="farmer-statement-"]');
  await expect(st).toContainText(/versé\s+1\s542\s000 FCFA/);
  const [resp] = await Promise.all([page.waitForResponse((r) => /\/v1\/me\/farmer\/statements\/[^/]+\/pdf$/.test(r.url())), st.getByRole('button', { name: 'PDF' }).click()]);
  expect(resp.status()).toBe(200);
  expect(((await resp.json()) as { url: string }).url).toContain('/v1/files/');

  // 13. Repayment rate at maturity = 3 148 000 / 3 270 000 = 96.27 % (lender portfolio KPI).
  await login(page, alpha.email, PASSWORD, alpha.totpSecret);
  await expect(page.getByTestId('kpi-repaymentRatePct')).toHaveText(/96,27\s%/);
  await logout(page);

  // 14. Platform invoices: per-ha fee 3 ha × 5 000 = 15 000 and structuring fee 1 % × 3 000 000 = 30 000 (excl. VAT).
  await expect.poll(async () => (await op.call<{ data: { amountXof: number }[] }>('GET', '/v1/billing/invoices')).data.map((i) => i.amountXof).sort((a, b) => a - b), { timeout: 30_000 }).toEqual([15_000, 30_000]);
});
