import { Page, expect, test } from '@playwright/test';
import { goTo, startDemo, switchPersona } from './helpers';

/**
 * Design review capture: full-page screenshots of every public page and app screen at desktop and phone widths.
 * Output goes to ../.local/review (never committed). Run with: npx playwright test --project=review
 */
const OUT = '../.local/review';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function hideToasts(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.querySelectorAll('.mat-mdc-snack-bar-container').forEach((e) => e.remove()),
  );
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
}

async function shot(page: Page, vp: string, name: string, fullPage = true): Promise<void> {
  await hideToasts(page);
  if (fullPage) {
    // Scroll through once so reveal-on-scroll sections render, then return to the top.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) {
    console.warn(`[overflow] ${vp}/${name}: ${overflow}px horizontal page scroll`);
  }
  await page.screenshot({ path: `${OUT}/${vp}/${name}.png`, fullPage });
}

for (const vp of VIEWPORTS) {
  test.describe(`review ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('public pages', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(1500);
      await shot(page, vp.name, '01-landing');

      await page.goto('/case-study');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, vp.name, '02-case-study');

      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await shot(page, vp.name, '03-login');

      // Demo start: hold the request to capture the progress screen, then fail it to capture the error state.
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      await page.route('**/api/demo/start', async (route) => {
        await held;
        await route.abort('connectionrefused');
      });
      await page.goto('/demo');
      await page.waitForTimeout(900);
      await shot(page, vp.name, '04-demo-progress', false);
      release();
      await expect(page.getByRole('button', { name: /Try again/ })).toBeVisible();
      await shot(page, vp.name, '05-demo-error', false);
      await page.unroute('**/api/demo/start');
    });

    test('app screens', async ({ page }) => {
      test.setTimeout(180_000);
      await startDemo(page);
      await expect(page.getByRole('table')).toBeVisible();
      await shot(page, vp.name, '10-documents');

      if (vp.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await page.waitForTimeout(300);
        await shot(page, vp.name, '11-mobile-drawer', false);
        await closeDialog(page);
      }

      await page.getByRole('table').getByRole('link', { name: 'MCC-M-23 05 00' }).click();
      await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
      await expect(page.locator('canvas')).toBeVisible();
      await page.waitForTimeout(800);
      await shot(page, vp.name, '12-document-detail');

      await page.getByRole('button', { name: /Raise RFI on this page/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, vp.name, '13-new-rfi-dialog', false);
      await closeDialog(page);

      await goTo(page, 'RFIs');
      await expect(page.getByRole('table')).toBeVisible();
      await shot(page, vp.name, '20-rfis');

      await page.getByRole('table').getByRole('link', { name: 'RFI-003' }).click();
      await expect(page.getByTestId('rfi-state')).toBeVisible();
      await shot(page, vp.name, '21-rfi-detail');

      await switchPersona(page, 'Priya Raman');
      await goTo(page, 'RFIs');
      await page.getByRole('table').getByRole('link', { name: 'RFI-005' }).click();
      await expect(page.getByTestId('rfi-state')).toBeVisible();
      await shot(page, vp.name, '22-rfi-detail-manager');
      const assign = page.getByRole('button', { name: /^(Assign|Reassign)/ }).first();
      if (await assign.isVisible()) {
        await assign.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, vp.name, '23-assign-dialog', false);
        await closeDialog(page);
      }

      await switchPersona(page, 'Marcus Lindqvist');
      await goTo(page, 'Submittals');
      await expect(page.getByRole('table')).toBeVisible();
      await shot(page, vp.name, '30-submittals');
      await page.getByRole('table').getByRole('link', { name: 'SUB-005' }).click();
      await expect(page.getByRole('heading', { name: /Review decisions/ })).toBeVisible();
      await shot(page, vp.name, '31-submittal-detail');
      const decide = page.getByRole('button', { name: /Record decision/ }).first();
      if (await decide.isVisible()) {
        await decide.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, vp.name, '32-decision-dialog', false);
        await closeDialog(page);
      }

      await goTo(page, 'Review queue');
      await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, vp.name, '40-review-queue');

      await goTo(page, 'Insights');
      await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, vp.name, '50-insights');

      await goTo(page, 'Audit');
      await expect(page.getByRole('table')).toBeVisible();
      await shot(page, vp.name, '60-audit');

      await switchPersona(page, 'Dana Okafor');
      await goTo(page, 'Documents');
      await page.getByRole('button', { name: 'Upload document' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, vp.name, '14-upload-dialog', false);
      await closeDialog(page);

      if (vp.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
      }
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.waitForTimeout(300);
      await shot(page, vp.name, '70-profile-menu', false);
      await closeDialog(page);

      await page.goto('/app/does-not-exist');
      await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
      await shot(page, vp.name, '80-not-found', false);
    });
  });
}
