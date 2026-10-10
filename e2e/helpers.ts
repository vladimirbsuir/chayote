import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Seed settings once, on the first load only.

    `addInitScript` runs on *every* navigation, so an unguarded seed silently
    overwrites the very value a reload is meant to prove was saved — and the
    assertion then reports on the test harness rather than on the app. */
export async function seedSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value: Record<string, unknown>) => {
    if (window.localStorage.getItem('settings.json') !== null) return;
    window.localStorage.setItem('settings.json', JSON.stringify(value));
  }, settings);
}

/** The theme in the persisted store, or `unset` when nothing has been written. */
export async function storedTheme(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('settings.json');
    if (raw === null) return 'unset';
    return (JSON.parse(raw) as { theme?: string }).theme ?? 'unset';
  });
}

/** Waits for the debounced write to land. Settings are written 300 ms after the
    last change (`10-conventions.md` §7), so asserting on storage without this
    races the app rather than testing it. */
export async function waitForStoredTheme(page: Page, theme: string): Promise<void> {
  await expect.poll(() => storedTheme(page)).toBe(theme);
}