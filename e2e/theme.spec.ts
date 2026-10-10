import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings, waitForStoredTheme } from './helpers';

/* `05-ui-ux.md` §6.6 gives the theme three states; §7 binds `Ctrl/Cmd+Shift+L`
   to the cycle. The button in the top bar and the shortcut have to run the same
   order, and neither may be mistaken for a plain light/dark switch — which is
   what the top bar was before M6, and what left no way back to following the OS.

   Driven through the keyboard and through the button separately, because the two
   disagreeing is the failure this is here to catch. */

async function themeNow(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

test.describe('theme', () => {
  test.beforeEach(async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test('Ctrl+Shift+L cycles light, dark, system and back', async ({ page }) => {
    await waitForStoredTheme(page, 'light');

    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'dark');
    expect(await themeNow(page)).toBe('dark');

    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'system');

    /* Three steps is a full lap, which is what makes the cycle safe to press
       without looking. */
    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'light');
  });

  test('system follows the OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.keyboard.press('Control+Shift+L');
    await page.keyboard.press('Control+Shift+L');
    await waitForStoredTheme(page, 'system');
    expect(await themeNow(page)).toBe('dark');
  });

  test('a theme change survives a relaunch', async ({ page }) => {
    /* `06-platform.md` §6: close and reopen restores the theme. Asserting on the
       DOM without reloading would pass even if nothing was persisted. */
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
    await button.click();
    await waitForStoredTheme(page, 'system');
    await button.click();
    await waitForStoredTheme(page, 'light');
  });

  test('the button icon shows the theme in effect, not the next one', async ({ page }) => {
    /* On a dark-preferring browser, a user on `system` sees dark. The icon has
       to agree with the screen, not with the stored value — a button labelled
       "Light" while dark is showing would be a lie in the one place the user
       checks what the app thinks the theme is. */
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.keyboard.press('Control+Shift+L');
    await page.keyboard.press('Control+Shift+L');
    await expect.poll(() => themeNow(page)).toBe('dark');

    const icon = page.getByRole('button', { name: 'Change theme' }).locator('svg');
    await expect(icon).toHaveClass(/i-20/);
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});