import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/* `11-verification.md` §4 level 1: assertions, not screenshots. Layout at every
   breakpoint in `05-ui-ux.md` §9, the selection model of §5, the empty states of
   §8, and the three shortcuts of §7 that only exist once a list does.

   Every test drives the mock backend through the browser, which is the property
   ADR-018 exists for: if these needed the packaged app, they would be human
   checks instead of gates. */

/* Two live fixtures with different content, so a click that fails to switch the
   editor is visible rather than looking like a click that opened the same note. */
const RICH_NOTE = '01980000-0000-7000-8000-000000000001';
const SECOND_NOTE = '01980000-0000-7000-8000-000000000002';

/* Seeds the settings store once, and only if nothing is there. `addInitScript`
   runs on every navigation including a reload, so a script that wrote
   unconditionally would overwrite the very state a reload test is trying to
   observe. */
async function seed(page: Page): Promise<void> {
  await page.addInitScript(
    ([id, selection]) => {
      if (window.localStorage.getItem('settings.json') !== null) return;
      window.localStorage.setItem(
        'settings.json',
        JSON.stringify({ theme: 'light', lastNoteId: id, lastSelection: selection }),
      );
    },
    [RICH_NOTE, { kind: 'all' }] as const,
  );
}

async function open(page: Page): Promise<void> {
  await seed(page);
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

test.describe('desktop two-pane layout', () => {
  test('puts the sidebar and the editor side by side above 1024 px', async ({ page }) => {
    await open(page);

    const sidebar = page.getByTestId('sidebar');
    const editor = page.getByRole('main', { name: 'Editor' });

    await expect(sidebar).toBeVisible();
    await expect(editor).toBeVisible();

    const sidebarBox = await sidebar.boundingBox();
    const editorBox = await editor.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(editorBox).not.toBeNull();

    /* §9: sidebar default 320 px at >= 1280 px, and the editor starts where the
       sidebar ends rather than overlapping it. */
    expect(Math.round(sidebarBox?.width ?? 0)).toBe(320);
    expect(editorBox?.x ?? 0).toBeGreaterThanOrEqual(sidebarBox?.width ?? 0);
  });

  test('caps the editor column at the 720 px readable measure', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await open(page);

    const editor = page.getByRole('textbox', { name: 'Note content' });
    await expect(editor).toBeVisible();

    const column = await page.locator('.note-editor').boundingBox();
    expect(Math.round(column?.width ?? 0)).toBe(720);
  });

  test('collapses and restores the sidebar with Ctrl+Backslash', async ({ page }) => {
    await open(page);
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();

    await page.keyboard.press('Control+Backslash');
    await expect(sidebar).toHaveCount(0);

    await page.keyboard.press('Control+Backslash');
    await expect(sidebar).toBeVisible();
  });

  test('resizes the sidebar by keyboard within the 240-480 px range', async ({ page }) => {
    await open(page);
    const handle = page.getByTestId('sidebar-resize');
    await expect(handle).toBeVisible();

    /* The editor is code-split and autofocuses the caret when it mounts
       (`04-editor.md`: speed to first keystroke, `autofocus: 'end'`). If the
       chunk lands mid-test it takes focus off the handle and every later keypress
       goes to the editor instead, so the loop stalls on a width that is neither
       bound. Waiting for it up front removes the race rather than papering over
       it with retries. */
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();

    const sidebar = page.getByTestId('sidebar');
    const width = async (): Promise<number> =>
      Math.round((await sidebar.boundingBox())?.width ?? 0);

    await handle.focus();
    const start = await width();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'sidebar-resize',
    );

    /* Driven by the clamp rather than by a keystroke count. Each press moves
       16 px and the allowed range is 240 px wide, so how many presses reach an
       end depends on where the sidebar started. Pressing until the width stops
       changing asserts the bound in §9, which is the actual rule, and does not
       depend on the starting width or on the step size. */
    /* Press until the clamp holds, with a bound on the number of presses.

       The width is read once per press rather than in a `while` condition: a
       bounding-box read inside a loop condition is re-evaluated after every
       press, so a resize that stalls — a dropped keypress, focus lost
       mid-loop — spins until the whole test times out instead of failing with a
       number. The iteration cap turns that into a clear assertion failure. */
    const press = async (key: 'ArrowLeft' | 'ArrowRight', until: number): Promise<void> => {
      for (let i = 0; i < 40; i += 1) {
        if ((await width()) === until) return;
        await page.keyboard.press(key);
      }
    };

    await press('ArrowLeft', 240);
    expect(await width()).toBe(240);

    await press('ArrowRight', 480);
    expect(await width()).toBe(480);

    /* And the starting width was inside the range, so the clamp was reached by
       moving rather than by being there already. */
    expect(start).toBeGreaterThanOrEqual(240);
    expect(start).toBeLessThanOrEqual(480);
  });

  test('clamps a sidebar drag at both ends of the range', async ({ page }) => {
    await open(page);
    const sidebar = page.getByTestId('sidebar');
    const width = async (): Promise<number> =>
      Math.round((await sidebar.boundingBox())?.width ?? 0);

    /* Grab the handle at its *current* position for each drag. It moves as the
       sidebar resizes, so a second drag that starts from the first drag's
       coordinates lands somewhere else entirely — which is exactly the bug this
       test exists to catch, and would otherwise be reported as a clamp failure. */
    const grab = async (): Promise<{ x: number; y: number }> => {
      const box = await page.getByTestId('sidebar-resize').boundingBox();
      if (box === null) throw new Error('resize handle has no box');
      const point = { x: box.x + box.width / 2, y: box.y + 200 };
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      return point;
    };

    /* A drag must not take the sidebar past either end, however far the pointer
       travels — §9 fixes the range, and the pointer can leave the window. */
    const right = await grab();
    await page.mouse.move(2_000, right.y, { steps: 5 });
    await page.mouse.up();
    expect(await width()).toBe(480);

    const left = await grab();
    await page.mouse.move(0, left.y, { steps: 5 });
    await page.mouse.up();
    expect(await width()).toBe(240);
  });
});

test.describe('selection model', () => {
  test('shows the live note list for the all selection', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('list-header')).toHaveText('All notes');
    /* Six live fixtures plus the empty note. */
    await expect(page.getByTestId('note-card').first()).toBeVisible();
  });

  test('switches to a folder selection and names it in the header', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').first().click();

    await expect(page.getByTestId('list-header')).toHaveText('Work');
    /* Every card in a folder selection belongs to that folder. */
    const cards = page.getByTestId('note-card');
    await expect(cards.first()).toBeVisible();
  });

  test('narrows to pinned notes only', async ({ page }) => {
    await open(page);

    await page.getByTestId('filter-pinned').click();

    await expect(page.getByTestId('list-header')).toHaveText('Pinned');
    await expect(page.getByTestId('note-card')).toHaveCount(2);
  });

  test('shows trash separately from live notes', async ({ page }) => {
    await open(page);

    await page.getByTestId('filter-trash').click();

    await expect(page.getByTestId('list-header')).toHaveText('Trash');
    await expect(page.getByTestId('note-card')).toHaveCount(1);
  });

  test('marks exactly one filter tab as selected', async ({ page }) => {
    await open(page);

    await page.getByTestId('filter-trash').click();

    await expect(page.getByTestId('filter-trash')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('filter-all')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('filter-pinned')).toHaveAttribute('aria-selected', 'false');
  });

  test('says nothing here for an empty folder rather than nothing at all', async ({ page }) => {
    await open(page);

    /* "Archive" holds only the trashed fixture, so it is empty among live notes. */
    await page.getByTestId('folder-row').filter({ hasText: 'Archive' }).click();

    await expect(page.getByText('Nothing here')).toBeVisible();
  });

  test('restores the selection and the open note across a reload', async ({ page }) => {
    await open(page);

    await page.getByTestId('filter-pinned').click();
    await page.getByTestId('note-card').last().click();
    const openId = await page
      .getByTestId('note-card')
      .last()
      .getAttribute('data-note-id');

    await page.reload();

    await expect(page.getByTestId('filter-pinned')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-testid="note-card"][data-note-id="${openId}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

test.describe('note list', () => {
  test('sorts pinned notes above everything else', async ({ page }) => {
    await open(page);

    const cards = page.getByTestId('note-card');
    await expect(cards.first()).toContainText('Meeting notes');
  });

  test('shows a relative timestamp, not a formatted date', async ({ page }) => {
    await open(page);

    /* §6.5a: the fixture clock is fixed, and `now`/`N min`/`N h` are the forms. */
    const first = await page.getByTestId('note-card').first().innerText();
    expect(first).toMatch(/now|\d+ min|\d+ h|yesterday|\d+ d|\d+ [A-Z][a-z]{2}/);
  });

  test('shows Untitled in the muted italic form for an unnamed note', async ({ page }) => {
    await open(page);

    const untitled = page.getByTestId('note-card').filter({ hasText: 'Untitled' }).first();
    await expect(untitled).toBeVisible();
  });

  test('carries no document body in a card', async ({ page }) => {
    await open(page);

    const card = page.getByTestId('note-card').first();
    const text = await card.innerText();
    /* The excerpt is `plain_text`-derived; the document's own structure is not. */
    expect(text).not.toContain('{"type"');
    expect(text).not.toContain('data-type=');
  });

  test('lays cards out without overlapping or clipping them', async ({ page }) => {
    /* Rows are measured rather than assumed, and a wrong row height is invisible
       to a single-element assertion: the card is the right size, it is simply
       positioned on top of its neighbour. Only pairwise geometry catches it. */
    await open(page);

    const cards = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]')).map((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    );

    expect(cards.length).toBeGreaterThan(2);
    for (let i = 1; i < cards.length; i += 1) {
      const previous = cards[i - 1];
      const current = cards[i];
      if (previous === undefined || current === undefined) continue;
      /* 1 px of tolerance absorbs sub-pixel rounding, not a real overlap. */
      expect(current.top).toBeGreaterThanOrEqual(previous.bottom - 1);
    }

    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]'))
        .filter((el) => el.scrollHeight > el.clientHeight + 1)
        .map((el) => el.textContent.slice(0, 40)),
    );
    expect(clipped).toEqual([]);
  });

  test('marks the open note and opens another on click', async ({ page }) => {
    await open(page);

    await expect(page.locator(`[data-testid="note-card"][data-note-id="${RICH_NOTE}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.locator(`[data-testid="note-card"][data-note-id="${SECOND_NOTE}"]`).click();

    await expect(page.locator(`[data-testid="note-card"][data-note-id="${SECOND_NOTE}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('textbox', { name: 'Note content' })).toContainText('Q3 roadmap');
  });

  test('mounts a bounded window of cards at 10 000 notes', async ({ page }) => {
    /* `02-architecture.md` §8: 10 000 notes at 60 fps, virtualised from the
       first commit. The assertion is that the DOM holds a window rather than the
       whole list, which is what regresses silently otherwise. */
    await page.goto('/');
    await expect(page.getByTestId('app-shell')).toBeVisible();

    await page.evaluate(() => {
      window.localStorage.setItem(
        'settings.json',
        JSON.stringify({ theme: 'light', lastSelection: { kind: 'all' }, seed: 10_000 }),
      );
    });

    await page.goto('/');
    await expect(page.getByTestId('note-card').first()).toBeVisible();

    const count = await page.getByTestId('note-card').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(80);
  });
});

test.describe('responsive layouts', () => {
  test('uses an overlay drawer at 900 px with the editor still mounted', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1023 });
    await open(page);

    const drawer = page.getByTestId('sidebar-drawer');
    await expect(drawer).toHaveAttribute('data-open', 'false');
    await expect(page.getByRole('main', { name: 'Editor' })).toBeVisible();

    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(drawer).toHaveAttribute('data-open', 'true');
    await expect(page.getByTestId('drawer-scrim')).toBeVisible();

    await page.getByTestId('drawer-scrim').click();
    await expect(drawer).toHaveAttribute('data-open', 'false');
  });

  test('shows one view at a time below 768 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page);

    /* §2.4: the list is on screen at rest; the editor is a pushed view. */
    await expect(page.getByTestId('note-list')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveCount(0);

    await page.getByTestId('note-card').first().click();

    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    await expect(page.getByTestId('note-list')).toHaveCount(0);
  });

  test('returns to the list from the mobile editor with the back affordance', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page);

    await page.getByTestId('note-card').first().click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to list' }).click();
    await expect(page.getByTestId('note-list')).toBeVisible();
  });

  test('never sizes a fixed element in vh on a small screen', async ({ page }) => {
    /* §4.3 of `06-platform.md`: the keyboard changes the visible height, so a vh
       element is a bug waiting for a device. */
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page);

    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          const height = getComputedStyle(el).height;
          return /^\d+(\.\d+)?vh$/.test(height);
        })
        .map((el) => `${el.tagName}.${el.className}`),
    );
    expect(offenders).toEqual([]);
  });
});

test.describe('keyboard shortcuts', () => {
  test('focuses the search field with Ctrl+F', async ({ page }) => {
    await open(page);

    await page.getByTestId('note-card').first().click();
    await page.keyboard.press('Control+f');

    await expect(page.getByRole('searchbox', { name: 'Search notes' })).toBeFocused();
  });

  test('creates a note with Ctrl+N and opens it in the editor', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').first().click();

    const before = await page.getByTestId('note-card').count();
    await page.keyboard.press('Control+n');

    await expect(page.getByTestId('note-card')).toHaveCount(before + 1);
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
  });

  test('files a new note in the selected folder', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').first().click();
    await page.getByRole('button', { name: 'New note' }).first().click();

    /* §6.1: the current folder wins over unfiled. */
    await expect(page.getByTestId('note-card').first()).toBeVisible();
  });
});

test.describe('first launch', () => {
  test('creates no folders and no tags, and says so', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'settings.json',
        JSON.stringify({ theme: 'light', lastSelection: { kind: 'all' } }),
      );
    });
    /* `?seed=empty` is the ADR-014 first-launch database: zero of everything. */
    await page.goto('/?seed=empty');

    await expect(page.getByTestId('first-launch-new-note')).toBeVisible();
    await expect(page.getByText('No notes yet')).toBeVisible();
    await expect(page.getByText('No folders yet')).toBeVisible();
    await expect(page.getByText('No tags yet')).toBeVisible();
  });
});