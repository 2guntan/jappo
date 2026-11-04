import { expect, test } from '@playwright/test';
import { PASSWORD, lenderViaApi, login, logout, readyScenarioViaApi } from './helpers';

test('P5: financing request, matched tender, sealed bids with live EAR, evaluation, award and acceptance', async ({ page }) => {
  const stamp = Date.now();
  const s = await readyScenarioViaApi(page.request, stamp);
  await s.op.call('PUT', `/v1/seasons/${s.seasonId}/model-assumptions`, { seasonal: { rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'bullet', feesChargedTo: 'operator', borrowerType: 'farmers' }, investment: null });
  await s.op.call('POST', `/v1/seasons/${s.seasonId}/model-runs`);
  await s.op.call('POST', `/v1/seasons/${s.seasonId}/dossiers`);
  const alpha = await lenderViaApi(page.request, `Mutuelle Alpha ${stamp % 10000} SFD`, 'sfd', { name: 'Campagne', regions: ['Ziguinchor'] }, stamp);
  const gamma = await lenderViaApi(page.request, `Fonds Gamma ${stamp % 10000}`, 'dfi', { name: 'Tout', trancheTypes: ['seasonal', 'investment'], maxTenorMonths: 60 }, stamp + 1);

  // Operator: request → submit → tender to matched lenders
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/seasons/${s.seasonId}?tab=financing`);
  await page.getByRole('button', { name: 'Créer la demande depuis le dossier figé' }).click();
  await expect(page.getByTestId('tranche-amount-seasonal')).toHaveText(/3\s000\s000 FCFA/);
  await page.getByRole('button', { name: 'Soumettre la demande' }).click();
  await expect(page.getByTestId('fr-status')).toHaveText('Soumise');
  await expect(page.getByText(`Mutuelle Alpha ${stamp % 10000} SFD`)).toBeVisible();
  await expect(page.getByText(`Fonds Gamma ${stamp % 10000}`)).toBeVisible();
  await page.getByRole('button', { name: "Lancer l'appel d'offres" }).click();
  await page.waitForURL(/\/app\/rfps\//);
  const rfpId = page.url().split('/rfps/')[1]!;
  await expect(page.getByTestId('rfp-status')).toHaveText('Ouvert');
  await expect(page.getByText('Les offres sont scellées jusqu\'à la clôture.')).toBeVisible();
  await logout(page);

  // Lender Alpha (TOTP): opportunity → bid with live EAR → submit
  await login(page, alpha.email, PASSWORD, alpha.totpSecret);
  await page.getByRole('link', { name: 'Opportunités' }).click();
  await page.getByRole('link', { name: 'Voir le dossier' }).click();
  await expect(page.getByText(/Contre-saison|Bloc de Niaguis/).first()).toBeVisible();
  await expect(page.getByTestId('ear-live-seasonal')).toHaveText('2122');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByTestId('bid-status-seasonal')).toHaveText('Brouillon');
  await page.getByRole('button', { name: "Soumettre l'offre (comité)" }).click();
  await expect(page.getByTestId('bid-status-seasonal')).toHaveText('Soumise');
  await logout(page);

  // Lender Gamma bids through the API: 20 % flat, no fee, 5 days
  const tr = (await gamma.api.call<{ tranches: { id: string }[] }>('GET', `/v1/rfps/${rfpId}`)).tranches[0]!;
  const gb = await gamma.api.call<{ id: string; version: number }>('POST', `/v1/rfps/${rfpId}/bids`, { trancheId: tr.id, amountXof: 3_000_000, rateBps: 2000, rateMethod: 'flat', upfrontFeeBps: 0, tenorMonths: 6, repaymentProfile: 'bullet', daysToDisbursement: 5, validUntil: '2027-06-30' });
  await gamma.api.call('POST', `/v1/bids/${gb.id}/actions/submit`, undefined, { 'if-match': `"${gb.version}"` });

  // Operator: close (all invitees bid) → evaluation → award Alpha (override of the suggestion)
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/rfps/${rfpId}`);
  await page.getByRole('button', { name: 'Clôturer maintenant' }).click();
  await expect(page.getByTestId('rfp-status')).toHaveText('Évaluation');
  await expect(page.getByTestId(`ear-Mutuelle Alpha ${stamp % 10000} SFD`)).toHaveText('2122');
  await expect(page.getByTestId(`ear-Fonds Gamma ${stamp % 10000}`)).toHaveText('2100');
  await page.getByLabel(`Montant attribué Mutuelle Alpha ${stamp % 10000} SFD`).fill('3000000');
  await page.getByLabel(`Montant attribué Fonds Gamma ${stamp % 10000}`).fill('0');
  await page.getByRole('button', { name: 'Attribuer' }).click();
  await expect(page.getByTestId('rfp-status')).toHaveText('Attribué');
  await expect(page.getByTestId(`award-status-Mutuelle Alpha ${stamp % 10000} SFD`)).toHaveText('Proposée');
  await logout(page);

  // Alpha accepts
  await login(page, alpha.email, PASSWORD, alpha.totpSecret);
  await page.getByRole('link', { name: 'Attributions' }).click();
  await page.getByRole('button', { name: 'Accepter' }).click();
  await expect(page.locator('[data-testid^="my-award-"]')).toHaveText('Acceptée');
});
