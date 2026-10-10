import { expect, test } from '@playwright/test';

/* `05-ui-ux.md` §6.6 gives the theme three states; §7 binds `Ctrl/Cmd+Shift+L`
   to the cycle. The button in the top bar and the shortcut have to run the same
   order, and neither may be mistaken for a plain light/dark switch — which is
   what the top bar was before M6, and what left no way back to following the OS.

   Driven through the keyboard and through the button separately, because the two
   disagreeing is the failure this is here to catch. */

const CURRENT = '[data-testid="app-shell"]';

/** The theme in effect. `data-theme` holds the *resolved* value, so `system` and
    `light` are indistinguishable here on a light-preferring browser. */
async function themeNow(page: import('@playwright/test').Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

/** The stored value, which does distinguish `system` from `light`. Settings are
    written on a 300 ms debounce (`10-conventions.md` §7), so this polls. */
async function storedTheme(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('settings.json');
    if (raw === null) return 'system';
    return (JSON.parse(raw) as { theme?: string }).theme ?? 'system';
  });
}

test.describe('theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('settings.json', JSON.stringify({ theme: 'light', accent: null }));
    });
    await page.goto('/');
    await expect(page.locator(CURRENT)).toBeVisible();
  });

  test('Ctrl+Shift+L cycles light, dark, system and back', async ({ page }) => {
    expect(await storedTheme(page)).toBe('light');

    await page.keyboard.press('Control+Shift+L');
    await expect.poll(() => storedTheme(page)).toBe('dark');
    expect(await themeNow(page)).toBe('dark');

    await page.keyboard.press('Control+Shift+L');
    await expect.poll(() => storedTheme(page)).toBe('system');

    /* Three steps is a full lap, which is the property that makes the cycle
       safe to press without looking. */
    await page.keyboard.press('Control+Shift+L');
    await expect.poll(() => storedTheme(page)).toBe('light');
  });

  test('system follows the OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.keyboard.press('Control+Shift+L');
    await page.keyboard.press('Control+Shift+L');
    await expect.poll(() => storedTheme(page)).toBe('system');
    expect(await themeNow(page)).toBe('dark');
  });

  test('the top-bar button runs the same cycle as the shortcut', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Change theme' });
    await expect(button).toBeVisible();

    await button.click();
    await expect.poll(() => storedTheme(page)).toBe('dark');

    await button.click();
    await expect.poll(() => storedTheme(page)).toBe('system');

    await button.click();
    await expect.poll(() => storedTheme(page)).toBe('light');
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
    /* The moon is the only inventory icon with this path. */
    await expect(icon.locator('path')).toHaveCount(1);
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});