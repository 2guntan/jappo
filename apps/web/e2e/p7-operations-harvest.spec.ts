import { expect, test } from '@playwright/test';
import { PASSWORD, activeSeasonViaApi, login, logout } from './helpers';

test('P7: visit raises an alert, harvest weighing, dispatch, buyer acceptance, graded invoice, escrow payment confirmed by the lender', async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const s = await activeSeasonViaApi(page.request, stamp);
  const maize = (await s.op.call<{ data: { id: string; code: string }[] }>('GET', '/v1/crops')).data.find((c) => c.code === 'maize')!;
  const oc = await s.op.call<{ id: string; ref: string }>('POST', '/v1/offtake-contracts', { blockId: s.blockId, seasonId: s.seasonId, buyerOrgId: s.buyer.orgId, cropId: maize.id, minVolumeKg: 8000, maxVolumeKg: 20000, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30, paysIntoEscrow: true, qualitySpec: [{ grade: 'A', adjustmentPct: 0 }, { grade: 'B', adjustmentPct: -10 }] });
  await s.op.call('POST', `/v1/offtake-contracts/${oc.id}/actions/mark-signed`, {}, { 'if-match': '"1"' });

  // Operator: field visit with health 1 → critical alert on the block.
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/seasons/${s.seasonId}?tab=operations`);
  await page.getByLabel('Parcelle').selectOption({ index: 1 });
  await page.getByLabel('Santé (1-5)').selectOption('1');
  await page.getByLabel('Rendement estimé (t/ha)').fill('4');
  await page.getByLabel('Ravageurs').check();
  await page.getByRole('button', { name: 'Enregistrer la visite' }).click();
  await expect(page.getByText('1/5')).toBeVisible();
  await page.goto(`/app/blocks/${s.blockId}?tab=alerts`);
  await expect(page.getByTestId('alert-HEALTH_LOW')).toContainText('Critique');

  // Harvest: two weighing tickets in the UI (A and B), then one dispatch.
  await page.goto(`/app/seasons/${s.seasonId}?tab=harvest`);
  const weigh = async (plotIndex: number, gross: string, tare: string, grade: string) => {
    await page.getByLabel('Parcelle').selectOption({ index: plotIndex });
    await page.getByLabel('Poids brut (kg)').fill(gross);
    await page.getByLabel('Tare (kg)').fill(tare);
    await page.getByLabel('Grade').selectOption(grade);
    await page.getByRole('button', { name: 'Enregistrer la pesée' }).click();
    await expect(page.getByText('Pesée enregistrée.')).toBeVisible();
  };
  await weigh(1, '6100', '100', 'A');
  await weigh(2, '4050', '50', 'B');
  await expect(page.getByTestId('harvest-total')).toHaveText(/10\s000 kg/);
  await page.getByLabel(/Sélectionner T-000001/).check();
  await page.getByLabel(/Sélectionner T-000002/).check();
  await page.getByLabel("Contrat d'enlèvement").selectOption(oc.id);
  await page.getByLabel('Véhicule').fill('DK-1234-AB');
  await page.getByRole('button', { name: 'Expédier 2 bon(s)' }).click();
  await expect(page.locator('[data-testid^="dispatch-status-"]')).toHaveText('En route');
  await logout(page);

  // Buyer: accept 9 500 kg, reject 500 kg.
  await login(page, s.buyerEmail, PASSWORD);
  await page.getByRole('link', { name: 'Réceptions' }).click();
  await page.getByLabel(/^Accepté DSP-/).fill('9500');
  await page.getByLabel(/^Refusé DSP-/).fill('500');
  await page.getByLabel(/^Commentaire DSP-/).fill('Humidité trop élevée sur 10 sacs');
  await page.getByRole('button', { name: 'Confirmer la réception' }).click();
  await expect(page.locator('[data-testid^="buyer-dispatch-"]')).toHaveText('Partiellement acceptée');
  await logout(page);

  // Operator invoices: 5 700 kg A × 250 + 3 800 kg B × 225 = 2 280 000 FCFA.
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/seasons/${s.seasonId}?tab=harvest`);
  await page.getByLabel(/Sélectionner DSP-/).check();
  await page.getByRole('button', { name: 'Facturer 1 expédition(s)' }).click();
  await expect(page.locator('[data-testid^="invoice-amount-"]')).toHaveText(/2\s280\s000 FCFA/);
  await logout(page);

  // Buyer declares the transfer into escrow.
  await login(page, s.buyerEmail, PASSWORD);
  await page.getByRole('link', { name: 'Factures et paiements' }).click();
  await page.getByRole('button', { name: 'Déclarer un paiement' }).click();
  await page.getByLabel('Compte séquestre').selectOption({ index: 1 });
  await page.getByLabel('Référence bancaire').fill('ZETA-VIR-001');
  await page.getByRole('button', { name: 'Déclarer le virement' }).click();
  await expect(page.getByTestId('receipt-ZETA-VIR-001')).toHaveText('À confirmer');
  await logout(page);

  // Lender confirms the receipt from the facility page; the invoice is paid.
  await login(page, s.alpha.email, PASSWORD, s.alpha.totpSecret);
  await page.goto(`/app/facilities/${s.facilityId}`);
  await page.getByTestId('confirm-receipt-ZETA-VIR-001').click();
  await expect(page.getByTestId('receipt-status-ZETA-VIR-001')).toHaveText('Confirmé');
  await logout(page);
  await login(page, s.opEmail, PASSWORD);
  await page.goto(`/app/seasons/${s.seasonId}?tab=harvest`);
  await expect(page.locator('[data-testid^="invoice-status-"]')).toHaveText('Payée');
});
