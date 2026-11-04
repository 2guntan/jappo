import { expect, test } from '@playwright/test';
import { PASSWORD, boundaryFile, login, logout, verifiedOrgViaApi } from './helpers';

test('P3: season plan, offtake price, budget from templates with per-farmer totals, buyer portal', async ({ page, request }) => {
  const stamp = Date.now();
  const opEmail = `p3.op.${stamp}@kawral.test`;
  const buyerEmail = `p3.buyer.${stamp}@zeta.test`;
  // --- Setup through the API: verified operator & buyer, block with 3 allocated plots
  const op = await verifiedOrgViaApi(request, { orgType: 'operator', legalName: 'Ferme Commune Kawral SARL', email: opEmail });
  await verifiedOrgViaApi(request, { orgType: 'buyer', legalName: 'Agro-Négoce Zeta SA', legalForm: 'SA', email: buyerEmail });
  const block = await op.call<{ id: string; version: number }>('POST', '/v1/blocks', { name: 'Bloc Kawral Nord', region: 'Ziguinchor', tenureType: 'deliberation', irrigationType: 'drip', waterSource: 'borehole' });
  const geometry = JSON.parse(boundaryFile(-16.27, 12.58, 300, 100).buffer.toString()).features[0].geometry;
  await op.call('PUT', `/v1/blocks/${block.id}/boundary`, { geometry }, { 'if-match': `"${block.version}"` });
  const plots = (await op.call<{ data: { id: string; code: string; areaHa: number }[] }>('POST', `/v1/blocks/${block.id}/plots/actions/auto-grid`, { count: 3 })).data;
  const names = [['Awa', 'Diatta'], ['Fatou', 'Sané'], ['Mariama', 'Badji']];
  for (const [i, [fn, ln]] of names.entries()) {
    const f = await op.call<{ id: string }>('POST', '/v1/farmers', { firstName: fn, lastName: ln, sex: 'F', consentData: true, consentCreditBureau: true, phone: `+22177300${stamp % 1000}${i}`.slice(0, 13) });
    await op.call('POST', `/v1/plots/${plots[i]!.id}/allocations`, { farmerId: f.id });
  }

  // --- UI: operator plans the season
  await login(page, opEmail, PASSWORD);
  await page.goto(`/app/blocks/${block.id}?tab=seasons`);
  await page.locator('#s-name').fill('Contre-saison 2026-27');
  await page.locator('#s-kind').selectOption('cold_dry');
  await page.locator('#s-start').fill('2026-11-15');
  await page.locator('#s-end').fill('2027-04-30');
  await page.getByRole('button', { name: 'Créer la saison' }).click();
  await page.waitForURL(/\/app\/seasons\//);
  const seasonId = page.url().split('/seasons/')[1]!.split('?')[0]!;
  await expect(page.getByTestId('season-status')).toHaveText('Planification');
  await page.locator('#ba-crop').selectOption({ label: 'Maïs' });
  await page.getByRole('button', { name: 'Affecter', exact: true }).click();
  await expect(page.getByRole('row', { name: /P-003/ })).toContainText('Prix de marché');
  await expect(page.getByRole('cell', { name: '3.2', exact: true }).first()).toBeVisible();

  // Offtake LOI at 250 → becomes the planting price
  await page.goto(`/app/blocks/${block.id}?tab=offtake`);
  await page.locator('#o-buyer').selectOption({ label: 'Agro-Négoce Zeta SA' });
  await page.locator('#o-crop').selectOption({ label: 'Maïs' });
  await page.locator('#o-min').fill('8000');
  await page.locator('#o-max').fill('12000');
  await page.locator('#o-price').fill('250');
  await page.getByRole('button', { name: 'Créer le contrat' }).click();
  const ref = (await page.getByRole('cell', { name: /^OFT-\d{4}-\d{4}$/ }).first().textContent())!;
  await page.getByRole('button', { name: "Lettre d'intention" }).click();
  await expect(page.getByTestId(`offtake-status-${ref}`)).toHaveText("Lettre d'intention");
  await page.goto(`/app/seasons/${seasonId}?tab=plan`);
  await expect(page.getByRole('row', { name: /P-001/ })).toContainText('Contrat d\'achat');
  await expect(page.getByRole('row', { name: /P-001/ })).toContainText('212');

  // Budget generated from templates; per-farmer totals = manual calculation
  await page.getByRole('tab', { name: 'Budget' }).click();
  await page.getByRole('button', { name: 'Générer depuis les itinéraires' }).click();
  await expect(page.getByRole('button', { name: 'Régénérer' })).toBeVisible();
  const lines = (await op.call<{ data: { qty: number; unitPriceXof: number; scope: string; payer: string }[] }>('GET', `/v1/seasons/${seasonId}/budget-lines`)).data;
  const farmers = (await op.call<{ farmers: { farmerCode: string; farmerCreditXof: number; ha: number }[] }>('GET', `/v1/seasons/${seasonId}/budget-summary`)).farmers;
  for (const f of farmers) {
    const manual = lines.filter((l) => l.payer === 'farmer_credit').reduce((s, l) => s + Math.round(l.qty * l.unitPriceXof * f.ha), 0);
    expect(Math.abs(manual - f.farmerCreditXof)).toBeLessThanOrEqual(lines.length);
    await expect(page.getByTestId(`credit-${f.farmerCode}`)).toHaveText(new RegExp(String(f.farmerCreditXof).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s?')));
  }
  await logout(page);

  // Buyer portal
  await login(page, buyerEmail, PASSWORD);
  await page.getByRole('link', { name: 'Mes contrats' }).click();
  await expect(page.getByRole('cell', { name: ref })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Bloc Kawral Nord' })).toBeVisible();
});
