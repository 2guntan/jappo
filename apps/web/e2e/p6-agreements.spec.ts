import { expect, test } from '@playwright/test';
import { PASSWORD, awardedViaApi, login, logout, png, signAsOrg, signatureCode } from './helpers';

type Contract = { id: string; type: string; status: string; parties: { id: string; partyType: string; canSign: boolean }[] };

test('P6: escrow account, contract pack with OTP and witnessed signatures, CP confirmation and disbursement', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const s = await awardedViaApi(page.request, stamp);

  // Lender: open the facility from the award, set up the escrow account.
  await login(page, s.alpha.email, PASSWORD, s.alpha.totpSecret);
  await page.getByRole('link', { name: 'Attributions' }).click();
  await page.locator('[data-testid^="award-facility-"]').click();
  await expect(page.getByTestId('facility-status')).toHaveText('Conditions préalables');
  await expect(page.getByTestId('schedule-total-1')).toHaveText(/3\s270\s000 FCFA/);
  await page.getByLabel('Banque').fill('Mutuelle Alpha SFD');
  await page.getByLabel('Intitulé du compte').fill('Séquestre bloc de Niaguis');
  await page.getByLabel('Numéro de compte').fill('SN012 01001 000123456789');
  await page.getByRole('button', { name: 'Ouvrir le compte séquestre' }).click();
  await expect(page.getByTestId('escrow-linked')).toContainText('**** 6789');
  await expect(page.getByTestId('cp-escrow_account_linked')).toContainText('✔');
  await logout(page);

  // Operator: generate and send the pack from the season financing tab, then sign the framework with an e-mail code.
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/seasons/${s.seasonId}?tab=financing`);
  await page.getByTestId('generate-pack').click();
  await expect(page.getByTestId('pack-progress')).toHaveText('0 contrat(s) signé(s) sur 6');
  await page.goto(`/app/contracts?seasonId=${s.seasonId}`);
  await expect(page.locator('[data-testid^="contract-status-"]')).toHaveCount(6);
  const contracts = (await s.op.call<{ data: Contract[] }>('GET', `/v1/contracts?seasonId=${s.seasonId}`)).data;
  const framework = contracts.find((c) => c.type === 'block_framework')!;
  await page.goto(`/app/contracts/${framework.id}`);
  await expect(page.getByTestId('contract-status')).toHaveText('En signature');
  await expect(page.getByTestId('content-hash')).toHaveText(/SHA-256 : [0-9a-f]{64}/);
  await page.getByRole('button', { name: 'Recevoir mon code de signature' }).click();
  await expect(page.getByLabel(/Code envoyé à/)).toBeVisible();
  await page.getByLabel(/Code envoyé à/).fill(await signatureCode(s.opEmail));
  await page.getByRole('button', { name: 'Signer', exact: true }).click();
  await expect(page.getByTestId('contract-status')).toHaveText('Partiellement signé');

  // Field agent (operator user) in the PWA: witnessed in-person signature with a photo for one farmer.
  await page.goto('/field');
  await page.getByTestId('field-sign').click();
  const firstCard = page.locator('[data-testid^="field-contract-"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.getByLabel('Photo de la signature').setInputFiles(png('signature.png'));
  await firstCard.getByRole('button', { name: 'Signer en personne (témoin)' }).click();
  await expect(page.locator('[data-testid^="field-contract-"]')).toHaveCount(2);
  await page.goto('/app');
  await logout(page);

  // Remaining signatures through the API (same endpoints): farmers in person, operator countersigns, lender and buyer.
  const evidence = await s.op.upload('/v1/files', {}, png('photo.png'));
  for (const c of contracts.filter((x) => x.type === 'plot_production')) {
    const cur = await s.op.call<Contract>('GET', `/v1/contracts/${c.id}`);
    const farmer = cur.parties.find((p) => p.partyType === 'farmer' && p.canSign);
    if (farmer) await s.op.call('POST', `/v1/contracts/${c.id}/signatures`, { partyId: farmer.id, method: 'in_person_witnessed', evidenceFileId: evidence.id });
    await signAsOrg(s.op, c.id, s.opEmail);
  }
  const loan = contracts.find((c) => c.type === 'loan_seasonal')!;
  const mandate = contracts.find((c) => c.type === 'escrow_mandate')!;
  await signAsOrg(s.op, loan.id, s.opEmail);
  await signAsOrg(s.op, mandate.id, s.opEmail);
  await signAsOrg(s.buyer, mandate.id, s.buyerEmail);
  await signAsOrg(s.alpha.api, framework.id, s.alpha.email);
  await signAsOrg(s.buyer, framework.id, s.buyerEmail);
  await signAsOrg(s.alpha.api, mandate.id, s.alpha.email);

  // Lender signs the loan contract in the UI, then confirms the CPs.
  await login(page, s.alpha.email, PASSWORD, s.alpha.totpSecret);
  await page.goto(`/app/contracts/${loan.id}`);
  await page.getByRole('button', { name: 'Recevoir mon code de signature' }).click();
  await expect(page.getByLabel(/Code envoyé à/)).toBeVisible();
  await page.getByLabel(/Code envoyé à/).fill(await signatureCode(s.alpha.email));
  await page.getByRole('button', { name: 'Signer', exact: true }).click();
  await expect(page.getByTestId('contract-status')).toHaveText('Signé');
  await page.getByRole('link', { name: 'Voir la facilité' }).click();
  await expect(page.getByTestId('cp-loan_contract_signed')).toContainText('✔');
  await page.getByTestId('confirm-cp').click();
  await expect(page.getByTestId('facility-status')).toHaveText('Active');
  await logout(page);

  // Operator requests the disbursement.
  await login(page, s.opEmail, PASSWORD);
  await page.getByRole('link', { name: 'Facilités' }).click();
  await page.getByRole('link', { name: s.facilityRef }).click();
  await page.getByLabel('Objet').fill('Intrants campagne (NPK, semences)');
  await page.getByLabel('Nom du fournisseur').fill('Intrants Delta SARL');
  await page.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(page.locator('[data-testid^="disbursement-status-"]')).toHaveText('Demandé');
  await logout(page);

  // Lender (single credit officer: no four-eyes constraint) approves, executes with a bank reference and confirms.
  await login(page, s.alpha.email, PASSWORD, s.alpha.totpSecret);
  await page.goto(`/app/facilities/${s.facilityId}`);
  await page.locator('[data-testid^="approve-"]').click();
  await expect(page.locator('[data-testid^="disbursement-status-"]')).toHaveText('Approuvé');
  await page.getByLabel('Référence bancaire').fill('VIR-2026-1101');
  await page.locator('[data-testid^="execute-"]').click();
  await expect(page.locator('[data-testid^="disbursement-status-"]')).toHaveText('Exécuté');
  await page.locator('[data-testid^="confirm-"]').click();
  await expect(page.locator('[data-testid^="disbursement-status-"]')).toHaveText('Confirmé');
  await expect(page.getByTestId('disbursed')).toHaveText(/3\s000\s000 FCFA/);
  await logout(page);

  // Operator: block financed, pack fully signed.
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/seasons/${s.seasonId}?tab=financing`);
  await expect(page.getByTestId('pack-progress')).toHaveText('6 contrat(s) signé(s) sur 6');
});
