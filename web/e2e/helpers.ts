import { Page, expect } from '@playwright/test';

/**
 * Switches the guest persona through the top-bar menu. Material menus animate in, so the click is retried with a
 * fresh menu if the item is not yet actionable.
 */
export async function switchPersona(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Switch demo persona' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click();
    const item = page.getByRole('menuitem', { name: new RegExp(name) });
    try {
      await expect(item).toBeVisible({ timeout: 5_000 });
      await item.click({ timeout: 5_000 });
      break;
    } catch (error) {
      await page.keyboard.press('Escape');
      if (attempt === 2) {
        throw error;
      }
    }
  }
  await expect(trigger).toContainText(name);
}
