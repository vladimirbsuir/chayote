import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/* ADR-023: the note screen as a person meets it — a title of its own, when the
   note was last changed under it, and the text below. Driven end to end against
   the mock backend, because the parts that matter are not in this file: whether
   the title survives a save, whether the list follows it, and whether clearing it
   hands the name back to derivation. All three are the command's job, and two of
   them are pinned by unit tests on both backends. */

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
  /* The editor is code-split and autofocuses on mount; waiting for it is what
     keeps it from stealing focus mid-test. See `shell.spec.ts`'s `open`. */
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
}

test.describe('note title field', () => {
  test('names the note above its text, with the date it was changed below', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('note-title-input');
    await expect(title).toBeVisible();
    await expect(title).toHaveValue('Meeting notes');

    /* Above, not below: the name introduces the text. Asserted as geometry rather
       than as DOM order, because the thing a reader sees is the two lines. */
    const titleBox = await title.boundingBox();
    const dateBox = await page.getByTestId('note-updated-at').boundingBox();
    const bodyBox = await page.getByRole('textbox', { name: 'Note content' }).boundingBox();
    expect(titleBox).not.toBeNull();
    expect(dateBox).not.toBeNull();
    expect(bodyBox).not.toBeNull();
    if (titleBox === null || dateBox === null || bodyBox === null) return;
    expect(dateBox.y).toBeGreaterThan(titleBox.y);
    expect(bodyBox.y).toBeGreaterThan(dateBox.y);

    /* The date is smaller than the title and quieter than the body: a timestamp
       is metadata, and it should not read as a second headline. */
    expect(dateBox.height).toBeLessThan(titleBox.height);
  });

  test('saves a typed title and the note list follows it', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('note-title-input');
    await title.click();
    await title.press('ControlOrMeta+a');
    await title.pressSequentially('Launch plan');

    /* The field's debounce is 800 ms (`04-editor.md` §5.1), so the write lands
       after the keystroke rather than with it. The card showing the new name is
       the proof that the command ran and its response came back — durability
       across a restart is not assertable here, because the browser backend is
       re-seeded on every page load; `useNoteTitle.test.tsx` and the two backend
       contract tests are where that is pinned. */
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

    /* The failure this guards is the autosave judging the document unchanged and
       recomputing the title from it, which blanks the field on the first
       keystroke after it was typed. */
    await expect(page.getByTestId('note-title-input')).toHaveValue('Kept');
  });

  test('moves from the title to the body on Enter', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('note-title-input');
    await title.click();
    await title.press('Enter');

    /* A newline inside a title is a space everywhere it is shown but one, so Enter
       hands over to the text instead of inserting one. */
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeFocused();
    await expect(title).toHaveValue('Meeting notes');
  });

  test('shows the title in the list but not in the bars around the editor', async ({ page }) => {
    await open(page);

    /* One name, one place. The status bar and the mobile bar both carried it until
       ADR-023, neither of them was editable, and two labels for one note can
       disagree. */
    await expect(page.getByTestId('status-folder')).toBeVisible();
    expect(await page.getByTestId('editor-status-bar').textContent()).not.toContain(
      'Meeting notes',
    );
    await expect(page.getByTestId('note-title-input')).toHaveValue('Meeting notes');
  });

  test('leaves the date line out only when there is nothing to show', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('note-updated-at')).toBeVisible();
    /* The fixtures are dated, so the line is there for a saved note; the
       no-saved-state case is pinned in `NoteHeader.test.tsx`, where the branch can
       actually be reached. */
    await expect(page.getByTestId('note-updated-at')).toContainText(/\d/);
  });
});
