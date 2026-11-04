import { expect, test } from '@playwright/test';
import { ADMIN, PASSWORD, latestLinkToken, login, logout, pdf } from './helpers';

test('P1: operator signs up, uploads KYC, admin verifies, operator invites a field agent who joins', async ({ page }) => {
  const email = `awa.${Date.now()}@kawral.test`;

  // 1. Public signup
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('fermes-blocs');
  await page.goto('/signup?type=operator');
  await page.locator('#legalName').fill('Ferme Commune Kawral SARL');
  await page.locator('#legalForm').selectOption('SARL');
  await page.locator('#fullName').fill('Awa Diallo');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL('**/app');
  await expect(page.getByRole('heading', { name: 'Bonjour Awa Diallo' })).toBeVisible();
  await expect(page.getByText(/pas encore vérifiée/)).toBeVisible();

  // 2. KYC upload + submit
  await page.getByRole('link', { name: 'Compléter le KYC' }).click();
  await expect(page.getByTestId('kyc-status')).toHaveText('En attente');
  for (const doc of ['ninea', 'rccm']) {
    await page.locator('#docType').selectOption(doc);
    await page.locator('#kycFile').setInputFiles(pdf(`${doc}.pdf`));
    await page.getByRole('button', { name: 'Déposer' }).click();
    await expect(page.getByText(`${doc}.pdf`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Soumettre pour vérification' }).click();
  await expect(page.getByTestId('kyc-status')).toHaveText('Soumis');
  await logout(page);

  // 3. Platform admin (TOTP) verifies
  await login(page, ADMIN.email, ADMIN.password, ADMIN.totp);
  await page.getByRole('link', { name: 'File KYC' }).click();
  const row = page.getByRole('row', { name: /Ferme Commune Kawral SARL/ }).first();
  await row.getByRole('link', { name: 'Examiner' }).click();
  await expect(page.getByText('ninea.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Valider le KYC' }).click();
  await expect(page.getByTestId('admin-kyc-status')).toHaveText('Vérifié');
  await page.getByRole('link', { name: "Journal d'audit" }).click();
  await page.getByRole('button', { name: 'Vérifier la chaîne' }).click();
  await expect(page.getByText(/Chaîne intègre/)).toBeVisible();
  await logout(page);

  // 4. Operator sees verified status + notification; invites a field agent
  await login(page, email, PASSWORD);
  await expect(page.getByTestId('unread-count')).toBeVisible();
  await page.goto('/app/settings/organization');
  await expect(page.getByTestId('kyc-status')).toHaveText('Vérifié');
  await page.goto('/app/settings/members');
  await page.locator('#inv-email').fill('moussa.agent@kawral.test');
  await page.getByLabel('Agent de terrain').check();
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect(page.getByText('Invitation envoyée.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'moussa.agent@kawral.test' })).toBeVisible();
  await logout(page);

  // 5. Invitee accepts and logs in
  const token = await latestLinkToken('moussa.agent@kawral.test', 'member.invited');
  await page.goto(`/invite?token=${token}`);
  await expect(page.getByRole('heading', { name: /Rejoindre Ferme Commune Kawral SARL/ })).toBeVisible();
  await page.locator('#fullName').fill('Moussa Sané');
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: "Accepter l'invitation" }).click();
  await page.waitForURL('**/app');
  await expect(page.getByRole('heading', { name: 'Bonjour Moussa Sané' })).toBeVisible();
  await logout(page);
  await login(page, 'moussa.agent@kawral.test', PASSWORD);
  await expect(page.getByRole('link', { name: 'Membres' })).toHaveCount(0);
});
