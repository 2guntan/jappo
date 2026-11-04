import { expect, test } from '@playwright/test';
import { PASSWORD, activeSeasonViaApi, dbQuery, login, logout } from './helpers';

test('P8: settlement waterfall (WF-1 figures), approvals, instructions, confirmations, reconciliation, farmer statement in the portal', async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const s = await activeSeasonViaApi(page.request, stamp);
  // WF-1 fixture: 1 ha plots, deliveries 12 000 / 8 000 / 3 000 kg at 250 XOF, 5 750 000 paid into escrow.
  await dbQuery('update plots set area_ha = 1 where block_id = $1', [s.blockId]);
  await dbQuery('update plantings set area_ha = 1 where season_id = $1', [s.seasonId]);
  const plots = (await s.op.call<{ data: { id: string; farmers: { farmerId: string }[] }[] }>('GET', `/v1/blocks/${s.blockId}/plots`)).data;
  const tickets: string[] = [];
  for (const [i, f] of s.farmers.entries()) {
    const p = plots.find((x) => x.farmers.some((y) => y.farmerId === f.id))!;
    tickets.push((await s.op.call<{ id: string }>('POST', `/v1/seasons/${s.seasonId}/harvest-deliveries`, { plotId: p.id, farmerId: f.id, grossKg: [12_000, 8_000, 3_000][i], grade: 'A' })).id);
  }
  const d = await s.op.call<{ id: string }>('POST', `/v1/seasons/${s.seasonId}/dispatches`, { offtakeContractId: s.offtakeId, deliveryIds: tickets });
  await s.buyer.call('POST', `/v1/dispatches/${d.id}/actions/accept`, { acceptedKg: 23_000, rejectedKg: 0 }, { 'if-match': '"1"' });
  const inv = await s.op.call<{ id: string }>('POST', '/v1/buyer-invoices', { dispatchIds: [d.id] });
  await s.alpha.api.call('POST', '/v1/escrow-receipts', { escrowAccountId: s.escrowAccountId, amountXof: 5_750_000, valueDate: new Date().toISOString().slice(0, 10), bankReference: `ZETA-${stamp}`, buyerInvoiceId: inv.id });

  // Operator computes from the harvest tab and approves.
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/seasons/${s.seasonId}?tab=harvest`);
  await page.getByTestId('compute-settlement').click();
  await page.waitForURL(/\/app\/settlements\//);
  const runId = page.url().split('/settlements/')[1]!;
  const codes = s.farmers.map((f) => f.code);
  await expect(page.getByTestId(`payout-${codes[0]}`)).toHaveText(/1\s542\s000 FCFA/);
  await expect(page.getByTestId(`payout-${codes[1]}`)).toHaveText(/760\s000 FCFA/);
  await expect(page.getByTestId(`payout-${codes[2]}`)).toHaveText(/^0 FCFA/);
  await expect(page.getByTestId('dist-seasonal')).toHaveText(/3\s148\s000 FCFA/);
  await expect(page.getByTestId('dist-farmers')).toHaveText(/2\s302\s000 FCFA/);
  await page.getByTestId('settlement-approve_operator').click();
  await expect(page.getByTestId('settlement-status')).toHaveText('Approuvé (opérateur)');
  await logout(page);

  // Lender approves.
  await login(page, s.alpha.email, PASSWORD, s.alpha.totpSecret);
  await page.getByRole('link', { name: 'Règlements' }).click();
  await page.getByRole('link', { name: /STL-/ }).click();
  await page.getByTestId('settlement-approve_lender').click();
  await expect(page.getByTestId('settlement-status')).toHaveText('Approuvé (prêteurs)');
  await logout(page);

  // Operator issues instructions and confirms farmer and operator payouts.
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/settlements/${runId}`);
  await page.getByTestId('settlement-instruct').click();
  await expect(page.getByTestId('settlement-status')).toHaveText('Instructions émises');
  const ins = (await s.op.call<{ data: { ref: string; beneficiaryType: string }[] }>('GET', `/v1/settlement-runs/${runId}/instructions`)).data;
  for (const i of ins.filter((x) => x.beneficiaryType !== 'lender')) {
    await page.getByTestId(`confirm-${i.ref}`).click();
    await expect(page.getByTestId(`instruction-status-${i.ref}`)).toHaveText('Confirmé');
  }
  await page.getByTestId('send-statements').click();
  await expect(page.getByText('Relevés envoyés.')).toBeVisible();
  await logout(page);

  // Lender confirms its own line → repayment posted on the facility.
  await login(page, s.alpha.email, PASSWORD, s.alpha.totpSecret);
  await page.goto(`/app/settlements/${runId}`);
  const lenderRef = ins.find((x) => x.beneficiaryType === 'lender')!.ref;
  await page.getByTestId(`confirm-${lenderRef}`).click();
  await expect(page.getByTestId(`instruction-status-${lenderRef}`)).toHaveText('Confirmé');
  await page.goto(`/app/facilities/${s.facilityId}`);
  await expect(page.getByRole('cell', { name: 'settlement', exact: true })).toBeVisible();
  await logout(page);

  // Operator marks executed and reconciles: season closed.
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/settlements/${runId}`);
  await page.getByTestId('settlement-mark_executed').click();
  await expect(page.getByTestId('settlement-status')).toHaveText('Exécuté');
  await page.getByTestId('settlement-reconcile').click();
  await expect(page.getByTestId('settlement-status')).toHaveText('Rapproché');
  await logout(page);

  // Farmer portal: SMS login, statement with the payout.
  const phone = `+2217${String(stamp).slice(-6)}00`.slice(0, 13);
  await page.goto('/me');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await expect(page.getByLabel('Code reçu par SMS')).toBeVisible();
  const [otp] = await dbQuery<{ code: string }>("select data->>'code' as code from notifications where destination = $1 and template_code = 'auth.otp' order by id desc limit 1", [phone]);
  await page.getByLabel('Code reçu par SMS').fill(otp!.code);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByTestId('farmer-profile')).toContainText('Awa');
  await expect(page.locator('[data-testid^="farmer-statement-"]')).toContainText(/versé\s+1\s542\s000 FCFA/);
});
