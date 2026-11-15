import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { goTo, startDemo, switchPersona } from './helpers';

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(' | ')}`,
  );
  expect(summary, summary.join('\n')).toEqual([]);
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('accessibility (axe, WCAG 2.1 A/AA rules)', () => {
  test('landing page has no detectable violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await axe(page);
  });

  test('sign-in page has no detectable violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await axe(page);
  });

  test('document register has no detectable violations', async ({ page }) => {
    await startDemo(page);
    await expect(page.getByRole('table')).toBeVisible();
    await axe(page);
  });

  test('RFI detail has no detectable violations', async ({ page }) => {
    await startDemo(page);
    await goTo(page, 'RFIs');
    await page.getByRole('table').getByRole('link', { name: 'RFI-003' }).click();
    await expect(page.getByTestId('rfi-state')).toHaveText('Answered');
    await axe(page);
  });

  test('insights and the New RFI dialog have no detectable violations', async ({ page }) => {
    await startDemo(page);
    await goTo(page, 'Insights');
    await expect(
      page.getByRole('heading', { name: 'RFIs opened vs closed per week' }),
    ).toBeVisible();
    await axe(page);
    await goTo(page, 'RFIs');
    await page.getByRole('button', { name: 'New RFI' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await axe(page);
  });
});

test('mobile viewport: landing, demo and register work without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Try the live demo' })).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await page.getByRole('link', { name: 'Try the live demo' }).click();
  await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('table').getByRole('link', { name: 'MCC-M-23 05 00' })).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  // The sidebar becomes a drawer.
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeHidden();
});

test('dialogs fit a 390 px screen as a full-height sheet with the actions visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page);
  await goTo(page, 'RFIs');
  await page.getByRole('button', { name: 'New RFI' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole('button', { name: 'Create and submit' })).toBeInViewport();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
});

test('keyboard only: skip link, primary navigation and opening a document', async ({ page }) => {
  await page.goto('/');
  // Wait for the lazily loaded page before tabbing, so focus order is final.
  await expect(page.getByRole('link', { name: 'Try the live demo' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);

  // Reach "Try the live demo" with Tab only, then activate it with Enter.
  let reached = false;
  for (let i = 0; i < 25 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(
      () => document.activeElement?.textContent?.trim() === 'Try the live demo',
    );
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByRole('table').getByRole('link', { name: 'MCC-M-23 05 00' })).toBeVisible();
  // Tab to the first document link and open it with Enter.
  let onDocument = false;
  for (let i = 0; i < 60 && !onDocument; i++) {
    await page.keyboard.press('Tab');
    onDocument = await page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.closest('td')?.classList.contains('num') ??
        false,
    );
  }
  expect(onDocument).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
});

test('review queue lists the work waiting on a reviewer', async ({ page }) => {
  await startDemo(page);
  await switchPersona(page, 'Marcus Lindqvist');
  await goTo(page, 'Review queue');
  await expect(page.getByRole('tab', { name: 'Waiting on me' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page
      .getByRole('table')
      .getByRole('link', { name: /^(RFI|SUB)-/ })
      .first(),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Overdue' }).click();
  await expect(page.getByRole('tab', { name: 'Overdue' })).toHaveAttribute('aria-selected', 'true');
});

test('extraction: rules-based suggestions cite pages, can be viewed and accepted; scans show the limitation', async ({
  page,
}) => {
  await startDemo(page);
  await switchPersona(page, 'Dana Okafor');
  await page.getByRole('table').getByRole('link', { name: 'MCC-M-23 31 00' }).click();
  await expect(page.getByTestId('engine-label')).toHaveText('Rules-based extraction');
  await page.getByRole('button', { name: /Suggest metadata from R0/ }).click();
  const spec = page.getByRole('button', { name: 'Accept Spec section 23 31 00' });
  await expect(spec).toBeVisible();
  // Move the preview away from page 1, then jump back through a suggestion citation.
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('2');
  await page.getByRole('button', { name: 'View on page 1' }).first().click();
  await expect(page.getByLabel('Page number')).toHaveValue('1');
  await spec.click();
  await expect(page.getByTestId('doc-properties')).toContainText('23 31 00');

  await page.goto('/app/documents');
  await page.getByRole('table').getByRole('link', { name: 'MCC-A-101' }).click();
  await expect(page.getByTestId('extraction-limitation')).toHaveText(
    'No text layer detected — extraction unavailable (no OCR configured).',
  );
});
