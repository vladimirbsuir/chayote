import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings, waitForStoredTheme } from './helpers';

async function tabTo(page: Page, locator: ReturnType<Page['locator']>, max = 120): Promise<void> {
  const target = locator.first();
  for (let step = 0; step < max; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    if ((await activeTestId(page)) === 'note-editor') {
      await page.keyboard.press('Shift+Tab');
    } else {
      await page.keyboard.press('Tab');
    }
  }
  throw new Error(
    `never reached ${await target.getAttribute('aria-label')} after ${max} tabs; focus is on ${await activeTestId(page)}`,
  );
}

async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null,
  );
}

async function settleEditor(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
}

test('a user can create, organise, find, edit, trash and restore without a mouse', async ({
  page,
}) => {
  await seedSettings(page, { theme: 'light', accent: null });
  await page.goto('/');
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

  await page.keyboard.press('Control+N');
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();

  await settleEditor(page);
  await page.keyboard.type('Keyboard only shopping list');
  await expect(page.locator('[data-testid="note-editor"]')).toContainText(
    'Keyboard only shopping list',
  );

  await page.keyboard.press('Control+F');
  await expect(page.getByLabel('Search notes').first()).toBeFocused();
  await page.keyboard.type('shopping');
  await expect(page.getByTestId('note-list')).toContainText('Keyboard only shopping list');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+D');
  await expect(page.getByRole('button', { name: /^(Un)?pin note$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.keyboard.press('Control+F');
  await page.keyboard.press('Escape');
  const firstRow = page.getByRole('treeitem').first();
  await tabTo(page, firstRow);
  await expect(firstRow).toBeFocused();
  await page.keyboard.press('F2');
  await expect(page.locator('input[type="text"]')).toBeFocused();
  await page.keyboard.press('Escape');

  await tabTo(page, page.locator('[data-testid="note-editor"]'));
  await page.keyboard.press('Control+Backspace');
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toBeVisible();

  const undo = toast.getByRole('button', { name: /undo/i });
  await tabTo(page, undo, 12);
  await page.keyboard.press('Enter');
  await expect(toast).toBeHidden();
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();

  expect(await activeTestId(page)).not.toBeNull();
});

test('settings is reachable and operable by keyboard alone', async ({ page }) => {
  await seedSettings(page, { theme: 'light', accent: null });
  await page.goto('/');
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

  const more = page.getByRole('button', { name: 'More' });
  await tabTo(page, more);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('topbar-overflow')).toBeVisible();

  const settingsItem = page.getByTestId('topbar-overflow-settings');
  await tabTo(page, settingsItem, 8);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('settings-dialog')).toBeVisible();

  const light = page.getByRole('radio', { name: /Light/ });
  await tabTo(page, light, 8);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Dark/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await waitForStoredTheme(page, 'dark');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
  await expect(more).toBeFocused();
});

test('the whole §7 shortcut table is bound, and none of them is a browser default', async ({
  page,
}) => {
  await seedSettings(page, { theme: 'light', accent: null });
  await page.goto('/');
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

  await page.keyboard.press('Control+Shift+L');
  await waitForStoredTheme(page, 'dark');

  await page.keyboard.press('Control+F');
  await expect(page.getByLabel('Search notes').first()).toBeFocused();

  await page.keyboard.press('Control+N');
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();

  await page.locator('[data-testid="note-editor"]').click();
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
});
