import { expect, test } from '@playwright/test';

test('loads the empty app at 1280x820 with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search notes' })).toBeVisible();
  await expect(page.getByText('No notes yet')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'New note' })).toBeVisible();

  expect(errors).toEqual([]);
});
