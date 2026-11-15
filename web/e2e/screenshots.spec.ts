import { Page, expect, test } from '@playwright/test';
import { goTo, startDemo, switchPersona } from './helpers';

/**
 * Captures crisp (2x) product images from the running app with seeded, fictional data: README screenshots and the
 * tightly cropped landing/case-study product-tour images (1184 × 660 CSS px).
 * Run with: npx playwright test --project=screenshots
 */
const OUT = 'public/screenshots';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.querySelectorAll('.mat-mdc-snack-bar-container').forEach((e) => e.remove()),
  );
  await page.mouse.move(0, 899);
  await page.waitForTimeout(500);
}

/** Crops the content area (right of the sidebar, below the top bar) to a fixed 1184 × 660 frame. */
async function tour(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({
    path: `${OUT}/tour-${name}.png`,
    clip: { x: 248, y: 60, width: 1184, height: 660 },
  });
}

test('capture product screenshots', async ({ page }) => {
  test.setTimeout(150_000);
  await startDemo(page);
  // Dismiss the demo pill so the top bar is calm in marketing images.
  await page.getByRole('button', { name: 'Dismiss demo notice' }).click();
  await expect(page.getByRole('link', { name: 'MCC-M-23 05 00' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/register.png` });
  await tour(page, 'documents');

  await page.getByRole('link', { name: 'MCC-M-23 05 00' }).click();
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);
  await settle(page);
  await page.screenshot({ path: `${OUT}/document-detail.png` });

  await switchPersona(page, 'Priya Raman');
  await goTo(page, 'RFIs');
  await page.getByRole('table').getByRole('link', { name: 'RFI-003' }).click();
  await expect(page.getByTestId('rfi-state')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/rfi-detail.png` });
  await tour(page, 'rfis');

  await switchPersona(page, 'Marcus Lindqvist');
  await goTo(page, 'Submittals');
  await page.getByRole('table').getByRole('link', { name: 'SUB-002' }).click();
  await expect(page.getByRole('heading', { name: 'Review decisions' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/submittals.png` });
  await tour(page, 'submittals');

  await goTo(page, 'Insights');
  await expect(page.getByRole('heading', { name: 'RFIs opened vs closed per week' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/insights.png` });
  await tour(page, 'insights');
});
