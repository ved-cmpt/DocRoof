import { Page, expect } from '@playwright/test';

/** Starts a fresh guest workspace and waits for the register. */
export async function startDemo(page: Page): Promise<void> {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible({
    timeout: 30_000,
  });
}

/** Opens the sidebar on small screens so the workspace navigation is reachable. */
async function ensureSidebar(page: Page): Promise<void> {
  await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Open navigation' });
  const alreadyOpen = await page.getByRole('button', { name: 'Close navigation' }).isVisible();
  if (!alreadyOpen && (await open.isVisible())) {
    await open.click();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
  }
}

/** Navigates with the sidebar "Workspace" navigation. */
export async function goTo(page: Page, name: string): Promise<void> {
  await ensureSidebar(page);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: new RegExp(`^${name}(\\s|$)`) })
    .click();
}

/**
 * Switches the guest persona from the profile menu (bottom-left). Material menus animate in, so the click is
 * retried with a fresh menu if an item is not yet actionable.
 */
export async function switchPersona(page: Page, name: string): Promise<void> {
  await ensureSidebar(page);
  const trigger = page.getByRole('button', { name: 'Account menu' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click();
    try {
      await page.getByRole('menuitem', { name: 'Switch persona' }).click({ timeout: 5_000 });
      const item = page.getByRole('menuitemradio', { name: new RegExp(name) });
      await expect(item).toBeVisible({ timeout: 5_000 });
      await item.click({ timeout: 5_000 });
      break;
    } catch (error) {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      if (attempt === 2) {
        throw error;
      }
    }
  }
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText(name);
  // On phones, close the drawer again so the page is in its normal state.
  const close = page.getByRole('button', { name: 'Close navigation' });
  if (await close.isVisible()) {
    await close.click();
  }
}

/** Opens the optional guided tour from the profile menu. */
export async function openTour(page: Page): Promise<void> {
  await ensureSidebar(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Take the tour' }).click();
  await expect(page.getByRole('region', { name: 'Guided demo task' })).toBeVisible();
}

/** Dismisses the one-time welcome toast if it is showing. */
export async function dismissToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  for (const b of await dismiss.all()) {
    await b.click().catch(() => undefined);
  }
}
