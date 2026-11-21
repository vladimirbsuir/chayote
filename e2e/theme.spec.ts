import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings, waitForStoredTheme } from './helpers';

async function themeNow(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

test.describe('theme', () => {
  test.beforeEach(async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test('Ctrl+Shift+L changes what is on screen with every press', async ({ page }) => {
    await waitForStoredTheme(page, 'light');

    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'dark');
    expect(await themeNow(page)).toBe('dark');

    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'system');
    expect(await themeNow(page)).toBe('light');

    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'dark');
    expect(await themeNow(page)).toBe('dark');
  });

  test('system follows the OS preference', async ({ page }) => {
    await page.keyboard.press('Control+Shift+L');
    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'system');
    expect(await themeNow(page)).toBe('light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => themeNow(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => themeNow(page)).toBe('light');
  });

  test('a theme change survives a relaunch', async ({ page }) => {
    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'dark');
    await page.reload();
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
    expect(await themeNow(page)).toBe('dark');
  });

  test('the top-bar button runs the same cycle as the shortcut', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Change theme' });
    await expect(button).toBeVisible();

    await button.click();
    await waitForStoredTheme(page, 'dark');
    expect(await themeNow(page)).toBe('dark');
    await button.click();
    await waitForStoredTheme(page, 'system');
    expect(await themeNow(page)).toBe('light');
    await button.click();
    await waitForStoredTheme(page, 'dark');
    expect(await themeNow(page)).toBe('dark');
  });

  test('the button icon shows the theme in effect, not the next one', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.keyboard.press('Control+Shift+L');
    await expect.poll(() => themeNow(page)).toBe('dark');

    const icon = page.getByRole('button', { name: 'Change theme' }).locator('svg');
    await expect(icon).toHaveClass(/i-20/);
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
