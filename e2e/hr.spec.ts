import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings } from './helpers';

/* Dividers (`04-editor.md` §1.2) and the Backspace paths around them.
   `EditorShortcuts` in `src/editor/extensions.ts` owns one narrow case — an
   empty top-level paragraph after a divider — and everything else pins the
   default chain so it cannot silently change. */

async function settleEditor(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
}

async function newNote(page: Page): Promise<void> {
  await seedSettings(page, {
    theme: 'light',
    accent: null,
    lastSelection: { kind: 'all' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
}

async function insertDividerAfter(page: Page, text: string): Promise<void> {
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await editor.pressSequentially(text);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Horizontal rule' }).click();
  await settleEditor(page);
}

test.describe('dividers', () => {
  test('one Backspace in the empty paragraph after a divider removes the divider', async ({
    page,
  }) => {
    await newNote(page);
    const editor = page.getByRole('textbox', { name: 'Note content' });
    await insertDividerAfter(page, 'aaa');

    /* The caret sits in the divider's own trailing paragraph. */
    await page.keyboard.press('Backspace');
    await settleEditor(page);

    await expect(editor.locator('hr')).toHaveCount(0);
    await expect(editor).toContainText('aaa');
    await expect(editor).toBeFocused();
  });

  test('Backspace at the start of a following line still removes the divider', async ({
    page,
  }) => {
    await newNote(page);
    const editor = page.getByRole('textbox', { name: 'Note content' });
    await insertDividerAfter(page, 'aaa');
    await page.keyboard.type('bbb');
    await settleEditor(page);

    await page.keyboard.press('Home');
    await settleEditor(page);
    await page.keyboard.press('Backspace');
    await settleEditor(page);

    await expect(editor.locator('hr')).toHaveCount(0);
    await expect(editor).toContainText('aaa');
    await expect(editor).toContainText('bbb');
  });

  test('a selected divider shows an accent outline and deletes on Backspace', async ({
    page,
  }) => {
    await newNote(page);
    const editor = page.getByRole('textbox', { name: 'Note content' });
    await insertDividerAfter(page, 'aaa');
    await page.keyboard.type('bbb');
    await settleEditor(page);

    /* Arrow up out of bbb lands on the divider rather than skipping it. */
    await page.keyboard.press('ArrowUp');
    await settleEditor(page);
    const hr = editor.locator('hr');
    await expect(hr).toHaveClass(/ProseMirror-selectednode/);

    const outline = await hr.evaluate((node) => getComputedStyle(node).outlineWidth);
    expect(Number.parseFloat(outline)).toBeGreaterThan(0);

    await page.keyboard.press('Backspace');
    await settleEditor(page);
    await expect(editor.locator('hr')).toHaveCount(0);
  });

  test('a click selects the divider and Delete removes it', async ({ page }) => {
    await newNote(page);
    const editor = page.getByRole('textbox', { name: 'Note content' });
    await insertDividerAfter(page, 'aaa');
    await page.keyboard.type('bbb');
    await settleEditor(page);

    await editor.locator('hr').click();
    await settleEditor(page);
    await expect(editor.locator('hr')).toHaveClass(/ProseMirror-selectednode/);

    await page.keyboard.press('Delete');
    await settleEditor(page);
    await expect(editor.locator('hr')).toHaveCount(0);
    await expect(editor).toContainText('aaa');
  });
});

test.describe('task list alignment', () => {
  test('task item text starts where bullet text starts', async ({ page }) => {
    await newNote(page);
    const editor = page.getByRole('textbox', { name: 'Note content' });

    await editor.pressSequentially('bullet');
    await settleEditor(page);
    await page.keyboard.press('Shift+Home');
    await settleEditor(page);
    await page.getByRole('button', { name: 'Bullet list' }).click();
    await page.keyboard.press('End');
    /* Two Enters: the first opens a second item, the second exits the list
       into a plain paragraph. Toggling a task list from inside a bullet item
       is inapplicable, so the button stays disabled until the caret is out. */
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('task');
    await settleEditor(page);
    await page.keyboard.press('Shift+Home');
    await settleEditor(page);
    await page.getByRole('button', { name: 'Task list' }).click();
    await settleEditor(page);

    /* The marker has no box of its own, so the comparison is text to text:
       the task content must sit on the same x as the bullet item's text. */
    const bulletBox = await editor.locator('ul:not([data-type]) li').first().boundingBox();
    const taskBox = await editor.locator('.note-task-item__content').first().boundingBox();
    expect(bulletBox, 'bullet item has no box').not.toBeNull();
    expect(taskBox, 'task content has no box').not.toBeNull();
    if (bulletBox === null || taskBox === null) return;
    /* Bullet text starts after the 24 px list padding; the task row is an
       18 px box plus a 10 px gap starting 4 px left of the column. */
    expect(Math.abs(taskBox.x - bulletBox.x)).toBeLessThanOrEqual(1.5);
  });
});
