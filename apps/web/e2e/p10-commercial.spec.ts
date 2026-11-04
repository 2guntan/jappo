import { expect, test } from '@playwright/test';
import { ADMIN, E2eApi, PASSWORD, boundaryFile, dbQuery, login, logout, pdf, signupOperator } from './helpers';

test('P10: public pricing, operator self-signup, subscription, per-hectare invoice at season start, admin marks it paid, webhooks', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const email = `p10.${stamp}@kawral.test`;

  // Public pricing from /v1/billing/plans.
  await page.goto('/pricing');
  await expect(page.getByTestId('plan-operator_pro')).toContainText(/4\s000 FCFA/);
  await expect(page.getByTestId('plan-free_partner')).toContainText('Gratuit');

  // Self-signup; KYC verified by the platform admin (API).
  await signupOperator(page, email, `Ferme P10 ${stamp % 10000} SARL`);
  const op = await E2eApi.login(page.request, email, PASSWORD);
  for (const d of ['ninea', 'rccm']) await op.upload('/v1/orgs/current/kyc-documents', { docType: d }, pdf(`${d}.pdf`));
  await op.call('POST', '/v1/orgs/current/actions/submit-kyc');
  const admin = await E2eApi.login(page.request, ADMIN.email, ADMIN.password, ADMIN.totp);
  await admin.call('POST', `/v1/admin/orgs/${op.orgId}/kyc/actions/verify`, {});

  // API logins share the browser cookie jar: sign in again as the operator.
  await page.context().clearCookies();
  await login(page, email, PASSWORD);
  // Subscribe to operator_pro from the billing page.
  await page.goto('/app/settings/billing');
  await page.getByTestId('subscribe-operator_pro').click();
  await expect(page.getByTestId('current-plan')).toBeVisible();

  // A 3 ha season started (self-financed) → invoice 3 × 4 000 + 18 % VAT = 14 160 FCFA.
  const block = await op.call<{ id: string; version: number }>('POST', '/v1/blocks', { name: 'Bloc P10', region: 'Ziguinchor', commune: 'Niaguis', tenureType: 'deliberation' });
  const geometry = JSON.parse(boundaryFile(-16.27, 12.58, 300, 100).buffer.toString()).features[0].geometry;
  await op.call('PUT', `/v1/blocks/${block.id}/boundary`, { geometry }, { 'if-match': `"${block.version}"` });
  const plots = (await op.call<{ data: { id: string }[] }>('POST', `/v1/blocks/${block.id}/plots/actions/auto-grid`, { count: 3 })).data;
  const season = await op.call<{ id: string }>('POST', `/v1/blocks/${block.id}/seasons`, { name: 'Contre-saison 2026-27', kind: 'cold_dry', startDate: '2026-11-15', endDate: '2027-04-30' });
  const maize = (await op.call<{ data: { id: string; code: string }[] }>('GET', '/v1/crops')).data.find((c) => c.code === 'maize')!;
  await op.call('POST', `/v1/seasons/${season.id}/plantings/actions/bulk-assign`, { cropId: maize.id, plotIds: plots.map((p) => p.id), plannedHarvestDate: '2027-03-15' });
  await dbQuery('update plantings set area_ha = 1 where season_id = $1', [season.id]);
  const s = await op.call<{ version: number }>('GET', `/v1/seasons/${season.id}`);
  await op.call('POST', `/v1/seasons/${season.id}/actions/start`, { selfFinanced: true }, { 'if-match': `"${s.version}"` });
  await expect.poll(async () => (await op.call<{ data: unknown[] }>('GET', '/v1/billing/invoices')).data.length, { timeout: 20_000 }).toBe(1);
  await page.reload();
  await expect(page.locator('[data-testid^="platform-invoice-"]')).toHaveText(/14\s160 FCFA/);

  // Webhook registration shows the signing secret once.
  await page.goto('/app/settings/webhooks');
  await page.getByLabel('URL').fill('https://hooks.example.test/jappo');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByTestId('webhook-secret')).toContainText('whsec_');
  await logout(page);
  await page.context().clearCookies();

  // Platform admin marks the invoice paid.
  await login(page, ADMIN.email, ADMIN.password, ADMIN.totp);
  await page.goto('/app/admin/billing');
  const ref = (await op.call<{ data: { ref: string }[] }>('GET', '/v1/billing/invoices')).data[0]!.ref;
  await page.getByLabel(`Référence / motif ${ref}`).fill('VIR-JAPPO-0001');
  await page.getByRole('button', { name: 'Marquer payée' }).first().click();
  await expect(page.getByTestId(`admin-invoice-${ref}`)).toHaveText('Payée');
});
