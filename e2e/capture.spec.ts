import { expect, test } from '@playwright/test';

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

    await page.goto('/');
    await expect(page.getByText('No notes yet')).toBeVisible();
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: false });
  });
}
