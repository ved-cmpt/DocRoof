import { expect, test } from '@playwright/test';

/** Renders the social preview image (1200×630) from the real landing page hero. Part of the screenshots project. */
test('capture social preview image', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({
    path: 'public/og-image.png',
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
});
