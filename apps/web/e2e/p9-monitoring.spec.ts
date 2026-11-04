import { expect, test } from '@playwright/test';
import { PASSWORD, login, logout, settledViaApi, verifiedOrgViaApi } from './helpers';

test('P9: operator and lender dashboards, block monitoring, guarantor exposure, PDF reports', async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const gEmail = `garant.${stamp}@delta.test`;
  const g = await verifiedOrgViaApi(page.request, { orgType: 'guarantor', legalName: 'Fonds de Garantie Delta', legalForm: 'SA', email: gEmail });
  const s = await settledViaApi(page.request, stamp, async (x) => {
    await x.op.call('POST', `/v1/blocks/${x.blockId}/risk-covers`, { type: 'guarantee', providerOrgId: g.orgId, providerName: 'Fonds de Garantie Delta', coveragePct: 50, capXof: 1_000_000, status: 'committed' });
  });

  // Operator home dashboard and block monitoring.
  await login(page, s.opEmail, PASSWORD);
  await expect(page.getByTestId('operator-dashboard')).toBeVisible();
  await expect(page.getByTestId('kpi-farmers')).toHaveText('3');
  await expect(page.getByTestId('kpi-farmerNetIncomeAvgXof')).toHaveText(/767\s333 FCFA/);
  await page.goto(`/app/blocks/${s.blockId}?tab=monitoring`);
  await expect(page.getByTestId('kpi-deliveredKg')).toHaveText(/23\s000 kg/);
  await page.getByRole('link', { name: 'Rapports' }).click();
  await page.getByLabel('Bloc').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Générer le rapport' }).click();
  await expect(page.getByTestId('report-season_close')).toHaveText('ready');
  await logout(page);

  // Lender: portfolio KPIs and monthly report.
  await login(page, s.alpha.email, PASSWORD, s.alpha.totpSecret);
  await expect(page.getByTestId('lender-dashboard')).toBeVisible();
  await expect(page.getByTestId('kpi-outstanding')).toHaveText(/122\s000 FCFA/);
  await page.getByRole('link', { name: 'Rapports' }).click();
  await page.getByRole('button', { name: 'Générer le rapport' }).click();
  await expect(page.getByTestId('report-lender_monthly')).toHaveText('ready');
  await logout(page);

  // Guarantor: covered facility exposure (50 % of 122 000) and read-only block monitoring.
  await login(page, gEmail, PASSWORD);
  await page.getByRole('link', { name: 'Portefeuille garanti' }).click();
  await expect(page.locator('[data-testid^="exposure-"]')).toHaveText(/61\s000 FCFA/);
  await page.getByRole('link', { name: /BLK-/ }).click();
  await expect(page.getByTestId('block-monitoring')).toBeVisible();
});
