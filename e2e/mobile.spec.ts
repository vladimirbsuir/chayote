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

  test('the tag editor opens centred, not hugging the screen edge', async ({ page }) => {
    /* Found on a phone: the tag popover parked at the right edge with a sliver
       of margin. Anchor-relative placement of a 260 px panel has nothing worth
       following at 360 px, so the panel is centred there
       (`popoverPlacement.test.ts` pins the geometry across viewports). */
    await openEditor(page);

    await page.getByTestId('status-tags').click();
    await expect(page.getByTestId('status-popover')).toBeVisible();

    const box = await page.getByTestId('status-popover').boundingBox();
    expect(box, 'tag editor has no box').not.toBeNull();
    if (box === null) return;
    expect(box.x, 'tag editor is not centred').toBe((MOBILE.width - 260) / 2);
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

  test('the overflow menu offers pin and trash, and the pin actually flips', async ({ page }) => {
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

  test('deleting the open note returns to the list, not the desktop empty state', async ({
    page,
  }) => {
    /* Found on a phone: deleting the open note closed it but left the editor
       view on the stack, so the phone showed the desktop "No note open …
       Ctrl+N" pane instead of the list. The pop lives next to the editor
       close in `onOpenNoteGone`, so this pins the visible view, not the
       stack value. */
    await openEditor(page);

    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('editor-overflow-trash').click();

    await expect(page.getByTestId('note-list')).toBeVisible();
    await expect(page.getByText('No note open')).toHaveCount(0);
  });

  test('leaving the editor clears the open marker — the list shows no selection', async ({
    page,
  }) => {
    /* Found on a phone: backing out of a note left its row highlighted, which on
       desktop is the open marker beside a visible editor but on a phone — where
       the editor is gone — reads as a stuck selection. Leaving closes the note
       with the view, through the same funnel for the bar back affordance and the
       system back button. */
    await openEditor(page);
    await expect(page.getByTestId('note-card')).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to list' }).click();

    await expect(page.getByTestId('note-list')).toBeVisible();
    await expect(page.locator('[data-testid="note-card"][aria-selected="true"]')).toHaveCount(0);
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
  test('the bar gear opens Settings — the hamburger it replaced was dead', async ({ page }) => {
    /* The list bar's left slot was a `menu` "Open sidebar" button wired to a
       no-op since M3: the sidebar content *is* the list view, so nothing opened,
       and mobile had no path to Settings at all. The slot is a gear opening the
       dialog directly — asserted here so a future edit cannot silently re-dead
       it, since a dead icon button passes every assertion except one that
       presses it. */
    await page.setViewportSize(MOBILE);
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Open sidebar' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();

    await page.getByTestId('settings-done').click();
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
  });

  test('typing a title then going back returns to the list, unfrozen', async ({ page }) => {
    /* Found on a phone: create a note, immediately type a title, press the back
       arrow — the app froze and answered nothing. The tap blurs the editor
       (flush one starts the save) and the unmount flushes again while it is
       still running; the old flush spun on the in-flight flag and starved the
       save's own response. In a browser the mock resolves in a microtask so the
       spin terminates — this pins the flow, and `useAutosave.test.ts` pins the
       deadlock itself. */
    await page.setViewportSize(MOBILE);
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    await page.getByRole('button', { name: 'New note' }).click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Note content' })
      .pressSequentially('A brand new title');
    await page.getByRole('button', { name: 'Back to list' }).click();

    await expect(page.getByTestId('note-list')).toBeVisible();
    await expect(page.getByText('No note open')).toHaveCount(0);
    await expect(
      page.getByTestId('note-card').filter({ hasText: 'A brand new title' }),
    ).toHaveCount(1);
  });

  test('the focused search field draws its ring above the sidebar', async ({ page }) => {
    /* Found on a phone: the focus ring's bottom edge was sliced off where the
       sidebar begins. The ring is drawn 2 px outside the container, straight
       onto the sidebar below — which paints later and covers it. The container
       lifts above the sidebar while focused; this pins the mechanism, and the
       device screenshot pins the pixels. */
    await page.setViewportSize(MOBILE);
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search notes' }).click();

    const zIndex = await page
      .getByRole('searchbox', { name: 'Search notes' })
      .evaluate((input) => getComputedStyle(input.parentElement as HTMLElement).zIndex);
    expect(zIndex).toBe('10');
  });

  test('editing a note moves it to the top of the list', async ({ page }) => {
    /* Found on a phone: edit a note, go back, and it sits wherever it was.
       Saves patch the cached lists in place without refetching, and the patch
       kept the old order although `updated_at` — the ordering — just moved.
       The patch re-sorts every live selection now; trash keeps deletion order
       and search keeps relevance (`noteOrder.test.ts` pins both). */
    await page.setViewportSize(MOBILE);
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    const cards = page.getByTestId('note-card');
    await expect(cards.first()).toBeVisible();
    const idsBefore = await cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-note-id')),
    );
    const editedId = idsBefore[idsBefore.length - 1] ?? '';

    await cards.last().click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Note content' }).pressSequentially('edited');
    await page.getByRole('button', { name: 'Back to list' }).click();

    await expect(page.getByTestId('note-list')).toBeVisible();
    const idsAfter = await cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-note-id')),
    );
    /* It moved up — and past every unpinned note, stopping only below the
       pinned group, which outranks any timestamp. (A pinned card carries its
       `pin-toggle`; the plain `pin-indicator` exists only in the trash, where
       the pin is not actionable.) */
    expect(idsAfter.indexOf(editedId)).toBeLessThan(idsBefore.indexOf(editedId));
    await expect(
      page.locator(`[data-testid="note-card"][data-note-id="${editedId}"]`),
    ).toBeVisible();
  });

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

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; X6836 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.57 Mobile Safari/537.36';
const LANDSCAPE = { width: 800, height: 360 };

test.describe('mobile landscape', () => {
  test.use({ viewport: LANDSCAPE, userAgent: ANDROID_UA });

  /* Found on a phone: rotating on the list widened the viewport past 768 px,
     flipped the breakpoint to the tablet band — which always renders the
     editor — and landed the user in the last-opened note with desktop chrome.
     The navigation model is a device property, so on Android the answer stays
     the single-pane stack in both orientations. */

  test('rotation keeps the list instead of jumping into a note', async ({ page }) => {
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-breakpoint', 'mobile');
    const box = await page.getByTestId('sidebar').boundingBox();
    expect(box?.width, 'sidebar does not fill the landscape viewport').toBe(LANDSCAPE.width);
  });

  test('rotation keeps the open note rather than choosing one', async ({ page }) => {
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();
    await page.getByTestId('note-card').first().click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();

    await page.setViewportSize(LANDSCAPE);
    await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    await expect(page.getByTestId('note-list')).toHaveCount(0);

    await page.setViewportSize(MOBILE);
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
  });
});

test.describe('narrow desktop window', () => {
  test.use({ viewport: LANDSCAPE });

  test('the width bands still govern non-Android viewports', async ({ page }) => {
    /* The Android carve-out changes nothing on desktop: an 800 px window keeps
       the tablet drawer, whatever the height. */
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-breakpoint', 'tablet');
  });
});

/* Tagged `@touch`: emulated-touch timing breaks under a loaded shared runner,
   so CI runs this block alone on one worker rather than in the sharded gate. */
test.describe('mobile touch', { tag: '@touch' }, () => {
  test.use({
    viewport: MOBILE,
    userAgent: ANDROID_UA,
    hasTouch: true,
    isMobile: true,
  });

  test('a trashed note restores from the row menu after the toast is gone', async ({ page }) => {
    /* The gap this file keeps finding: on touch the note rows had no menu at
       all — the button is `pointer:fine`-only and a hold selected text — so
       once the undo toast expired a trashed note was stuck. The row answers
       `contextmenu` like the folder rows, which is what a hold fires on the
       device (proven with `input swipe x y x y 900`); the right-click here
       reaches the same `openMenu` measurement. The toast is dismissed first so
       this pins the stuck state, not the undo path. */
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    const card = page.getByTestId('note-card').first();
    const noteId = await card.getAttribute('data-note-id');
    await card.click({ button: 'right' });
    await page.getByTestId('note-menu-delete').click();
    await page.getByTestId('undo-toast-dismiss').click();

    await page.getByTestId('filter-trash').click();
    const trashed = page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`);
    await expect(trashed).toBeVisible();
    await trashed.click({ button: 'right' });

    const menu = page.getByTestId('note-menu');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox, 'note menu has no box').not.toBeNull();
    if (menuBox === null) return;
    expect(menuBox.x, 'menu starts off-screen').toBeGreaterThanOrEqual(0);
    expect(menuBox.y, 'menu starts off-screen').toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width, 'menu overflows the viewport').toBeLessThanOrEqual(
      MOBILE.width,
    );
    expect(menuBox.y + menuBox.height, 'menu overflows the viewport').toBeLessThanOrEqual(
      MOBILE.height,
    );

    await page.getByTestId('note-menu-restore').click();
    await page.getByTestId('filter-all').click();
    await expect(page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`)).toBeVisible();
  });

  test('only one row menu is open at a time', async ({ page }) => {
    /* Found on a phone: long-pressing a second row left the first menu up, so
       two portalled menus overlapped. The state lives in the list — opening for
       another row replaces. Dispatched, not right-clicked: a right-click sends
       a `mousedown` first and the old menu closes on that, which is exactly what
       a touch hold does not do — and what hid this on desktop. */
    const hold = (index: number): Promise<void> =>
      page
        .getByTestId('note-card')
        .nth(index)
        .evaluate((row) => {
          row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        });
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    await hold(0);
    await expect(page.getByTestId('note-menu')).toBeVisible();
    await hold(1);

    await expect(page.getByTestId('note-menu')).toHaveCount(1);
  });

  test('the row menu pins and unpins, the touch path to the pin', async ({ page }) => {
    /* On touch there is no hover, so the row menu is the only path to the pin
       outside the editor. Right-click reaches the same `openMenu` a hold does.
       Proven by the label flipping: the menu re-reads the note, so the opposite
       verb means the write landed and the list refreshed. */
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    const noteId = await page.getByTestId('note-card').first().getAttribute('data-note-id');
    const row = (): ReturnType<typeof page.locator> =>
      page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`);
    const menuLabel = async (): Promise<string> => {
      await row().click({ button: 'right' });
      const label = (await page.getByTestId('note-menu-pin').textContent()) ?? '';
      await page.keyboard.press('Escape');
      return label;
    };

    const first = await menuLabel();
    expect(first).toMatch(/Pin note|Unpin note/);

    await row().click({ button: 'right' });
    await page.getByTestId('note-menu-pin').click();
    await expect(page.getByTestId('note-menu')).toHaveCount(0);

    expect(await menuLabel()).not.toBe(first);
  });

  test('tapping empty editor space puts the caret at the end', async ({ page }) => {
    /* Found on a phone: tapping the empty area under a short note did nothing —
       no caret, no keyboard — while tapping text worked. The editable element
       was only as tall as its content, so the tap landed outside it. It now
       fills the pane (taps below the text resolve natively), and taps in the
       wrapper's own padding fall back to the document end. `touchscreen` drives
       this because only a touch tap synthesises the path a finger takes. */
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();
    await page.getByTestId('note-card').first().click();
    const box = await page.getByRole('textbox', { name: 'Note content' }).boundingBox();
    expect(box, 'editor has no box').not.toBeNull();
    if (box === null) return;

    const caret = async (): Promise<{ collapsed: boolean; inside: boolean }> =>
      page.evaluate(() => {
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        return {
          collapsed: selection?.isCollapsed ?? false,
          inside:
            anchor instanceof Node &&
            document.querySelector('.ProseMirror')?.contains(anchor) === true,
        };
      });
    const blur = async (): Promise<void> => {
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
    };

    /* Below the text, inside the editable element's empty floor. */
    await blur();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 100);
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeFocused();
    expect(await caret()).toEqual({ collapsed: true, inside: true });

    /* The wrapper's own left padding, outside the editable element entirely. */
    await blur();
    await page.touchscreen.tap(box.x - 20, box.y + box.height / 2);
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeFocused();
    expect(await caret()).toEqual({ collapsed: true, inside: true });
  });

  test('the folder menu opens fully inside the viewport', async ({ page }) => {
    /* The defect this file keeps finding: the in-row menu arrived clipped to a
       sliver by the tree's scroll container, and only a phone showed it. The
       long-press gesture itself is proven on hardware (`input swipe x y x y
       900` opens it); what this pins is the portal contract at a phone
       viewport — the whole panel, Rename through Delete, inside the screen —
       through the right-click, which reaches the same `openMenu` measurement. */
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    const row = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });

    const menu = page.getByTestId('folder-menu');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox, 'folder menu has no box').not.toBeNull();
    if (menuBox === null) return;
    expect(menuBox.x, 'menu starts off-screen').toBeGreaterThanOrEqual(0);
    expect(menuBox.y, 'menu starts off-screen').toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width, 'menu overflows the viewport').toBeLessThanOrEqual(
      MOBILE.width,
    );
    expect(menuBox.y + menuBox.height, 'menu overflows the viewport').toBeLessThanOrEqual(
      MOBILE.height,
    );
  });
});
