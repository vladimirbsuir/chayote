import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings } from './helpers';

const SHELL = '[data-testid="app-shell"]';

async function firstCard(page: Page): Promise<void> {
  await page.locator('[data-testid="note-list"] [role="option"]').first().click();
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();
}

test.describe('the remaining §7 shortcuts', () => {
  test('Ctrl+Enter moves focus from the list into the editor', async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toBeVisible();
    await firstCard(page);

    await page.getByLabel('Search notes').first().focus();
    await expect(page.locator('[data-testid="note-editor"]')).not.toBeFocused();

    await page.keyboard.press('Control+Enter');
    await expect(page.locator('[data-testid="note-editor"]')).toBeFocused();
  });

  test('Ctrl+Enter in the editor still toggles a task item', async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toBeVisible();
    await firstCard(page);

    await page.locator('[data-testid="note-editor"]').click();
    await page.keyboard.type('- [ ] write the thing');
    const item = page.locator('[data-testid="note-editor"] li').last();
    await expect(item).toHaveAttribute('data-checked', 'false');

    await item.click();
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve(null);
          });
        }),
    );

    await page.keyboard.press('Control+Enter');
    await expect(item).toHaveAttribute('data-checked', 'true');
    await expect(page.locator('[data-testid="note-editor"]')).toBeFocused();
  });

  test('Escape closes the tablet drawer', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 });
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toHaveAttribute('data-breakpoint', 'tablet');

    const drawer = page.getByTestId('sidebar-drawer');
    await expect(drawer).toHaveAttribute('data-open', 'false');

    await page.keyboard.press('Control+\\');
    await expect(drawer).toHaveAttribute('data-open', 'true');

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('data-open', 'false');
  });

  test('Escape closes the dialog and not the drawer underneath it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 });
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toHaveAttribute('data-breakpoint', 'tablet');

    const drawer = page.getByTestId('sidebar-drawer');
    await page.keyboard.press('Control+\\');
    await expect(drawer).toHaveAttribute('data-open', 'true');

    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeHidden();
    await expect(drawer).toHaveAttribute('data-open', 'true');
  });
});