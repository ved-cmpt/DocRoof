import { expect, test } from '@playwright/test';

test('landing → Try the demo → register shows seeded documents', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Every revision. Every answer.',
  );
  await expect(page.getByText('Independent portfolio project')).toBeVisible();

  await page.getByRole('link', { name: 'Try the live demo' }).click();
  await expect(page).toHaveURL(/\/app\/documents/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Demo workspace' })).toBeVisible();

  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: 'MCC-M-23 05 00' })).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(10); // header + 9 seeded Midtown documents

  await table.getByRole('link', { name: 'MCC-M-23 05 00' }).click();
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  await expect(page.getByRole('button', { name: /MCC-M-23-05-00_R0.pdf/ })).toBeVisible();
  await expect(page.getByText('Superseded').first()).toBeVisible();
});
