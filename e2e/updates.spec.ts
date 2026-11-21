import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings } from './helpers';

async function openSettings(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByTestId('topbar-overflow-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

async function openUpdates(page: Page): Promise<void> {
  await openSettings(page);
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(page.getByTestId('update-pane')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await seedSettings(page, { theme: 'light', accent: null });
});

test.describe('Updates', () => {
  test('says what it is running and nothing more, before any check', async ({ page }) => {
    await page.goto('/?seed=update');
    await openUpdates(page);

    await expect(page.getByTestId('update-version')).toHaveText('Chayote 0.2.1');
    await expect(page.getByTestId('update-check')).toBeEnabled();
    await expect(page.getByTestId('update-current')).toHaveCount(0);
    await expect(page.getByTestId('update-available')).toHaveCount(0);
  });

  test('the launch-time tick is silent: it records a time and reports no result', async ({
    page,
  }) => {
    await page.goto('/?seed=update');
    await openUpdates(page);
    await expect(page.getByTestId('update-last-checked')).toContainText('Last checked');
    await expect(page.getByTestId('update-available')).toHaveCount(0);
    await expect(page.getByTestId('update-current')).toHaveCount(0);
    await expect(page.getByTestId('update-check')).toHaveText('Check for updates');
    await expect(page.getByTestId('update-checking')).toHaveCount(0);
  });

  test('offers the install after a check finds a newer version', async ({ page }) => {
    await page.goto('/?seed=update');
    await openUpdates(page);
    await page.getByTestId('update-check').click();

    await expect(page.getByTestId('update-available')).toContainText('Version 0.3.0 is available.');
    await expect(page.getByTestId('update-install')).toBeEnabled();
    await expect(page.getByTestId('update-current')).toHaveCount(0);
  });

  test('records when it last checked, so reopening the tab is not a blank slate', async ({
    page,
  }) => {
    await page.goto('/?seed=update');
    await openUpdates(page);
    await page.getByTestId('update-check').click();
    await expect(page.getByTestId('update-last-checked')).toContainText('Last checked');

    await page.getByTestId('settings-done').click();
    await openUpdates(page);
    await expect(page.getByTestId('update-last-checked')).toContainText('Last checked');
  });

  test('reports an update as up to date when there is none', async ({ page }) => {
    await page.goto('/');
    await openUpdates(page);
    await page.getByTestId('update-check').click();
    await expect(page.getByTestId('update-current')).toHaveText('Chayote is up to date.');
    await expect(page.getByTestId('update-install')).toHaveCount(0);
  });

  test('says a failed check in plain words, and claims nothing about being current', async ({
    page,
  }) => {
    await page.goto('/?seed=offline');
    await openUpdates(page);
    await page.getByTestId('update-check').click();

    await expect(page.getByTestId('update-check-error')).toHaveText(
      'Could not check for updates. Check your connection and try again.',
    );
    await expect(page.getByTestId('update-check-error')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('update-current')).toHaveCount(0);
    await expect(page.getByTestId('update-install')).toHaveCount(0);
    await expect(page.getByTestId('update-check')).toBeEnabled();
  });

  test('installs and returns, rather than leaving the tab mid-transfer', async ({ page }) => {
    await page.goto('/?seed=update');
    await openUpdates(page);
    await page.getByTestId('update-check').click();
    await expect(page.getByTestId('update-install')).toBeEnabled();

    await page.getByTestId('update-install').click();
    await expect(page.getByTestId('update-check')).toBeEnabled();
    await expect(page.getByTestId('update-progress')).toHaveCount(0);
  });

  test('disables the check and explains itself on a platform that cannot update', async ({
    page,
  }) => {
    await page.goto('/?seed=no-updates');
    await openUpdates(page);

    await expect(page.getByTestId('update-check')).toBeDisabled();
    await expect(page.getByTestId('update-unsupported')).toContainText('macOS');
    await expect(page.getByTestId('update-unsupported')).toContainText('not code-signed');
    await expect(page.getByTestId('update-current')).toHaveCount(0);
  });

  test('tells an Android user to grant the install permission, and keeps the button', async ({
    page,
  }) => {
    await page.goto('/?seed=needs-permission');
    await openUpdates(page);
    await page.getByTestId('update-check').click();
    await expect(page.getByTestId('update-install')).toBeEnabled();

    await page.getByTestId('update-install').click();
    await expect(page.getByTestId('update-install-error')).toContainText(
      'will not let Chayote install updates until you allow it',
    );
    await expect(page.getByTestId('update-install')).toBeEnabled();
  });

  test('keeps the rest of the dialog working with the third tab added', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await expect(page.getByTestId('settings-tabs').getByRole('tab')).toHaveCount(3);

    await page.getByRole('radio', { name: 'Teal' }).click();
    await page.getByRole('tab', { name: 'Sync' }).click();
    await expect(page.getByTestId('sync-pane')).toBeVisible();
    await page.getByRole('tab', { name: 'Updates' }).click();
    await expect(page.getByTestId('update-pane')).toBeVisible();
    await page.getByTestId('settings-done').click();
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
  });

  test('walks the three tabs with the arrow keys', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    const list = page.getByTestId('settings-tabs');
    await expect(list.getByRole('tab', { selected: true })).toHaveText('General');

    await list.press('ArrowRight');
    await expect(list.getByRole('tab', { selected: true })).toHaveText('Sync');
    await list.press('ArrowRight');
    await expect(list.getByRole('tab', { selected: true })).toHaveText('Updates');
    await list.press('ArrowRight');
    await expect(list.getByRole('tab', { selected: true })).toHaveText('General');
    await list.press('End');
    await expect(list.getByRole('tab', { selected: true })).toHaveText('Updates');
    await list.press('Home');
    await expect(list.getByRole('tab', { selected: true })).toHaveText('General');
  });
});