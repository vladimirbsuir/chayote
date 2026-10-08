import { expect, test } from '@playwright/test';

/* The M0 shell is the top bar plus a first-launch empty state. M2 adds the
   editor, so the smoke test drives one real note rather than a placeholder. */

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

test('loads the shell at 1280x820 with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search notes' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New note' }).first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('opens a created note in the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).first().click();

  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
});

test('restores the last open note from settings', async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem(
      'settings.json',
      JSON.stringify({ theme: 'light', lastNoteId: id, lastSelection: { kind: 'all' } }),
    );
  }, RICH_NOTE);

  await page.goto('/');

  await expect(page.getByRole('textbox', { name: 'Note content' })).toContainText(
    'Discussed the launch date',
  );
});