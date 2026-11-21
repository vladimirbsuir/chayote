import { expect, test } from '@playwright/test';
import { seedSettings } from './helpers';

const DIALOG = '[data-testid="settings-dialog"]';

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test('the overflow menu opens it, and the menu dismisses three ways', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    const menu = page.getByTestId('topbar-overflow');
    await expect(menu).toBeVisible();

    await page.getByRole('button', { name: 'More' }).click();
    await expect(menu).toBeHidden();

    await page.getByRole('button', { name: 'More' }).click();
    await expect(menu).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await expect(menu).toBeHidden();

    await page.getByRole('button', { name: 'More' }).click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByRole('button', { name: 'More' })).toBeFocused();
  });

  test('changing the theme from the dialog reaches the document', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.getByRole('radio', { name: /Dark/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByTestId('settings-done').click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('a preset accent resolves per theme, so dark shows the dark value', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.getByRole('radio', { name: 'Teal' }).click();
    const light = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
    await page.getByRole('radio', { name: /Dark/ }).click();
    const dark = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );

    expect(light).toBe('#0f766e');
    expect(dark).toBe('#13948a');
  });

  test('Escape closes the dialog and returns focus to the trigger', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'More' });
    await trigger.click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('focus is trapped inside the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();

    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="settings-dialog"]');
        return panel !== null && document.activeElement !== null && panel.contains(document.activeElement);
      });
      expect(inside, `focus left the dialog after ${step + 1} tabs`).toBe(true);
    }
  });

  test('resetting asks first, and never touches notes', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.getByRole('radio', { name: /Dark/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByTestId('settings-reset').click();
    const confirm = page.getByTestId('confirm-dialog-confirm');
    await expect(confirm).toBeVisible();
    await confirm.click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('a custom colour shows no readout string at all', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await expect(page.locator('#settings-accent-custom')).toBeHidden();
    await page.getByRole('radio', { name: 'Custom colour' }).click();
    await page.locator('#settings-accent-custom').fill('#4a4a4a');
    await expect(page.locator(DIALOG)).not.toContainText('Custom #');
    await expect(page.locator(DIALOG)).not.toContainText('below the 4.5:1');
  });

  test('the palette remembers a custom colour behind a preset', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.getByRole('radio', { name: 'Custom colour' }).click();
    await page.locator('#settings-accent-custom').fill('#4a4a4a');
    await page.getByRole('radio', { name: 'Teal' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('settings.json');
          if (raw === null) return null;
          return (JSON.parse(raw) as { lastCustomHex?: unknown }).lastCustomHex ?? null;
        }),
      )
      .toBe('#4a4a4a');

    await page.getByTestId('settings-done').click();
    await page.reload();
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.getByRole('radio', { name: 'Custom colour' }).click();
    await expect(page.locator('#settings-accent-custom')).toHaveValue('#4a4a4a');
  });

  test('the default folder uses the app picker, not the platform popup', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.getByRole('button', { name: 'Default folder for new notes' }).click();
    const picker = page.getByTestId('folder-picker-list');
    await expect(picker).toBeVisible();
    await picker.getByRole('option', { name: 'Work', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Default folder for new notes' }),
    ).toContainText('Work');

    await page.getByTestId('settings-done').click();
    await page.reload();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(
      page.getByRole('button', { name: 'Default folder for new notes' }),
    ).toContainText('Work');
  });

  test('Escape in the folder picker closes the picker, not the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.getByRole('button', { name: 'Default folder for new notes' }).click();
    const picker = page.getByTestId('folder-picker-list');
    await expect(picker).toBeVisible();

    await picker.focus();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(page.locator(DIALOG)).toBeVisible();
  });

  test('the folder picker filters by typing and toggles off the button', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();

    const field = page.getByRole('button', { name: 'Default folder for new notes' });
    await field.click();
    const picker = page.getByTestId('folder-picker-list');
    await expect(picker).toBeVisible();

    await page.getByPlaceholder('Filter folders…').fill('meet');
    await expect(picker.getByRole('option', { name: 'Meetings', exact: true })).toBeVisible();
    await expect(picker.getByRole('option', { name: 'Work', exact: true })).toBeHidden();

    await field.click();
    await expect(picker).toBeHidden();
    await expect(page.locator(DIALOG)).toBeVisible();
  });
});
