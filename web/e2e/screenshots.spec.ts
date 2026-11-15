import { expect, test } from '@playwright/test';
import { switchPersona } from './helpers';

/**
 * Captures real screenshots of the running app (seeded fictional data) for the landing page, README and case study.
 * Run with: npx playwright test --project=screenshots
 */
const OUT = 'public/screenshots';

test('capture product screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByRole('link', { name: 'MCC-M-23 05 00' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/register.png` });

  await page.getByRole('link', { name: 'MCC-M-23 05 00' }).click();
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/document-detail.png` });

  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await nav.getByRole('link', { name: 'RFIs' }).click();
  await page.getByRole('table').getByRole('link', { name: 'RFI-004' }).click();
  await expect(page.getByTestId('rfi-state')).toBeVisible();
  await page.screenshot({ path: `${OUT}/rfi-detail.png` });

  await switchPersona(page, 'Marcus Lindqvist');
  await nav.getByRole('link', { name: 'Submittals' }).click();
  await expect(page.getByRole('heading', { name: 'My review queue' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/submittals.png` });

  await nav.getByRole('link', { name: 'Insights' }).click();
  await expect(page.getByRole('heading', { name: 'RFIs opened vs closed per week' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/insights.png`, fullPage: true });
});
