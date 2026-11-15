import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Brand images, part of the screenshots project: the social preview (1200 × 630) from the real landing hero, and
 * PNG icons rendered from public/favicon.svg.
 */
test('capture social preview image', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({
    path: 'public/og-image.png',
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
});

test('render favicon and touch icon PNGs', async ({ page }) => {
  const svg = readFileSync('public/favicon.svg', 'utf8');
  const render = async (size: number, padding: number, background: string, path: string) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:${background};display:grid;place-items:center;width:${size}px;height:${size}px">` +
        `<div style="width:${size - padding * 2}px;height:${size - padding * 2}px">${svg.replace(
          '<svg ',
          '<svg width="100%" height="100%" ',
        )}</div></body></html>`,
    );
    await page.screenshot({ path, omitBackground: background === 'transparent' });
  };
  await render(32, 0, 'transparent', 'public/favicon-32.png');
  await render(180, 22, '#FAFAF7', 'public/apple-touch-icon.png');
});
