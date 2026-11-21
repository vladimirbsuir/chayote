import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function seedSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value: Record<string, unknown>) => {
    if (window.localStorage.getItem('settings.json') !== null) return;
    window.localStorage.setItem('settings.json', JSON.stringify(value));
  }, settings);
}

export async function storedTheme(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('settings.json');
    if (raw === null) return 'unset';
    return (JSON.parse(raw) as { theme?: string }).theme ?? 'unset';
  });
}

export async function waitForStoredTheme(page: Page, theme: string): Promise<void> {
  await expect.poll(() => storedTheme(page)).toBe(theme);
}