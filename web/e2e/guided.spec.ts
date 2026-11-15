import { expect, test } from '@playwright/test';
import { goTo, openTour, startDemo, switchPersona } from './helpers';

test('guided demo: HVAC spec → history → RFI with page citation → assign → answer → approve → close → audit', async ({
  page,
}) => {
  await startDemo(page);
  // The tour is optional: hidden until "Take the tour" in the profile menu.
  await expect(page.getByRole('region', { name: 'Guided demo task' })).toHaveCount(0);
  await openTour(page);
  await expect(page.getByRole('region', { name: 'Guided demo task' })).toContainText(
    'Open the HVAC specification',
  );

  // 1. Open the HVAC specification.
  await page.getByRole('table').getByRole('link', { name: 'MCC-M-23 05 00' }).click();
  await expect(page.getByRole('heading', { name: 'Version history', exact: true })).toBeVisible();

  // 2. Inspect version history: open the superseded R0, then return to the current R1.
  await page.getByRole('button', { name: /MCC-M-23-05-00_R0\.pdf/ }).click();
  await expect(page.getByRole('heading', { name: /Preview · R0/ })).toBeVisible();
  await page.getByRole('button', { name: /MCC-M-23-05-00_R1\.pdf/ }).click();
  await expect(page.getByRole('heading', { name: /Preview · R1/ })).toBeVisible();

  // 3. Raise an RFI citing R1 page 3.
  await expect(page.getByText('of 4')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: /Raise RFI on this page \(R1 p\.3\)/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Page')).toHaveValue('3');
  await dialog.getByLabel('Subject').fill('RTU-2 trunk duct test pressure');
  await dialog
    .getByLabel('Question')
    .fill('Clause 3.2 lists both 500 Pa and 750 Pa. Which applies to the RTU-2 trunk?');
  await dialog.getByRole('button', { name: 'Create and submit' }).click();
  await expect(page.getByTestId('rfi-state')).toHaveText('Submitted');
  await expect(page.getByText('R1, page 3')).toBeVisible();
  const rfiUrl = page.url();

  // 4. Project manager assigns the mechanical reviewer (dialog).
  await switchPersona(page, 'Priya Raman');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const assign = page.getByRole('dialog');
  await expect(assign.getByRole('heading', { name: 'Assign reviewer' })).toBeVisible();
  await expect(assign.getByLabel('Reviewer')).toContainText('Marcus Lindqvist');
  await assign.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByTestId('rfi-state')).toHaveText('Assigned');

  // 5. Reviewer answers.
  await switchPersona(page, 'Marcus Lindqvist');
  await page.getByLabel('Your answer').fill('Use 750 Pa for the RTU-2 trunk; 500 Pa elsewhere.');
  await page.getByRole('button', { name: 'Post answer' }).click();
  await expect(page.getByTestId('rfi-state')).toHaveText('Answered');

  // 6–7. Project manager approves and closes.
  await switchPersona(page, 'Priya Raman');
  await page.getByRole('button', { name: 'Approve answer' }).click();
  await expect(page.getByRole('button', { name: 'Close RFI' })).toBeVisible();
  await page.getByRole('button', { name: 'Close RFI' }).click();
  await expect(page.getByTestId('rfi-state')).toHaveText('Closed');
  expect(page.url()).toBe(rfiUrl);

  // The activity tab reads as sentences, not field dumps.
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByRole('list', { name: 'RFI activity' })).toContainText(
    'assigned Marcus Lindqvist',
  );

  // 8. Audit trail shows every step.
  await goTo(page, 'Audit');
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
  const table = page.getByRole('table');
  for (const verb of [
    'created',
    'submitted',
    'assigned',
    'answered',
    'answer approved',
    'closed',
  ]) {
    await expect(
      table.getByRole('row').filter({ hasText: 'RFI-010' }).filter({ hasText: verb }).first(),
    ).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Guided demo task' })).toContainText('Done!');
});

test('Reset my demo rebuilds only my workspace', async ({ page }) => {
  await startDemo(page);
  await goTo(page, 'RFIs');
  await page.getByRole('button', { name: 'New RFI' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Document')
    .selectOption({ label: 'MCC-S-201 · Foundation Plan and Details' });
  await expect(dialog.getByLabel('Revision')).toContainText('R0');
  await dialog.getByLabel('Subject').fill('Temporary RFI before reset');
  await dialog.getByLabel('Question').fill('This RFI should disappear after resetting the demo.');
  await dialog.getByRole('button', { name: 'Create and submit' }).click();
  await expect(page.getByTestId('rfi-state')).toHaveText('Submitted');

  await page.getByRole('button', { name: 'Reset my demo' }).click();
  await expect(page.getByText('Your demo workspace was rebuilt from the template.')).toBeVisible();
  await goTo(page, 'RFIs');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('Temporary RFI before reset')).toHaveCount(0);
  await expect(page.getByRole('table').getByRole('link', { name: 'RFI-009' })).toBeVisible();
});
