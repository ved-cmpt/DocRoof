import { expect, test } from '@playwright/test';

/**
 * Captures real screenshots of the running app (seeded fictional data) for the landing page and README.
 * Run with: npx playwright test --project=screenshots
 */
const OUT = 'public/screenshots';

test('capture product screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('link', { name: 'MCC-M-23 05 00' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/register.png` });

  await page.getByRole('link', { name: 'MCC-M-23 05 00' }).click();
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/document-detail.png` });
});
