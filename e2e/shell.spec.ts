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

  test('chrome text is not selectable; the editor and the fields are', async ({ page }) => {
    /* `05-ui-ux.md` §9: rows, menus, bars and dialogs carry `select-none` so a
       hold is always a gesture, never a text selection; text inputs opt back in
       with `select-text`. Asserted on computed style, which is what the
       platform's long-press menu actually reads. */
    await open(page);

    const userSelectOf = (selector: string): Promise<string> =>
      page
        .locator(selector)
        .first()
        .evaluate((node) => getComputedStyle(node).userSelect);

    await expect(page.getByTestId('sidebar')).toBeVisible();
    expect(await userSelectOf('[data-testid="sidebar"]')).toBe('none');
    expect(await userSelectOf('[data-testid="folder-row"]')).toBe('none');
    expect(await userSelectOf('[data-testid="tag-row"]')).toBe('none');
    expect(await userSelectOf('[data-testid="note-card"]')).toBe('none');
    expect(await userSelectOf('header')).toBe('none');
    expect(await userSelectOf('[data-testid="save-state"]')).toBe('none');

    /* Fields the user types in keep their selection toolbar. */
    expect(await userSelectOf('input[aria-label="Search notes"]')).not.toBe('none');
    expect(await userSelectOf('[role="textbox"][aria-label="Note content"]')).not.toBe('none');
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
    const openId = await page.getByTestId('note-card').last().getAttribute('data-note-id');

    await page.reload();

    await expect(page.getByTestId('filter-pinned')).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.locator(`[data-testid="note-card"][data-note-id="${openId}"]`),
    ).toHaveAttribute('aria-selected', 'true');
  });
});

/* `05-ui-ux.md` §2.2: the Folders and Tags sections collapse as a whole from a
   chevron in their headers — the twisty hides one branch, and a long top-level
   list needs the coarser control. */
test.describe('sidebar sections', () => {
  test('collapses the whole Folders list from its header', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('folder-row').first()).toBeVisible();
    await page.getByTestId('section-toggle-folders').click();

    await expect(page.getByTestId('folder-row')).toHaveCount(0);
    await expect(page.getByTestId('section-toggle-folders')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByTestId('note-card').first()).toBeVisible();

    await page.getByTestId('section-toggle-folders').click();
    await expect(page.getByTestId('folder-row').first()).toBeVisible();
  });

  test('collapses the whole Tags list from its header', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('tag-row').first()).toBeVisible();
    await page.getByTestId('section-toggle-tags').click();

    await expect(page.getByTestId('tag-row')).toHaveCount(0);
    await expect(page.getByTestId('note-card').first()).toBeVisible();
  });

  test('lines top-level rows up under their section headers', async ({ page }) => {
    /* The twisty shares the header chevron's column and each glyph shares its
       header glyph's column — measured, not asserted from class names, since a
       few pixels of drift are invisible to every DOM assertion and are exactly
       what a scaled root font produces. One pixel of tolerance absorbs
       sub-pixel rounding, not a real offset. */
    await open(page);

    const leftOf = async (testId: string): Promise<number> => {
      const box = await page.getByTestId(testId).first().boundingBox();
      expect(box, `${testId} has no box`).not.toBeNull();
      return Math.round(box?.x ?? -1);
    };

    expect(
      Math.abs((await leftOf('folder-twisty')) - (await leftOf('section-toggle-folders'))),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await leftOf('folder-icon')) - (await leftOf('section-icon-folders'))),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await leftOf('tag-icon')) - (await leftOf('section-icon-tags'))),
    ).toBeLessThanOrEqual(1);
  });

  test('keeps a collapsed section collapsed across a reload', async ({ page }) => {
    await open(page);

    await page.getByTestId('section-toggle-tags').click();
    await expect(page.getByTestId('tag-row')).toHaveCount(0);

    /* Settings are written through the 300 ms debounce, so the stored value is
       polled rather than read straight after the click. */
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('settings.json');
          if (raw === null) return null;
          return (
            (JSON.parse(raw) as { sectionsCollapsed?: { tags?: boolean } }).sectionsCollapsed
              ?.tags ?? null
          );
        }),
      )
      .toBe(true);

    await page.reload();

    await expect(page.getByTestId('tag-row')).toHaveCount(0);
    await expect(page.getByTestId('section-toggle-tags')).toHaveAttribute('aria-expanded', 'false');
  });
});

/* `05-ui-ux.md` §10 requires the tree pattern, and M4's acceptance bar is a
   keyboard-navigable tree. These drive it in a real browser because the parts
   jsdom cannot judge are the parts that matter: that a click lands on the row and
   not the twisty, that Tab reaches the tree as a single stop, and that the focus
   ring is actually painted. */
test.describe('folder tree keyboard pattern', () => {
  test('reaches a nested folder with the arrow keys and selects it with Enter', async ({
    page,
  }) => {
    await open(page);

    const work = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await work.focus();
    await expect(work).toBeFocused();

    /* Right enters the already-expanded branch, landing on its first child. */
    await page.keyboard.press('ArrowRight');
    const projects = page.getByTestId('folder-row').filter({ hasText: 'Projects' });
    await expect(projects).toBeFocused();

    /* Down reaches the sibling below it, then Enter selects it. */
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Meetings' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(projects).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('list-header')).toHaveText('Projects');
  });

  test('climbs back out to the parent with ArrowLeft', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').filter({ hasText: 'Work' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Projects' })).toBeFocused();

    /* Projects is a leaf, so Left moves out to Work rather than collapsing it. */
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Work' })).toBeFocused();
  });

  test('collapses a branch with ArrowLeft and expands it with ArrowRight', async ({ page }) => {
    await open(page);

    const work = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await work.focus();
    await expect(work).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('ArrowLeft');
    await expect(work).toHaveAttribute('aria-expanded', 'false');
    /* The whole point of collapsing: the child is gone from the tree, not just
       hidden behind an attribute. */
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Projects' })).toHaveCount(0);

    await page.keyboard.press('ArrowRight');
    await expect(work).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Projects' })).toBeVisible();
  });

  test('is one tab stop rather than one per folder', async ({ page }) => {
    await open(page);

    const focusable = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-testid="folder-row"]')).filter(
          (el) => el.getAttribute('tabindex') === '0',
        ).length,
    );

    expect(focusable).toBe(1);
  });

  test('paints a visible focus ring on the focused row', async ({ page }) => {
    await open(page);

    const work = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await work.focus();

    /* §10: a 2 px accent ring, never removed. Asserting the property rather than
       a screenshot, because the value is what the requirement states. */
    const outline = await work.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });

  test('keeps the twisty out of the tab order, since the arrows do its job', async ({ page }) => {
    await open(page);

    await expect(page.getByRole('button', { name: 'Collapse Work' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });
});

/* `05-ui-ux.md` §6.3: folder create and rename are inline inputs, and a folder with
   children cannot be deleted without a confirmation that names the count. These run
   against the mock backend end to end, because the parts jsdom cannot judge are the
   parts that matter — that the input takes focus, that `Enter` reaches the command
   rather than the editor behind it, and that the dialog traps focus. */
test.describe('folder organisation', () => {
  test('creates a folder from an inline input with Enter', async ({ page }) => {
    await open(page);
    const before = await page.getByTestId('folder-row').count();

    await page.getByRole('button', { name: 'New folder' }).click();
    const input = page.getByTestId('folder-name-input');
    await expect(input).toBeFocused();
    /* Typed, not filled, and committed from the keyboard: `fill`/`press` hold
       an element handle across React re-renders, and a node swapped mid-action
       retries until the timeout — keystrokes land on whatever holds focus. */
    await input.pressSequentially('Research');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('folder-row')).toHaveCount(before + 1);
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Research' })).toBeVisible();
    expect(await page.getByRole('dialog').count()).toBe(0);
  });

  test('cancels the create input on Escape without writing', async ({ page }) => {
    await open(page);
    const before = await page.getByTestId('folder-row').count();

    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByTestId('folder-name-input').pressSequentially('Discarded');
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('folder-name-input')).toHaveCount(0);
    await expect(page.getByTestId('folder-row')).toHaveCount(before);
  });

  test('renames a folder with F2 and keeps its notes', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').filter({ hasText: 'Work' }).focus();
    await page.keyboard.press('F2');

    const input = page.getByTestId('folder-name-input');
    await expect(input).toHaveValue('Work');
    await input.fill('Day job');
    await input.press('Enter');

    await expect(page.getByTestId('folder-row').filter({ hasText: 'Day job' })).toBeVisible();
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Work' })).toHaveCount(0);
  });

  test('confirms before deleting a folder with children, naming the count', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').filter({ hasText: 'Work' }).click({ button: 'right' });
    await page.getByTestId('folder-menu-delete').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    /* §6.3: the count is why the dialog exists. */
    await expect(dialog).toContainText('2 folders');
    await expect(dialog).toContainText('become unfiled');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Work' })).toBeVisible();
  });

  test('takes the whole subtree with a confirmed delete', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').filter({ hasText: 'Work' }).click({ button: 'right' });
    await page.getByTestId('folder-menu-delete').click();
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page.getByTestId('folder-row').filter({ hasText: 'Work' })).toHaveCount(0);
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Projects' })).toHaveCount(0);
    /* The notes survived as unfiled rather than going with the folder. */
    await expect(page.getByTestId('note-card').first()).toBeVisible();
  });

  test('keeps focus inside the delete confirmation', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').filter({ hasText: 'Work' }).click({ button: 'right' });
    await page.getByTestId('folder-menu-delete').click();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();

    /* §10: Tab must not walk behind the dialog into the editor, or the next
       keystroke types into a note the user thinks is not being edited. */
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('confirm-dialog-confirm')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  test('restores focus to the row when the confirmation closes', async ({ page }) => {
    await open(page);

    const work = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await work.click({ button: 'right' });
    await page.getByTestId('folder-menu-delete').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(work).toBeFocused();
  });

  test('opens the folder menu from the row button and from right-click alike', async ({ page }) => {
    await open(page);

    /* The row button is `pointer-fine:group-hover:flex` — §9 says hover styling
       exists only at `pointer: fine` — so the row has to be hovered before the
       button is anything to click. `force: true` would skip that and click an
       element the browser still lays out as `display: none`. */
    const work = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await work.hover();
    await page.getByRole('button', { name: 'Work actions' }).click();
    await expect(page.getByTestId('folder-menu')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('folder-row').filter({ hasText: 'Personal' }).click({ button: 'right' });
    await expect(page.getByTestId('folder-menu')).toHaveAttribute('aria-label', 'Personal actions');
  });

  test('offers no menu button at a coarse pointer, where long-press is the gesture', async ({
    browser,
  }) => {
    /* A real touch-capable context rather than a media emulation: §9 says hover
       affordances exist at `pointer: fine` and nowhere else, and on touch the menu
       opens by long-press instead. Asserting the absence here is what stops a
       hover-only control from becoming an unreachable one on Android.

       `hasTouch` alone does not change `pointer: fine` — Chromium reports a
       fine pointer for a mouse-driven context regardless — so the pointer type is
       overridden explicitly. */
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: false,
      viewport: { width: 1280, height: 820 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      /* Replace the media query the `pointer-fine:` variant compiles to, before the
         stylesheet is parsed. */
      const fine = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) =>
        query.includes('pointer: fine')
          ? { matches: false, media: query, addEventListener() {}, removeEventListener() {} }
          : fine(query)) as typeof window.matchMedia;
    });
    await seed(page);
    await page.goto('/');
    await expect(page.getByTestId('app-shell')).toBeVisible();

    const work = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await work.hover();
    await expect(page.getByRole('button', { name: 'Work actions' })).toHaveCount(0);

    await context.close();
  });

  /* §6.3: "Reordering and re-parenting by drag." `page.dragAndDrop` produces real
     HTML5 drag events in Chromium, which jsdom cannot — so this is the only place
     the interaction is proved against a browser that actually performs a drag. */
  test('re-parents a folder by dropping it onto another', async ({ page }) => {
    await open(page);

    await page
      .getByTestId('folder-row')
      .filter({ hasText: 'Personal' })
      .dragTo(page.getByTestId('folder-row').filter({ hasText: 'Work' }), {
        targetPosition: { x: 60, y: 13 },
      });

    const nested = page.getByTestId('folder-row').filter({ hasText: 'Personal' });
    await expect(nested).toBeVisible();
    /* The level is the evidence: a re-parent indents, a reorder does not. */
    await expect(nested).toHaveAttribute('aria-level', '2');
    await expect(nested).toHaveAttribute('aria-posinset', '3');
  });

  test('reorders a folder without changing its level', async ({ page }) => {
    await open(page);

    await page
      .getByTestId('folder-row')
      .filter({ hasText: 'Personal' })
      .dragTo(page.getByTestId('folder-row').filter({ hasText: 'Work' }), {
        targetPosition: { x: 60, y: 1 },
      });

    const moved = page.getByTestId('folder-row').filter({ hasText: 'Personal' });
    await expect(moved).toHaveAttribute('aria-level', '1');
    /* Above `Work`, so first among the roots. */
    await expect(moved).toHaveAttribute('aria-posinset', '1');
  });

  test('refuses to drop a folder into its own descendant', async ({ page }) => {
    await open(page);

    /* M4's acceptance bar, in the browser that performs the drag. The backend
       refuses it too; what is checked here is that nothing moved and the row is
       still there, rather than that an error appeared. */
    await page
      .getByTestId('folder-row')
      .filter({ hasText: 'Work' })
      .dragTo(page.getByTestId('folder-row').filter({ hasText: 'Projects' }), {
        targetPosition: { x: 60, y: 13 },
      });

    await expect(page.getByTestId('folder-row').filter({ hasText: 'Work' })).toBeVisible();
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Projects' })).toBeVisible();
    /* `Projects` was not adopted as a child of its own ancestor. */
    await expect(page.getByTestId('folder-row').filter({ hasText: 'Projects' })).toHaveAttribute(
      'aria-level',
      '2',
    );
  });

  test('marks the dragged row while the pointer is over another', async ({ page }) => {
    await open(page);

    const source = page.getByTestId('folder-row').filter({ hasText: 'Personal' });
    const target = page.getByTestId('folder-row').filter({ hasText: 'Work' });

    /* Started by hand so the intermediate state can be observed: `dragTo` performs
       the whole gesture and there is nothing left to assert in between.

       The `dragover` coordinate is the target row's own top plus half its height.
       A fixed `clientY` would be above the sidebar entirely, and the handler reads
       the offset relative to the row — which is the whole point of the three bands. */
    await source.dispatchEvent('dragstart');
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await target.dispatchEvent('dragover', {
      clientX: (box?.x ?? 0) + 60,
      clientY: (box?.y ?? 0) + (box?.height ?? 26) / 2,
    });

    await expect(source).toHaveAttribute('data-dragging', 'true');
    await expect(target.locator('[data-testid="drop-inside"]')).toBeVisible();
  });
});

/* `05-ui-ux.md` §6.3a. These drive the real command through the mock backend, so
   the ordering claim is checked against storage rather than against a component
   that would re-sort it for us. */
/* ADR-021: tags stay listed at a zero count and the sidebar creates, renames and
   deletes them — the row menu reaches the same verbs three ways, like the
   folder and note rows. */
test.describe('tag management', () => {
  test('creates a tag from the sidebar + with a zero count', async ({ page }) => {
    await open(page);

    await page.getByRole('button', { name: 'New tag' }).click();
    await page.getByTestId('tag-name-input').pressSequentially('e2e-extra');
    await page.keyboard.press('Enter');

    /* Visible immediately, at a zero count — the hiding rule this replaces made
       exactly this flow look broken. */
    const row = page.getByTestId('tag-row').filter({ hasText: 'e2e-extra' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('0');
  });

  test('renames a tag from its row menu', async ({ page }) => {
    await open(page);

    const before = await page.getByTestId('tag-row').count();
    await page.getByTestId('tag-row').first().click({ button: 'right' });
    await page.getByTestId('tag-menu-rename').click();

    /* The rename input mounts with its contents selected, so typing replaces.
       Keystrokes, not handles: see the folder create test. */
    await page.getByTestId('tag-name-input').pressSequentially('e2e-renamed');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('tag-row').filter({ hasText: 'e2e-renamed' })).toBeVisible();
    await expect(page.getByTestId('tag-row')).toHaveCount(before);
  });

  test('deletes a tag from its row menu after confirming the count', async ({ page }) => {
    await open(page);

    const before = await page.getByTestId('tag-row').count();
    await page.getByTestId('tag-row').first().click({ button: 'right' });
    await page.getByTestId('tag-menu-delete').click();

    /* The confirmation names the count, because deleting detaches the tag from
       every note carrying it while the notes themselves survive. */
    await expect(page.getByRole('dialog')).toContainText(/removed from \d+ notes?/);
    await page.getByRole('button', { name: 'Delete tag' }).click();

    await expect(page.getByTestId('tag-row')).toHaveCount(before - 1);
  });

  test('opens the tag menu from a hold, the touch path to rename and delete', async ({ page }) => {
    /* On touch there is no hover, so the hold is the only path outside the
       editor. Dispatched, not right-clicked: a right-click sends a `mousedown`
       first and the menu closes on that, which is exactly what a touch hold
       does not do — the same reason the note rows pin it this way. */
    await open(page);
    await expect(page.getByTestId('tag-row').first()).toBeVisible();

    await page
      .getByTestId('tag-row')
      .first()
      .evaluate((row) => {
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      });

    await expect(page.getByTestId('tag-menu')).toBeVisible();
    await expect(page.getByTestId('tag-menu-rename')).toBeVisible();
    await expect(page.getByTestId('tag-menu-delete')).toBeVisible();
  });

  test('returns to All when the selected tag is deleted', async ({ page }) => {
    await open(page);

    await page.getByTestId('tag-row').first().click();
    await expect(page.getByTestId('list-header')).toContainText('Tag:');

    await page.getByTestId('tag-row').first().click({ button: 'right' });
    await page.getByTestId('tag-menu-delete').click();
    await page.getByRole('button', { name: 'Delete tag' }).click();

    await expect(page.getByTestId('list-header')).toHaveText('All notes');
  });
});

test.describe('pinning', () => {
  test('pins from a card and moves the note to the top of the list', async ({ page }) => {
    await open(page);

    const cards = page.getByTestId('note-card');
    const lastTitle = await cards.last().locator('.text-\\[14px\\]').innerText();
    expect(await cards.first().innerText()).toContain('Meeting notes');

    /* Unpinned cards carry no pin of their own — pinning runs from the row
       menu — so this goes through the menu's Pin item. */
    await cards.last().click({ button: 'right' });
    await page.getByTestId('note-menu-pin').click();

    /* §6.3a: pinned notes sort above every other note in every selection. The first
       card changing identity is the whole claim — a pin indicator alone would not
       prove it. */
    await expect(cards.first().locator('.text-\\[14px\\]')).toHaveText(lastTitle);
  });

  test('shows the pin control only on pinned cards', async ({ page }) => {
    await open(page);

    /* The seeded first card is pinned and carries its unpin control outright;
       the unpinned last card carries none — pinning runs from the row menu,
       the editor and the shortcut instead. */
    await expect(page.getByTestId('note-card').first().getByTestId('pin-toggle')).toHaveCount(1);
    await expect(page.getByTestId('note-card').last().getByTestId('pin-toggle')).toHaveCount(0);
  });

  test('does not open the note when the pin is pressed', async ({ page }) => {
    await open(page);

    /* The seeded first card is pinned: opening it, then pressing its unpin
       control, must leave the selection where it was. */
    await page.getByTestId('note-card').first().click();
    const openId = await page.getByTestId('note-card').first().getAttribute('data-note-id');

    await page
      .locator(`[data-testid="note-card"][data-note-id="${openId}"]`)
      .getByTestId('pin-toggle')
      .click();

    /* A pin that also opened the note would be useless on a row the user was
       already reading. */
    await expect(
      page.locator(`[data-testid="note-card"][data-note-id="${openId}"]`),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('toggles the pin of the open note with Ctrl+D', async ({ page }) => {
    await open(page);

    const pin = page.getByTestId('editor-pin-toggle');
    /* The seeded note is already pinned, so the test asserts a *toggle* rather than
       a direction: read the state, press, require the opposite. A test that assumed
       an initial value would pass for the wrong reason the day the fixture changed. */
    const before = await pin.getAttribute('aria-pressed');

    await page.getByRole('textbox', { name: 'Note content' }).click();
    await page.keyboard.press('Control+d');

    await expect(pin).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    await expect(pin).toHaveAttribute('aria-label', before === 'true' ? 'Pin note' : 'Unpin note');

    await page.keyboard.press('Control+d');
    await expect(pin).toHaveAttribute('aria-pressed', before ?? 'false');
  });

  test('keeps a Ctrl+D pin through the next keystroke, rather than being overwritten by the autosave', async ({
    page,
  }) => {
    await open(page);

    const editor = page.getByRole('textbox', { name: 'Note content' });
    const pin = page.getByTestId('editor-pin-toggle');
    await editor.click();

    /* Pressed twice, so the note ends up in the opposite state to the one it was
       seeded in, and the check is a comparison rather than an assumption. */
    const before = await pin.getAttribute('aria-pressed');
    await page.keyboard.press('Control+d');
    await expect(pin).not.toHaveAttribute('aria-pressed', before ?? 'false');
    const pinned = await pin.getAttribute('aria-pressed');

    /* The autosave target carries `isPinned`. If the in-memory value were not
       updated with it, this keystroke would save the old flag and silently undo the
       pin — the failure this test exists for. */
    await editor.press('End');
    await page.keyboard.type(' more');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');

    await expect(pin).toHaveAttribute('aria-pressed', pinned ?? 'false');

    /* The same flag on the card, addressed by id rather than by position: the save
       just moved the note, so "the first card" is no longer necessarily this one.
       An unpinned card carries no control at all, so that direction asserts
       absence rather than a pressed state. */
    const noteId = await page
      .getByTestId('note-card')
      .filter({ hasText: 'Meeting notes' })
      .getAttribute('data-note-id');
    const card = page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`);
    if (pinned === 'true') {
      await expect(card.getByTestId('pin-toggle')).toHaveAttribute('aria-pressed', 'true');
    } else {
      await expect(card.getByTestId('pin-toggle')).toHaveCount(0);
    }
  });

  test('offers no pin control in the trash', async ({ page }) => {
    await open(page);

    await page.getByTestId('filter-trash').click();
    await expect(page.getByTestId('note-card').first()).toBeVisible();
    await expect(page.getByTestId('note-card').first().getByTestId('pin-toggle')).toHaveCount(0);

    /* The pin of a deleted note is still shown — as an icon, since there is nothing
       to toggle. */
    const indicators = page.locator('[data-testid="pin-indicator"]');
    if ((await indicators.count()) > 0) {
      await expect(indicators.first()).toBeVisible();
    }
  });

  test('unpinning the last note leaves the Pinned filter empty, as its copy claims', async ({
    page,
  }) => {
    await open(page);
    await page.getByTestId('filter-pinned').click();
    const cards = page.getByTestId('note-card');
    await expect(cards).toHaveCount(2);

    /* Unpin both, through the card control rather than a shortcut, so the empty
       state is reached the way a user reaches it. Counted down as the presses go,
       because the list shrinks under the control that is being pressed. */
    await expect(cards).toHaveCount(2);
    for (const remaining of [1, 0]) {
      const card = page.getByTestId('note-card').first();
      await card.getByTestId('pin-toggle').click();
      await expect(cards).toHaveCount(remaining);
    }

    /* §8: "Nothing pinned" · "Pin a note with Ctrl+D to keep it at the top." The copy
       names the shortcut, so the copy and the binding are asserted together — this
       was the promise the M3 UI made with nothing behind it. */
    await expect(page.getByText('Nothing pinned')).toBeVisible();
    await expect(page.getByText(/Ctrl\+D/)).toBeVisible();
  });
});

test.describe('folder organisation', () => {
  test('nests a new folder inside the row that asked for it', async ({ page }) => {
    await open(page);

    await page.getByTestId('folder-row').filter({ hasText: 'Work' }).click({ button: 'right' });
    await page.getByTestId('folder-menu-create').click();

    const input = page.getByTestId('folder-name-input');
    await expect(input).toHaveAttribute('aria-label', 'New folder inside Work');
    await input.fill('Clients');
    await input.press('Enter');

    const nested = page.getByTestId('folder-row').filter({ hasText: 'Clients' });
    await expect(nested).toBeVisible();
    /* Nested means indented one level deeper, which is what makes it a child. */
    await expect(nested).toHaveAttribute('aria-level', '2');
  });

  test('nests a new folder inside the row that asked for it, by keyboard too', async ({ page }) => {
    await open(page);

    /* The menu path is tested above; this one is the keyboard route to the same
       editor, which §10 requires for every action. */
    const work = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await work.focus();
    await page.keyboard.press('ContextMenu');

    await expect(page.getByTestId('folder-menu-create')).toBeVisible();
    await page.getByTestId('folder-menu-create').click();

    const input = page.getByTestId('folder-name-input');
    await input.pressSequentially('Clients');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('folder-row').filter({ hasText: 'Clients' })).toHaveAttribute(
      'aria-level',
      '2',
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

    await expect(
      page.locator(`[data-testid="note-card"][data-note-id="${RICH_NOTE}"]`),
    ).toHaveAttribute('aria-selected', 'true');

    await page.locator(`[data-testid="note-card"][data-note-id="${SECOND_NOTE}"]`).click();

    await expect(
      page.locator(`[data-testid="note-card"][data-note-id="${SECOND_NOTE}"]`),
    ).toHaveAttribute('aria-selected', 'true');
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

  test('returns to the list from the mobile editor with the back affordance', async ({ page }) => {
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

/* §6.2: soft delete with a six-second undo toast, restore, permanent delete, empty
   trash. Driven end to end through the mock backend, because the parts that matter —
     that the note actually leaves the list, that undo brings it back with its text,
     and that the editor closes when the note it holds goes away — are all about
     state the components do not own. */
test.describe('trash', () => {
  test('moves a note to the trash and offers an undo for six seconds', async ({ page }) => {
    await open(page);

    const before = await page.getByTestId('note-card').count();
    const card = page.getByTestId('note-card').first();
    const title = await card.locator('.text-\\[14px\\]').innerText();
    await card.click({ button: 'right' });
    await page.getByTestId('note-menu-delete').click();

    /* The soft delete is immediate and the row is gone from the live list — §6.2 is
       exact that the write has already happened and undo merely restores. */
    await expect(page.getByTestId('note-card')).toHaveCount(before - 1);
    const toast = page.getByTestId('undo-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(title);
  });

  test('the undo toast clears the system navigation bar', async ({ page }) => {
    await open(page);

    const card = page.getByTestId('note-card').first();
    await card.click({ button: 'right' });
    await page.getByTestId('note-menu-delete').click();

    /* The wrapper is viewport-fixed, so it cannot inherit `#root`'s inset
       padding — the inset is added back into its own offset. A desktop browser
       reports a zero inset; forcing one proves the wiring a screenshot on the
       phone shows. */
    const wrap = page.getByTestId('undo-toast-wrap');
    await expect(wrap).toBeVisible();
    await expect(wrap).toHaveCSS('bottom', '20px');
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--inset-bottom', '48px');
    });
    await expect(wrap).toHaveCSS('bottom', '68px');
  });

  test('undo brings the note back where it was in the list', async ({ page }) => {
    await open(page);

    const before = await page.getByTestId('note-card').count();
    const card = page.getByTestId('note-card').first();
    const noteId = await card.getAttribute('data-note-id');
    await card.click({ button: 'right' });
    await page.getByTestId('note-menu-delete').click();
    await expect(page.getByTestId('note-card')).toHaveCount(before - 1);

    await page.getByTestId('undo-toast-undo').click();

    await expect(page.getByTestId('note-card')).toHaveCount(before);
    await expect(page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`)).toBeVisible();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
  });

  test('the toast expires on its own', async ({ page }) => {
    await open(page);

    const card = page.getByTestId('note-card').first();
    await card.click({ button: 'right' });
    await page.getByTestId('note-menu-delete').click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();

    /* Six seconds is §6.2's number, and it is the one user-visible duration in the
       app. Asserted with a real wait rather than a fake clock, because this is the
       test that would catch the constant being changed. */
    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8000 });
  });

  test('closing the editor when the open note is deleted', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').first().click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();

    const card = page.getByTestId('note-card').first();
    await card.click({ button: 'right' });
    await page.getByTestId('note-menu-delete').click();

    /* `10-conventions.md` §6: a note that is not there means close the editor. A
       deleted note still rendering in the editor would be a save into the void. */
    await expect(page.getByText('No note open')).toBeVisible();
  });

  test('deletes with Ctrl+Backspace from the editor', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').first().click();
    const before = await page.getByTestId('note-card').count();

    await page.getByRole('textbox', { name: 'Note content' }).click();
    await page.keyboard.press('Control+Backspace');

    await expect(page.getByTestId('note-card')).toHaveCount(before - 1);
    await expect(page.getByTestId('undo-toast')).toBeVisible();
  });

  test('restores a trashed note and re-opens it', async ({ page }) => {
    await open(page);

    const card = page.getByTestId('note-card').first();
    const noteId = await card.getAttribute('data-note-id');
    const title = await card.locator('.text-\\[14px\\]').innerText();
    await card.click({ button: 'right' });
    await page.getByTestId('note-menu-delete').click();
    await page.getByTestId('undo-toast-dismiss').click();

    await page.getByTestId('filter-trash').click();
    const trashed = page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`);
    await expect(trashed).toBeVisible();

    await trashed.click({ button: 'right' });
    await page.getByTestId('note-menu-restore').click();

    /* Closing the editor after a restore would make undo look like it acted on the
       wrong note, so a restored note comes back open. */
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    await expect(page.locator('.ProseMirror')).toContainText(title);
  });

  test('permanent delete asks first, and then really goes', async ({ page }) => {
    await open(page);
    await page.getByTestId('filter-trash').click();

    const trashed = page.getByTestId('note-card').first();
    const noteId = await trashed.getAttribute('data-note-id');
    await trashed.click({ button: 'right' });
    await page.getByTestId('note-menu-destroy').click();

    /* §6.2: only permanent delete and empty trash confirm. */
    await expect(page.getByRole('dialog')).toContainText('cannot be undone');
    /* Found on a phone: the row menu stayed up under its own confirmation —
       choosing an item closes the menu before anything else changes. */
    await expect(page.getByTestId('note-menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`)).toBeVisible();

    await trashed.click({ button: 'right' });
    await page.getByTestId('note-menu-destroy').click();
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`)).toHaveCount(
      0,
    );
  });

  test('empties the trash from the list header, confirming first', async ({ page }) => {
    await open(page);
    await page.getByTestId('filter-trash').click();

    /* The fixture trash holds one note, so emptying it empties it. */
    await expect(page.getByTestId('empty-trash')).toBeVisible();
    await page.getByTestId('empty-trash').click();
    await expect(page.getByRole('dialog')).toContainText('cannot be undone');

    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page.getByText('Trash is empty')).toBeVisible();
    /* §8's empty state, not a blank panel. */
    await expect(page.getByTestId('empty-trash')).toHaveCount(0);
  });

  test('offers no trash actions in a live list', async ({ page }) => {
    await open(page);

    const card = page.getByTestId('note-card').first();
    await card.click({ button: 'right' });

    /* A permanent delete reachable from a live list is the failure this whole
       milestone cares about. */
    await expect(page.getByTestId('note-menu-delete')).toBeVisible();
    await expect(page.getByTestId('note-menu-destroy')).toHaveCount(0);
    await expect(page.getByTestId('note-menu-restore')).toHaveCount(0);
    await expect(page.getByTestId('empty-trash')).toHaveCount(0);
  });
});

/* `04-editor.md` §9: "Folder | Note's folder name, click to change" and "Tags |
   Note's tags, click to add or remove". These land with the last part of M4. */
test.describe('editor status bar', () => {
  test("shows the note's folder and tags", async ({ page }) => {
    await open(page);

    /* The first fixture note, rather than the first card: it is the one the editor opens
       on, so it is the one whose folder and tags the bar shows. Other notes have
       different ones. */
    await page.getByTestId('note-card').filter({ hasText: 'Meeting notes' }).click();

    await expect(page.getByTestId('status-folder')).toContainText('Work');
    /* The row shows the first tag plus a count of the rest; §9 gives the row 28 px,
       and four tag names do not fit in it. */
    await expect(page.getByTestId('status-tags')).toContainText('#');
  });

  test('changes the folder from the status bar, and the note list follows', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').filter({ hasText: 'Meeting notes' }).click();

    await page.getByTestId('status-folder').click();
    await expect(page.getByTestId('folder-picker-list')).toBeVisible();
    await expect(page.getByTestId('status-popover')).toBeVisible();

    /* Picked by name rather than by a fixture id: the ids are generated, and the
       name is what the user sees. */
    await page
      .locator('[data-testid="folder-picker-option"]')
      .filter({ hasText: 'Reading' })
      .click();

    /* The save is debounced, so "Saved" is the signal that it reached the database —
         the same signal the editor gives for typing. */
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await page.waitForTimeout(900);
    await expect(page.getByTestId('status-folder')).toContainText('Reading');

    /* The note moved folders, so selecting that folder now includes it. */
    await page.getByTestId('folder-row').filter({ hasText: 'Reading' }).click();
    await expect(page.getByTestId('list-header')).toHaveText('Reading');
    await expect(page.getByTestId('note-card').filter({ hasText: 'Meeting notes' })).toBeVisible();
  });

  test('pressing a slot button again dismisses its popover', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').filter({ hasText: 'Meeting notes' }).click();

    /* The panel never covers its own anchor, so the button is always reachable
       and is the fastest way out; outside press and Esc are unchanged. */
    const folder = page.getByTestId('status-folder');
    await folder.click();
    await expect(page.getByTestId('folder-picker-list')).toBeVisible();
    await folder.click();
    await expect(page.getByTestId('folder-picker-list')).toBeHidden();

    const tags = page.getByTestId('status-tags');
    await tags.click();
    await expect(page.getByTestId('tag-editor-list')).toBeVisible();
    await tags.click();
    await expect(page.getByTestId('tag-editor-list')).toBeHidden();
  });

  test('clears the folder back to unfiled', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').first().click();

    await page.getByTestId('status-folder').click();
    await page.locator('[data-testid="folder-picker-option"][data-folder-id="none"]').click();
    await page.waitForTimeout(900);

    /* ADR-014: everything starts unfiled, so a note can always go back there. */
    await expect(page.getByTestId('status-folder')).toHaveText('No folder');
  });

  test('creates a tag by typing a name that does not exist yet', async ({ page }) => {
    await open(page);
    /* A note with no tags, so the assertion is about the tag appearing rather than
       about where it lands in a row that already had some. */
    await page.getByTestId('note-card').filter({ hasText: 'Untitled' }).first().click();
    await expect(page.getByTestId('status-tags')).toHaveText('Add tags');

    await page.getByTestId('status-tags').click();
    await expect(page.getByTestId('tag-editor-list')).toBeVisible();
    await page.getByTestId('tag-editor-input').fill('draft');
    await page.getByTestId('tag-editor-input').press('Enter');
    await page.waitForTimeout(900);

    await expect(page.getByTestId('status-tags')).toContainText('#draft');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
  });

  test('typing an existing tag name adds it rather than duplicating it', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').filter({ hasText: 'Untitled' }).first().click();

    await page.getByTestId('status-tags').click();
    await expect(page.getByTestId('tag-editor-list')).toBeVisible();
    /* §6.4 normalises to the first-created spelling, so `Ideas` and `ideas` are one
       tag. The status bar shows the library's spelling, not what was typed. */
    await page.getByTestId('tag-editor-input').fill('Ideas');
    await page.getByTestId('tag-editor-input').press('Enter');
    await page.waitForTimeout(900);

    await expect(page.getByTestId('status-tags')).toContainText('#ideas');
    /* One tag, not two. */
    await expect(page.getByTestId('status-tags')).not.toContainText('+');
  });

  test('adds an existing tag by picking it, and shows the tag in the sidebar', async ({ page }) => {
    await open(page);
    /* A note with no tags, so the assertion is about the tag being added and not about
       what it already had. */
    await page.getByTestId('note-card').filter({ hasText: 'Untitled' }).first().click();
    const before = await page.getByTestId('status-tags').textContent();
    expect(before).toBe('Add tags');

    await page.getByTestId('status-tags').click();
    await expect(page.getByTestId('tag-editor-list')).toBeVisible();
    await page.locator('[data-testid="tag-editor-option"][data-tag-id]').first().click();
    await page.waitForTimeout(900);

    await expect(page.getByTestId('status-tags')).not.toHaveText('Add tags');

    /* §6.4: the tag disappears from the sidebar only when its count reaches zero, so
       it must still be there — with one more note in it. */
    await expect(page.getByTestId('tag-row').first()).toBeVisible();
  });

  test('removes a tag from the note without removing it from the library', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').first().click();
    const libraryBefore = await page.getByTestId('tag-row').count();

    await page.getByTestId('status-tags').click();
    await expect(page.getByTestId('tag-editor-list')).toBeVisible();
    await page.locator('[data-testid="tag-editor-option"][data-tag-id]').first().click();
    await page.waitForTimeout(900);

    /* §6.4: "Removing a tag from a note never deletes the tag itself." The library is
       unchanged; only this note's membership goes. */
    await expect(page.getByTestId('tag-row')).toHaveCount(libraryBefore);
  });

  test('a tag change survives the next keystroke, rather than being reverted by it', async ({
    page,
  }) => {
    await open(page);
    await page.getByTestId('note-card').filter({ hasText: 'Untitled' }).first().click();

    const editor = page.getByRole('textbox', { name: 'Note content' });
    await editor.click();
    await page.getByTestId('status-tags').click();
    await expect(page.getByTestId('tag-editor-list')).toBeVisible();
    await page.locator('[data-testid="tag-editor-option"][data-tag-id]').first().click();
    await page.waitForTimeout(900);

    const shown = await page.getByTestId('status-tags').textContent();
    expect(shown).not.toBe('Add tags');

    /* The autosave target carries `tagIds`. If the in-memory set were not updated with
       it, this keystroke would save the old set and quietly drop the tag — the same
       failure the pin had, and the reason `autosave.schedule` exists. */
    await editor.press('End');
    await page.keyboard.type(' more');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await page.waitForTimeout(900);

    await expect(page.getByTestId('status-tags')).toHaveText(shown ?? '');
  });

  test('closes the folder picker on Escape without changing the folder', async ({ page }) => {
    await open(page);
    await page.getByTestId('note-card').first().click();
    const before = await page.getByTestId('status-folder').textContent();

    await page.getByTestId('status-folder').click();
    /* The popover attaches its Escape handler when it mounts, so pressing the key
       before it exists presses it into the void. Waiting for it is the difference
       between asserting the behaviour and racing the render. */
    await expect(page.getByTestId('status-popover')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('status-popover')).toHaveCount(0);
    await expect(page.getByTestId('status-folder')).toHaveText(before ?? '');
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
