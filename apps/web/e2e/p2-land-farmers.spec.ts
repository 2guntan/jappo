import { expect, test } from '@playwright/test';
import { boundaryFile, farmersCsv, pdf, signupOperator } from './helpers';

test('P2: build a block with 20 plots and 20 farmers from the UI, then enrol and allocate offline in the PWA and sync', async ({ page, context }) => {
  await signupOperator(page, `p2.${Date.now()}@kawral.test`);

  // Block + boundary import + land document
  await page.getByRole('link', { name: 'Blocs' }).click();
  await page.getByRole('link', { name: 'Nouveau bloc' }).first().click();
  await page.locator('#name').fill('Bloc de Niaguis');
  await page.locator('#commune').fill('Niaguis');
  await page.locator('#village').fill('Niaguis');
  await page.getByRole('button', { name: 'Créer le bloc' }).click();
  await page.waitForURL(/\/app\/blocks\/.+\?tab=land/);
  await expect(page.getByTestId('block-status')).toHaveText('Brouillon');
  await page.getByTestId('boundary-file').setInputFiles(boundaryFile());
  await expect(page.getByText('Limite enregistrée.')).toBeVisible();
  await expect(page.getByText(/· 10\.0\d{3} ha|· 9\.9\d{3} ha/)).toBeVisible();
  await page.locator('#ld-type').selectOption('deliberation');
  await page.locator('#ld-number').fill('DEL-2026-14');
  await page.locator('#ld-file').setInputFiles(pdf('deliberation.pdf'));
  await page.getByRole('button', { name: 'Ajouter un document' }).click();
  await expect(page.getByRole('cell', { name: 'DEL-2026-14' })).toBeVisible();
  await expect(page.getByTestId('block-status')).toHaveText('Documentation');

  // Auto-grid 20 plots
  await page.getByRole('tab', { name: 'Parcelles' }).click();
  await page.locator('#grid-count').fill('20');
  await page.getByRole('button', { name: 'Générer' }).click();
  await expect(page.getByText('Parcelles (20)')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'P-020', exact: true })).toBeVisible();
  const blockUrl = page.url().split('?')[0]!;

  // 20 farmers by CSV import
  await page.getByRole('link', { name: 'Producteurs' }).click();
  await page.getByTestId('farmers-import').setInputFiles(farmersCsv(20));
  await expect(page.getByTestId('import-result')).toHaveText('20 créé(s), 0 mis à jour, 0 en erreur');
  await expect(page.getByRole('link', { name: 'F-000020' })).toBeVisible();

  // Allocate P-001 from the web UI
  await page.goto(`${blockUrl}?tab=plots`);
  await page.getByRole('button', { name: 'Attribuer P-001' }).click();
  await page.locator('#alloc-farmer').selectOption({ index: 1 });
  await page.getByTestId('plot-panel').getByRole('button', { name: 'Attribuer' }).click();
  await expect(page.getByRole('row', { name: /P-001/ })).toContainText('100 %');

  // Field PWA: download, go offline, enrol 2 farmers, allocate P-002 and P-003, come back online, sync
  await page.goto('/field');
  await page.getByLabel(/Bloc de Niaguis/).check();
  await page.getByRole('button', { name: 'Télécharger les données' }).click();
  await expect(page.getByText('Enregistré sur l\'appareil.')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByTestId('online-status')).toHaveText('Hors ligne');
  for (const [first, last] of [['Ramatoulaye', 'Diatta'], ['Ndèye', 'Coly']]) {
    await page.getByRole('button', { name: 'Enrôler un producteur' }).click();
    await page.locator('#fe-first').fill(first!);
    await page.locator('#fe-last').fill(last!);
    await page.locator('#fe-phone').fill(`+2217799${first!.length}${last!.length}00`);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Enregistré sur l\'appareil.')).toBeVisible();
  }
  for (const [plot, name] of [['P-002', 'Ramatoulaye Diatta'], ['P-003', 'Ndèye Coly']]) {
    await page.getByRole('button', { name: 'Attribuer' }).click();
    await page.locator('#al-plot').selectOption({ label: plot! });
    await page.locator('#al-farmer').selectOption({ label: `… · ${name}` });
    await page.getByRole('button', { name: 'Attribuer' }).click();
  }
  await expect(page.getByTestId('pending-count')).toHaveText('4 opération(s) en attente');
  await context.setOffline(false);
  await expect(page.getByTestId('online-status')).toHaveText('En ligne');
  await page.getByRole('button', { name: 'Synchroniser' }).click();
  await expect(page.getByText('Synchronisation terminée : 4 appliquée(s), 0 rejetée(s).')).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveText('0 opération(s) en attente');

  // Server reflects the offline work
  await page.goto(`${blockUrl}?tab=overview`);
  await expect(page.getByTestId('block-plots')).toHaveText('20');
  await expect(page.getByTestId('block-farmers')).toHaveText('3');
  await page.goto('/app/farmers');
  await expect(page.getByRole('link', { name: 'F-000022' })).toBeVisible();
});
