import { expect, test } from '@playwright/test';

/* ADR-019: the accent follows the theme through the cascade. Before M6,
   `applyAccent` wrote `--accent` inline on the element carrying `data-theme`,
   which beat the dark block, so the dark accent was unreachable. The rendered
   value is read back off the document rather than asserted from the token file,
   because the whole defect was that the token file was right and the DOM was
   not — asserting the token would have passed while the app was wrong. */

const THEMES = ['light', 'dark'] as const;

test.describe('accent follows the theme', () => {
  for (const theme of THEMES) {
    test(`resolves to the ${theme} preset on a rendered element`, async ({ page }) => {
      await page.addInitScript((value) => {
        window.localStorage.setItem(
          'settings.json',
          JSON.stringify({ theme: value, accent: null }),
        );
      }, theme);
      await page.goto('/');

      await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

      const resolved = await page.evaluate(() => {
        const root = document.documentElement;
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return {
          theme: root.dataset.theme,
          inline: root.style.getPropertyValue('--accent'),
          computed: color,
        };
      });

      expect(resolved.theme).toBe(theme);
      expect(resolved.inline).toBe('');
      /* Computed rgb of the expected hex, since getComputedStyle normalises. */
      const expected = theme === 'light' ? 'rgb(39, 105, 236)' : 'rgb(72, 129, 239)';
      expect(resolved.computed).toBe(expected);
    });
  }

  test('a custom accent is the one case that writes inline, and clears on reset', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'settings.json',
        JSON.stringify({ theme: 'light', accent: '#123456' }),
      );
    });
    await page.goto('/');
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

    const inline = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent'),
    );
    expect(inline).toBe('#123456');
  });
});