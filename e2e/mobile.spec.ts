import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { seedSettings } from './helpers';

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

    await expect(page.getByTestId('editor-pin-toggle')).toHaveCount(0);
    await expect(page.getByTestId('status-folder')).toBeVisible();
    await expect(page.getByTestId('status-tags')).toBeVisible();
    await expect(page.getByTestId('save-state')).toBeVisible();
  });

  test('puts the back control at the left edge and the menu at the right', async ({ page }) => {
    await openEditor(page);

    const back = await page.getByRole('button', { name: 'Back to list' }).boundingBox();
    const menu = await page.getByRole('button', { name: 'More' }).boundingBox();
    expect(back).not.toBeNull();
    expect(menu).not.toBeNull();
    if (back === null || menu === null) return;

    expect(back.x).toBeLessThan(24);
    expect(menu.x + menu.width).toBeGreaterThan(MOBILE.width - 24);
    expect(menu.x).toBeGreaterThan(back.x + back.width);
  });

  test('the app is placed against the visible area, so the page cannot scroll', async ({
    page,
  }) => {
    await openEditor(page);

    const placement = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (root === null) throw new Error('no root');
      const style = getComputedStyle(root);
      const scroller = document.scrollingElement;
      return {
        position: style.position,
        top: style.top,
        height: style.height,
        innerHeight: window.innerHeight,
        viewportHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
        scrollable: scroller !== null && scroller.scrollHeight > scroller.clientHeight + 1,
      };
    });

    expect(placement.position).toBe('fixed');
    expect(placement.top).toBe('0px');
    expect(placement.viewportHeight).toBe(placement.innerHeight);
    expect(placement.height).toBe(`${placement.viewportHeight}px`);
    expect(placement.scrollable).toBe(false);
  });

  test('the tag editor opens centred, not hugging the screen edge', async ({ page }) => {
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

    for (const id of ['status-folder', 'status-tags', 'word-count', 'save-state']) {
      const line = page.getByTestId(id).locator('span').last();
      const box = (await line.count()) > 0 ? await line.boundingBox() : null;
      const outer = box ?? (await page.getByTestId(id).boundingBox());
      expect(outer, `${id} has no box`).not.toBeNull();
      if (outer === null) continue;
      expect(outer.height, `${id} wrapped`).toBeLessThanOrEqual(20);
    }
  });

  test('the slots are 44 px touch targets, per §9 on Android', async ({ page }) => {
    await openEditor(page);

    for (const id of ['status-folder', 'status-tags']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} has no box`).not.toBeNull();
      if (box === null) continue;
      expect(box.height, `${id} is not 44 px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the overflow menu offers pin and trash, and the pin actually flips', async ({ page }) => {
    await openEditor(page);

    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByTestId('editor-overflow-pin')).toBeVisible();
    await expect(page.getByTestId('editor-overflow-trash')).toBeVisible();

    const before = await page.getByTestId('editor-overflow-pin').getAttribute('aria-pressed');
    await page.getByTestId('editor-overflow-pin').click();
    await expect(page.getByTestId('editor-overflow')).toHaveCount(0);

    await page.getByRole('button', { name: 'More' }).click();
    const after = await page.getByTestId('editor-overflow-pin').getAttribute('aria-pressed');
    expect(after).not.toBe(before);
    await expect(page.getByTestId('editor-overflow-pin')).toHaveText(
      after === 'true' ? 'Unpin note' : 'Pin note',
    );
  });

  test('deleting the open note returns to the list, not the desktop empty state', async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('editor-overflow-trash').click();

    await expect(page.getByTestId('note-list')).toBeVisible();
    await expect(page.getByText('No note open')).toHaveCount(0);
  });

  test('leaving the editor clears the open marker — the list shows no selection', async ({
    page,
  }) => {
    await openEditor(page);
    await expect(page.getByTestId('note-card')).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to list' }).click();

    await expect(page.getByTestId('note-list')).toBeVisible();
    await expect(page.locator('[data-testid="note-card"][aria-selected="true"]')).toHaveCount(0);
  });

  test('a pin made in the editor reaches the Pinned filter', async ({ page }) => {
    await openEditor(page);

    await page.getByRole('button', { name: 'More' }).click();
    const before = await page.getByTestId('editor-overflow-pin').getAttribute('aria-pressed');
    await page.getByTestId('editor-overflow-pin').click();

    await page.getByRole('button', { name: 'Back to list' }).click();
    await page.getByRole('tab', { name: /pinned/i }).click();

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
    expect(idsAfter.indexOf(editedId)).toBeLessThan(idsBefore.indexOf(editedId));
    await expect(
      page.locator(`[data-testid="note-card"][data-note-id="${editedId}"]`),
    ).toBeVisible();
  });

  test('the sidebar fills the viewport with no dead strip at the edge', async ({ page }) => {
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
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-breakpoint', 'tablet');
  });
});

test.describe('mobile touch', { tag: '@touch' }, () => {
  test.use({
    viewport: MOBILE,
    userAgent: ANDROID_UA,
    hasTouch: true,
    isMobile: true,
  });

  async function holdRow(target: Locator): Promise<void> {
    await target.evaluate((row) => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
  }

  test('a trashed note restores from the row menu after the toast is gone', async ({ page }) => {
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    const card = page.getByTestId('note-card').first();
    const noteId = await card.getAttribute('data-note-id');
    await holdRow(card);
    await page.getByTestId('note-menu-delete').click();
    await page.getByTestId('undo-toast-dismiss').click();

    await page.getByTestId('filter-trash').click();
    const trashed = page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`);
    await expect(trashed).toBeVisible();
    await holdRow(trashed);

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
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    await expect(page.getByTestId('note-list')).toBeVisible();

    const noteId = await page.getByTestId('note-card').first().getAttribute('data-note-id');
    const row = (): ReturnType<typeof page.locator> =>
      page.locator(`[data-testid="note-card"][data-note-id="${noteId}"]`);
    const menuLabel = async (): Promise<string> => {
      await holdRow(row());
      const label = (await page.getByTestId('note-menu-pin').textContent()) ?? '';
      await page.keyboard.press('Escape');
      return label;
    };

    const first = await menuLabel();
    expect(first).toMatch(/Pin note|Unpin note/);

    await holdRow(row());
    await page.getByTestId('note-menu-pin').click();
    await expect(page.getByTestId('note-menu')).toHaveCount(0);

    expect(await menuLabel()).not.toBe(first);
  });

  test('tapping empty editor space puts the caret at the end', async ({ page }) => {
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

    await blur();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 100);
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeFocused();
    expect(await caret()).toEqual({ collapsed: true, inside: true });

    await blur();
    await page.touchscreen.tap(box.x - 10, box.y + box.height / 2);
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeFocused();
    expect(await caret()).toEqual({ collapsed: true, inside: true });
  });

  test('the folder menu opens fully inside the viewport', async ({ page }) => {
    await seedSettings(page, { theme: 'dark', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    const row = page.getByTestId('folder-row').filter({ hasText: 'Work' });
    await expect(row).toBeVisible();
    await holdRow(row);

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

test.describe('mobile scroll shape', () => {
  test('the title is part of the scrolling text, not a fixture above it', async ({ page }) => {
    await openEditor(page);

    const nesting = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="note-header"]');
      const scroller = document.querySelector('.editor-scroll');
      return header !== null && scroller !== null && scroller.contains(header);
    });
    expect(nesting, 'note-header is inside the scroll container').toBe(true);

    await page.setViewportSize({ width: MOBILE.width, height: 200 });
    const moved = await page.evaluate(() => {
      const scroller = document.querySelector('.editor-scroll');
      const header = document.querySelector('[data-testid="note-header"]');
      if (!(scroller instanceof HTMLElement) || header === null) return null;
      const before = header.getBoundingClientRect().y;
      scroller.scrollTop = scroller.scrollHeight;
      return { before, after: header.getBoundingClientRect().y, scrollTop: scroller.scrollTop };
    });
    expect(moved, 'header and scroller found').not.toBeNull();
    if (moved === null) return;
    expect(moved.scrollTop, 'the note scrolls at all').toBeGreaterThan(0);
    expect(moved.before - moved.after, 'the title moved up with the text').toBeGreaterThan(20);
  });

  test('the status row is pinned to the layout viewport, so the keyboard covers it', async ({
    page,
  }) => {
    await openEditor(page);

    const bar = page.getByTestId('editor-status-bar');
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    expect(await bar.evaluate((el) => getComputedStyle(el).bottom)).not.toBe('auto');

    await page.setViewportSize({ width: 1280, height: 820 });
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('static');
  });

  test('scrolling ends at the container instead of chaining to the page', async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null, lastSelection: { kind: 'all' } });
    await page.goto('/');
    const list = await page
      .getByTestId('note-list')
      .evaluate((el) => getComputedStyle(el).overscrollBehaviorY);
    expect(list, 'note list').toBe('contain');

    await openEditor(page);
    const editor = await page
      .locator('.editor-scroll')
      .evaluate((el) => getComputedStyle(el).overscrollBehaviorY);
    expect(editor, 'editor scroller').toBe('contain');
  });
});
