import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(
    ([id]) => {
      if (window.localStorage.getItem('settings.json') !== null) return;
      window.localStorage.setItem(
        'settings.json',
        JSON.stringify({ theme: 'light', lastNoteId: id, lastSelection: { kind: 'all' } }),
      );
    },
    [RICH_NOTE] as const,
  );
}

async function open(page: Page): Promise<void> {
  await seed(page);
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
}

test.describe('note title field', () => {
  test('names the note above its text, with the date it was changed below', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('note-title-input');
    await expect(title).toBeVisible();
    await expect(title).toHaveValue('Meeting notes');

    const titleBox = await title.boundingBox();
    const dateBox = await page.getByTestId('note-updated-at').boundingBox();
    const bodyBox = await page.getByRole('textbox', { name: 'Note content' }).boundingBox();
    expect(titleBox).not.toBeNull();
    expect(dateBox).not.toBeNull();
    expect(bodyBox).not.toBeNull();
    if (titleBox === null || dateBox === null || bodyBox === null) return;
    expect(dateBox.y).toBeGreaterThan(titleBox.y);
    expect(bodyBox.y).toBeGreaterThan(dateBox.y);

    expect(dateBox.height).toBeLessThan(titleBox.height);
  });

  test('saves a typed title and the note list follows it', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('note-title-input');
    await title.click();
    await title.press('ControlOrMeta+a');
    await title.pressSequentially('Launch plan');

    await expect(page.getByTestId('note-card').first()).toContainText('Launch plan');
    await expect(title).toHaveValue('Launch plan');
  });

  test('keeps the title through the next keystroke in the body', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('note-title-input');
    await title.click();
    await title.press('ControlOrMeta+a');
    await title.pressSequentially('Kept');
    await page.getByRole('textbox', { name: 'Note content' }).click();
    await page.keyboard.type(' more body text');

    await expect(page.getByTestId('note-title-input')).toHaveValue('Kept');
  });

  test('moves from the title to the body on Enter', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('note-title-input');
    await title.click();
    await title.press('Enter');

    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeFocused();
    await expect(title).toHaveValue('Meeting notes');
  });

  test('shows the title in the list but not in the bars around the editor', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('status-folder')).toBeVisible();
    expect(await page.getByTestId('editor-status-bar').textContent()).not.toContain(
      'Meeting notes',
    );
    await expect(page.getByTestId('note-title-input')).toHaveValue('Meeting notes');
  });

  test('leaves the date line out only when there is nothing to show', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('note-updated-at')).toBeVisible();
    await expect(page.getByTestId('note-updated-at')).toContainText(/\d/);
  });
  test('a new note starts with an empty title field, not the word Untitled', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+n');
    const title = page.getByTestId('note-title-input');
    await expect(title).toHaveValue('');
    await expect(title).toHaveAttribute('placeholder', 'Title');

    await title.click();
    await title.pressSequentially('Groceries');
    await expect(title).toHaveValue('Groceries');
    await title.press('Enter');
    await expect(page.getByTestId('note-list')).toContainText('Groceries');
    await expect(page.getByTestId('note-list')).not.toContainText('UntitledGroceries');
  });

  test('Ctrl+Backspace in the title deletes a word, not the note', async ({ page }) => {
    await open(page);
    const title = page.getByTestId('note-title-input');
    await title.click();
    await title.press('End');
    await title.press('Control+Backspace');

    await expect(title).toBeVisible();
    await expect(title).not.toHaveValue('Meeting notes');
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
  });
});
