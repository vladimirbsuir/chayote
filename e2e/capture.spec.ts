import { expect, test } from '@playwright/test';

/* `11-verification.md` §4 level 2: capture each state at a fixed viewport in both
   themes into `screenshots/`, which is committed so a reviewer can compare runs
   by eye. Level 1 assertions live in `smoke.spec.ts` and `editor.spec.ts`. */

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

const STATES = {
  'desktop-light': { width: 1280, height: 820, scheme: 'light' },
  'desktop-dark': { width: 1280, height: 820, scheme: 'dark' },
  'tablet-light': { width: 900, height: 1023, scheme: 'light' },
  'mobile-light': { width: 360, height: 640, scheme: 'light' },
} as const;

for (const [name, spec] of Object.entries(STATES)) {
  test(`captures ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: spec.width, height: spec.height });
    await page.emulateMedia({ colorScheme: spec.scheme });

    await page.addInitScript(
      ([id, scheme]) => {
        window.localStorage.setItem(
          'settings.json',
          JSON.stringify({
            theme: scheme,
            lastNoteId: id,
            lastSelection: { kind: 'all' },
          }),
        );
      },
      [RICH_NOTE, spec.scheme] as const,
    );

    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: false });
  });
}