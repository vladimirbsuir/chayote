import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { seedSettings } from './helpers';

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

async function openRichNote(page: Page): Promise<Locator> {
  await seedSettings(page, {
    theme: 'light',
    accent: null,
    lastNoteId: RICH_NOTE,
    lastSelection: { kind: 'all' },
  });
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Note content' });
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('formatting-toolbar')).toBeVisible();
  return editor;
}

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

async function caretToNewBlock(page: Page, editor: Locator): Promise<void> {
  await editor.locator(':scope > *').last().click();
  await settleEditor(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
}

test.describe('formatting toolbar', () => {
  test('sits above the editor content and applies bold without losing focus', async ({
    page,
  }) => {
    const editor = await openRichNote(page);

    const toolbar = page.getByTestId('formatting-toolbar');
    const editorBox = await editor.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(editorBox, 'editor has no box').not.toBeNull();
    expect(toolbarBox, 'toolbar has no box').not.toBeNull();
    if (editorBox === null || toolbarBox === null) return;
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(editorBox.y + 1);

    await caretToNewBlock(page, editor);
    await page.keyboard.type('tooltipped');
    await settleEditor(page);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await settleEditor(page);

    await page.getByRole('button', { name: 'Bold' }).click();
    await expect(editor.locator('strong').last()).toContainText('tooltipped');
    await expect(editor).toBeFocused();
    await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('applies a heading and a bullet list through its buttons', async ({ page }) => {
    const editor = await openRichNote(page);
    await caretToNewBlock(page, editor);

    await page.keyboard.type('Toolbar heading');
    await settleEditor(page);
    for (let i = 0; i < 16; i += 1) {
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await settleEditor(page);
    await page.getByRole('button', { name: 'Heading 2' }).click();
    await expect(editor.locator('h2').last()).toHaveText('Toolbar heading');

    await page.keyboard.press('Enter');
    await page.keyboard.type('toolbar bullet');
    await settleEditor(page);
    /* `Shift+Home` selects the line without running off into the block above:
       walking left a fixed count overshoots short text and the spanning
       selection makes the list toggle inapplicable, so the button disables. */
    await page.keyboard.press('Shift+Home');
    await settleEditor(page);
    await page.getByRole('button', { name: 'Bullet list' }).click();
    await expect(editor.locator('ul li').last()).toHaveText('toolbar bullet');

    /* Tailwind's preflight clears `list-style` globally: the indent without a
       marker is the only visible symptom, so the marker style itself is the
       assertion rather than the node existing. */
    const bulletStyle = await editor
      .locator('ul')
      .last()
      .evaluate((node) => getComputedStyle(node).listStyleType);
    expect(bulletStyle).toBe('disc');
  });

  test('renders ordered list numbers', async ({ page }) => {
    const editor = await openRichNote(page);
    await caretToNewBlock(page, editor);

    await page.keyboard.type('numbered item');
    await settleEditor(page);
    await page.keyboard.press('Shift+Home');
    await settleEditor(page);
    await page.getByRole('button', { name: 'Ordered list' }).click();
    await expect(editor.locator('ol li').last()).toHaveText('numbered item');

    const numberStyle = await editor
      .locator('ol')
      .last()
      .evaluate((node) => getComputedStyle(node).listStyleType);
    expect(numberStyle).toBe('decimal');
  });

  test('undoes through its undo button', async ({ page }) => {
    const editor = await openRichNote(page);
    await caretToNewBlock(page, editor);
    await page.keyboard.type('undo me');
    await settleEditor(page);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await settleEditor(page);
    await page.getByRole('button', { name: 'Bold' }).click();
    await expect(editor.locator('strong', { hasText: 'undo me' })).toHaveCount(1);

    /* Scoped to the typed mark: the fixture already carries a bold
       "launch date" in its first paragraph, so an absolute count never
       reaches zero. */
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(editor.locator('strong', { hasText: 'undo me' })).toHaveCount(0);
  });
});

test.describe('formatting toolbar on mobile', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test('sits below the editor bar and scrolls without wrapping', async ({ page }) => {
    await seedSettings(page, {
      theme: 'light',
      accent: null,
      lastSelection: { kind: 'all' },
    });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();
    await page.getByTestId('note-card').first().click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();

    const toolbar = page.getByTestId('formatting-toolbar');
    await expect(toolbar).toBeVisible();

    const back = page.getByRole('button', { name: 'Back to list' });
    const toolbarBox = await toolbar.boundingBox();
    const backBox = await back.boundingBox();
    expect(toolbarBox, 'toolbar has no box').not.toBeNull();
    expect(backBox, 'back button has no box').not.toBeNull();
    if (toolbarBox === null || backBox === null) return;
    expect(toolbarBox.y).toBeGreaterThanOrEqual(backBox.y + backBox.height);

    const overflowX = await toolbar.evaluate(
      (node) => getComputedStyle(node).overflowX,
    );
    expect(overflowX).toBe('auto');

    const boldBox = await page.getByRole('button', { name: 'Bold' }).boundingBox();
    expect(boldBox, 'bold button has no box').not.toBeNull();
    if (boldBox === null) return;
    expect(boldBox.height).toBeGreaterThanOrEqual(44);
  });
});
