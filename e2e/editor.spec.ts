import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/* `04-editor.md` §3 and §5, driven with real keystrokes. Input rules and smart
   typography only fire on typed input, so they cannot be checked with a
   programmatic insert — that is what this file is for. */

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

async function openRichNote(page: Page): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem(
      'settings.json',
      JSON.stringify({ theme: 'light', lastNoteId: id, lastSelection: { kind: 'all' } }),
    );
  }, RICH_NOTE);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
}

/* Chromium does not move a contenteditable caret with Ctrl+End. Clicking the
   last block and pressing Enter puts the caret in a fresh empty paragraph, which
   is also what markdown input rules need: they only fire at the start of a text
   block. */
async function caretToNewBlock(page: Page, editor: Locator): Promise<void> {
  await editor.locator(':scope > *').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
}

test('renders the fixture document with every block in the schema', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });

  await expect(editor.locator('h1')).toHaveText('Meeting notes');
  await expect(editor.locator('h2').first()).toHaveText('Decisions');
  await expect(editor.locator('ul').first()).toBeVisible();
  await expect(editor.locator('blockquote')).toBeVisible();
  await expect(editor.locator('ul[data-type="taskList"]')).toBeVisible();
  await expect(editor.locator('hr')).toBeVisible();
  await expect(editor.locator('a')).toHaveCount(0);
});

test('shows the derived title and word count in the status bar', async ({ page }) => {
  await openRichNote(page);

  await expect(page.getByTestId('word-count')).toContainText('words');
  await expect(page.locator('section[aria-label="Editor"]')).toContainText('Meeting notes');
});

test('turns markdown input rules into nodes', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);

  await page.keyboard.type('## Typed heading');
  await expect(editor.locator('h2').last()).toHaveText('Typed heading');

  await page.keyboard.press('Enter');
  await page.keyboard.type('- first bullet');
  await expect(editor.locator('ul li').last()).toHaveText('first bullet');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. ordered item');
  await expect(editor.locator('ol li').last()).toHaveText('ordered item');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> quoted line');
  await expect(editor.locator('blockquote').last()).toHaveText('quoted line');
});

test('applies smart typography outside code and leaves it inside code', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);

  await page.keyboard.type('wait... really');
  await expect(editor).toContainText('…');

  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  await page.keyboard.type('kept... verbatim');

  await expect(editor.locator('pre code')).toContainText('kept... verbatim');
  await expect(editor.locator('pre code')).not.toContainText('…');
});

test('applies the four marks from 05-ui-ux.md §7', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);
  await page.keyboard.type('marked');

  /* A double click does not move ProseMirror's selection under Playwright;
     walking left with Shift does. */
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }

  for (const [selector, key] of [
    ['strong', 'b'],
    ['em', 'i'],
    ['s, strike, del', 'Shift+X'],
    ['code', 'e'],
  ] as const) {
    await page.keyboard.press(`Control+${key}`);
    await expect(editor.locator(selector).last()).toContainText('marked');
    await page.keyboard.press(`Control+${key}`);
  }
});

test('saves after the 800 ms debounce and reports Saved', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);
  await page.keyboard.type('debounced change');

  await expect(page.getByTestId('save-state')).toHaveText('Unsaved changes');
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 5_000 });
});

test('Ctrl+S flushes without waiting for the debounce', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);
  await page.keyboard.type('flushed now');

  await expect(page.getByTestId('save-state')).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
});

test('Tab inserts two spaces in a paragraph and never leaves the editor', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);
  await page.keyboard.type('plain text');

  await page.keyboard.press('Tab');

  await expect(editor).toHaveText(/plain text {2}/);
  await expect(editor).toBeFocused();
});

test('toggles a task item with Ctrl+Enter', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await editor.locator('ul[data-type="taskList"] li').last().click();

  await page.keyboard.press('Control+Enter');

  await expect(editor.locator('ul[data-type="taskList"] li[data-checked="true"]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('pastes plain text as paragraphs with a hard break for a single newline', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);

  await paste(page, { 'text/plain': 'first line\nsecond line\n\nsecond paragraph' });

  const joined = editor.locator('p', { hasText: 'first line' }).last();
  await expect(joined.locator('br')).toHaveCount(1);
  await expect(joined).toContainText('first line');
  await expect(joined).toContainText('second line');
  await expect(editor.locator('p', { hasText: 'second paragraph' }).last()).toBeVisible();
});

test('does not let pasted script, style, or href into the document', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);

  await paste(page, {
    'text/html':
      '<p style="color:red">kept</p><script>window.__pwned = true</script><a href="javascript:alert(1)">bad</a>',
    'text/plain': 'kept',
  });

  await expect(editor).toContainText('kept');
  expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(editor.locator('script')).toHaveCount(0);
  await expect(editor.locator('a')).toHaveCount(0);
});

test('keeps a pasted list a list and a pasted heading a heading', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);

  await paste(page, {
    'text/html': '<h2>Pasted heading</h2><ul><li>one</li><li>two</li></ul>',
    'text/plain': 'Pasted heading\none\ntwo',
  });

  await expect(editor.locator('h2').last()).toHaveText('Pasted heading');
  await expect(editor.locator('ul li').last()).toHaveText('two');
});

test('ignores a paste that would insert nothing', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);
  await page.keyboard.type('untouched');

  const before = await editor.innerHTML();
  await paste(page, { 'text/plain': '   ' });
  await paste(page, { 'text/html': '<div><span></span></div>', 'text/plain': '' });

  await expect(editor).toHaveText(/untouched$/);
  expect(await editor.innerHTML()).toBe(before);
});

test('undo does not reach back into another note', async ({ page }) => {
  await openRichNote(page);
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await caretToNewBlock(page, editor);
  await page.keyboard.type('edited in place');

  await page.keyboard.press('Control+z');

  await expect(editor).not.toContainText('edited in place');
  await expect(editor).toContainText('Discussed the launch date');
});

test('a new note carries the placeholder and no content', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).first().click();

  const editor = page.getByRole('textbox', { name: 'Note content' });
  await expect(editor.locator('[data-placeholder]')).toHaveAttribute(
    'data-placeholder',
    'Write something…',
  );
});

async function paste(page: Page, flavours: Record<string, string>): Promise<void> {
  await page.evaluate((data) => {
    const node = document.querySelector<HTMLElement>('[data-testid="note-editor"]');
    if (node === null) throw new Error('editor missing');
    node.focus();
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
  }, flavours);
}