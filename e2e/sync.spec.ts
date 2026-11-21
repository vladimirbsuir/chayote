import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings } from './helpers';

const DIALOG = '[data-testid="settings-dialog"]';

async function openSyncTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByTestId('topbar-overflow-settings').click();
  await expect(page.locator(DIALOG)).toBeVisible();
  await page.getByRole('tab', { name: 'sync' }).click();
  await expect(page.getByTestId('sync-pane')).toBeVisible();
}

test.describe('sync tab', () => {
  test.beforeEach(async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test('opens on general, switches to sync, and remembers nothing secret', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator(DIALOG)).toBeVisible();
    await expect(page.getByTestId('sync-pane')).toBeHidden();

    await page.getByRole('tab', { name: 'sync' }).click();
    await expect(page.getByTestId('sync-pane')).toBeVisible();
    const field = page.getByLabel('Postgres connection string');
    await expect(field).toHaveValue('');
  });

  test('a bad string fails validation where the user can read it', async ({ page }) => {
    await openSyncTab(page);
    await page.getByLabel('Postgres connection string').fill('https://example.com/db');
    await page.getByTestId('sync-save').click();
    await expect(page.getByTestId('sync-error')).toContainText('Postgres connection string');
    await expect(page.locator(DIALOG)).toBeVisible();
  });

  test('a good string saves and the status says configured', async ({ page }) => {
    await openSyncTab(page);
    await page.getByLabel('Postgres connection string').fill('postgresql://localhost/db');
    await page.getByTestId('sync-save').click();
    await expect(page.getByTestId('sync-status')).toContainText('Configured');
  });

  test('re-upload queues the library and names what was queued', async ({ page }) => {
    await openSyncTab(page);
    await page.getByTestId('sync-details-toggle').click();
    await expect(page.getByTestId('sync-reupload')).toBeDisabled();
    await page.getByLabel('Postgres connection string').fill('postgresql://localhost/db');
    await page.getByTestId('sync-save').click();
    await expect(page.getByTestId('sync-status')).toContainText('Configured');
    await page.getByTestId('sync-reupload').click();
    await expect(page.getByTestId('sync-reupload-status')).toContainText('0 rows queued');
  });

  test('no conflict badge without conflicts', async ({ page }) => {
    await expect(page.getByTestId('sync-conflict-badge')).toBeHidden();
  });
});
