import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings } from './helpers';

/* The Sync tab, driven against the mock backend (ADR-018): the config
   round-trips in memory, `sync_now` answers empty, and there are no
   conflicts. What this pins is the wiring — tabs switch, validation
   surfaces, and a good string saves — not the engine, which the Rust live
   test owns against a real Postgres. */

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
    /* The save invalidates the status query, which then reads the mock's
       stored config. */
    await expect(page.getByTestId('sync-status')).toContainText('Configured');
  });

  test('re-upload queues the library and names what was queued', async ({ page }) => {
    await openSyncTab(page);
    /* Status and recovery live collapsed under Status & advanced. */
    await page.getByTestId('sync-details-toggle').click();
    await expect(page.getByTestId('sync-reupload')).toBeDisabled();
    await page.getByLabel('Postgres connection string').fill('postgresql://localhost/db');
    await page.getByTestId('sync-save').click();
    await expect(page.getByTestId('sync-status')).toContainText('Configured');
    await page.getByTestId('sync-reupload').click();
    /* The mock backend answers 0: what this pins is the wiring — the button
       enables once configured and the queued count lands where it can be
       read — not the engine, which the Rust tests own. */
    await expect(page.getByTestId('sync-reupload-status')).toContainText('0 rows queued');
  });

  test('no conflict badge without conflicts', async ({ page }) => {
    await expect(page.getByTestId('sync-conflict-badge')).toBeHidden();
  });
});
