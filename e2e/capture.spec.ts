import { expect, test } from '@playwright/test';
import { seedSettings } from './helpers';

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

const VIEWPORTS = {
  desktop: { width: 1280, height: 820 },
  tablet: { width: 900, height: 1023 },
  mobile: { width: 360, height: 640 },
} as const;

const THEMES = ['light', 'dark'] as const;

for (const [viewport, size] of Object.entries(VIEWPORTS)) {
  for (const theme of THEMES) {
    test(`captures ${viewport}-${theme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme });
      await seedSettings(page, { theme, accent: null, lastNoteId: RICH_NOTE, lastSelection: { kind: 'all' } });

      await page.goto('/');
      if (size.width < 768) {
        await expect(page.getByTestId('note-list')).toBeVisible();
        await page.getByTestId('note-card').first().click();
      }
      await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
      await expect(page.getByTestId('save-state')).toHaveText('Saved');
      await page.screenshot({ path: `screenshots/${viewport}-${theme}.png`, fullPage: false });
    });
  }
}

for (const theme of THEMES) {
  test(`captures settings-${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.emulateMedia({ colorScheme: theme });
    await seedSettings(page, { theme, accent: null });

    await page.goto('/');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await page.screenshot({ path: `screenshots/settings-${theme}.png`, fullPage: false });
  });

  test(`captures updates-available-${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.emulateMedia({ colorScheme: theme });
    await seedSettings(page, { theme, accent: null });

    await page.goto('/?seed=update');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await page.getByRole('tab', { name: 'Updates' }).click();
    await page.getByTestId('update-check').click();
    await expect(page.getByTestId('update-install')).toBeEnabled();
    await page.screenshot({ path: `screenshots/updates-available-${theme}.png`, fullPage: false });
  });

  test(`captures updates-unsupported-${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.emulateMedia({ colorScheme: theme });
    await seedSettings(page, { theme, accent: null });

    await page.goto('/?seed=no-updates');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await page.getByRole('tab', { name: 'Updates' }).click();
    await expect(page.getByTestId('update-unsupported')).toBeVisible();
    await page.screenshot({ path: `screenshots/updates-unsupported-${theme}.png`, fullPage: false });
  });
}

for (const theme of THEMES) {
  test(`captures tag-editor-${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.emulateMedia({ colorScheme: theme });
    await seedSettings(page, { theme, accent: null, lastNoteId: RICH_NOTE });

    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
await page.getByRole('button', { name: /^(Choose|Change) tags$/ }).click();
    await expect(page.getByRole('listbox').first()).toBeVisible();
    await page.screenshot({ path: `screenshots/tag-editor-${theme}.png`, fullPage: false });
  });
}