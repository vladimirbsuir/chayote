import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings } from './helpers';

/* `05-ui-ux.md` §2.4 and §9, below 768 px.

   M7 found the desktop status bar rendering unchanged on a 360 px screen: the
   title truncated to an ellipsis, the folder to one letter, and `342 words` wrapped
   onto a second line that pushed the save state out of the row. `prototype/index.html`
   §3 already drew the Android editor view correctly — folder, tags, `342 w` and
   Saved, no title because the bar above carries it — and the code ignored it.

   These are Playwright rather than Vitest tests because the claims are about
   geometry and computed style, and jsdom loads neither the Tailwind layer nor a
   layout engine. `10-conventions.md` §10 draws the same line for required test 14. */

const MOBILE = { width: 360, height: 640 };

async function openEditor(page: Page): Promise<void> {
  await page.setViewportSize(MOBILE);
  await seedSettings(page, { theme: 'light', accent: null, lastSelection: { kind: 'all' } });
  await page.goto('/');
  await expect(page.getByTestId('note-list')).toBeVisible();
  await page.getByTestId('note-card').first().click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
}

test.describe('mobile editor', () => {
  test('the status bar is the prototype row, not the desktop one', async ({ page }) => {
    await openEditor(page);

    /* §9's five elements do not fit at 360 px and the prototype does not ask them
       to. The title lives in the bar above; the pin lives in the overflow menu. */
    await expect(page.getByTestId('editor-pin-toggle')).toHaveCount(0);
    await expect(page.getByTestId('status-folder')).toBeVisible();
    await expect(page.getByTestId('status-tags')).toBeVisible();
    await expect(page.getByTestId('save-state')).toBeVisible();
  });

  test('nothing in the row truncates to an ellipsis or wraps', async ({ page }) => {
    await openEditor(page);

    /* The defect is only visible in geometry: every element still *exists* at 360 px,
       it is simply unreadable. A single-element assertion cannot catch it.

       Measured on the text, not the control. The controls are deliberately 44 px
       tall (§9 on Android), so their height says nothing about wrapping; it is the
       line inside them that has to stay one line. */
    for (const id of ['status-folder', 'status-tags', 'word-count', 'save-state']) {
      const line = page.getByTestId(id).locator('span').last();
      const box = (await line.count()) > 0 ? await line.boundingBox() : null;
      const outer = box ?? (await page.getByTestId(id).boundingBox());
      expect(outer, `${id} has no box`).not.toBeNull();
      if (outer === null) continue;
      /* No taller than one 16 px text line: `342 words` wrapping onto a second line
         was the clearest symptom, and it pushed the save state out of the row. */
      expect(outer.height, `${id} wrapped`).toBeLessThanOrEqual(20);
    }
  });

  test('the slots are 44 px touch targets, per §9 on Android', async ({ page }) => {
    await openEditor(page);

    /* Measured, not asserted from a class name: §9 asks for 44 x 44 px and the
       desktop row is 28 px tall, so the mobile bar has to grow to hold one. */
    for (const id of ['status-folder', 'status-tags']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} has no box`).not.toBeNull();
      if (box === null) continue;
      expect(box.height, `${id} is not 44 px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the overflow menu offers pin and trash, and the pin actually flips', async ({
    page,
  }) => {
    await openEditor(page);

    /* §2.4 gives the mobile editor bar "a delete action". The button existed with
       no handler until M7, so the assertion is that the menu opens and its items
       act, not merely that they render. */
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByTestId('editor-overflow-pin')).toBeVisible();
    await expect(page.getByTestId('editor-overflow-trash')).toBeVisible();

    /* Not "it becomes pinned": the fixture's first note is already pinned, so the
       press unpins it. What must hold is that the state flips, whichever way. */
    const before = await page.getByTestId('editor-overflow-pin').getAttribute('aria-pressed');
    await page.getByTestId('editor-overflow-pin').click();
    await expect(page.getByTestId('editor-overflow')).toHaveCount(0);

    await page.getByRole('button', { name: 'More' }).click();
    const after = await page.getByTestId('editor-overflow-pin').getAttribute('aria-pressed');
    expect(after).not.toBe(before);
    /* The label names the action it will do, per §10's labelling rule. */
    await expect(page.getByTestId('editor-overflow-pin')).toHaveText(
      after === 'true' ? 'Unpin note' : 'Pin note',
    );
  });

  test('a pin made in the editor reaches the Pinned filter', async ({ page }) => {
    /* The regression M7 found on the device: `EditorPane` called `notesApi.setPinned`
       directly, so it updated its own state and left every `['notes']` cache stale —
       the Pinned filter then said zero notes. Nothing in the editor looked wrong. */
    await openEditor(page);

    await page.getByRole('button', { name: 'More' }).click();
    const before = await page.getByTestId('editor-overflow-pin').getAttribute('aria-pressed');
    await page.getByTestId('editor-overflow-pin').click();

    await page.getByRole('button', { name: 'Back to list' }).click();
    await page.getByRole('tab', { name: /pinned/i }).click();

    /* The list header's count is the claim, not the rows: a stale cache shows an
       empty list, and "some cards" would also pass on a filter that never ran. */
    const header = page.getByTestId('list-header');
    await expect(header).toBeVisible();
    const count = Number((await header.textContent())?.match(/(\d+)\s+notes?/)?.[1] ?? '0');
    if (before === 'true') {
      expect(count).toBe(0);
    } else {
      expect(count).toBe(1);
    }
  });
});

test.describe('mobile list', () => {
  test('the sidebar fills the viewport with no dead strip at the edge', async ({ page }) => {
    /* Found on a phone: the list below the search field ended early with a
       vertical divider floating off the right edge. The mobile list reuses the
       desktop sidebar, which carried its fixed pane width into a full-width
       column — and a divider against nothing. Like the status-bar tests above,
       the defect is only visible in geometry. */
    await page.setViewportSize(MOBILE);
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    const box = await page.getByTestId('sidebar').boundingBox();
    expect(box, 'sidebar has no box').not.toBeNull();
    if (box === null) return;
    expect(box.x, 'sidebar does not start at the viewport edge').toBe(0);
    expect(box.width, 'sidebar does not fill the viewport').toBe(MOBILE.width);
  });
});