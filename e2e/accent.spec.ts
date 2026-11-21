import { expect, test } from '@playwright/test';
import { seedSettings } from './helpers';

const THEMES = ['light', 'dark'] as const;

test.describe('accent follows the theme', () => {
  for (const theme of THEMES) {
    test(`resolves to the ${theme} preset on a rendered element`, async ({ page }) => {
      await seedSettings(page, { theme, accent: null });
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
      const expected = theme === 'light' ? 'rgb(39, 105, 236)' : 'rgb(72, 129, 239)';
      expect(resolved.computed).toBe(expected);
    });
  }

test('a custom accent is the one case that writes a literal inline', async ({
    page,
  }) => {
    await seedSettings(page, { theme: 'light', accent: '#123456' });
    await page.goto('/');
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

    const inline = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent'),
    );
    expect(inline).toBe('#123456');
  });

  test('a chosen preset writes a variable reference, not a hex', async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: { kind: 'preset', index: 6 } });
    await page.goto('/');
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

    const light = await page.evaluate(() => ({
      inline: document.documentElement.style.getPropertyValue('--accent'),
      computed: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    }));
    expect(light.inline).toBe('var(--accent-preset-6)');
    expect(light.computed).toBe('#0f766e');

    await page.getByRole('button', { name: 'Change theme' }).click();
    const dark = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
    expect(dark).toBe('#13948a');
  });
});
