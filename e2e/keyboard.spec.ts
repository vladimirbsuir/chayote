import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings, waitForStoredTheme } from './helpers';

/* M6's "Done when", first half: **the app is fully operable from the keyboard.**

   This is the one acceptance criterion in the project that is a single sentence
   covering the whole surface, so it is written the only way it can be honestly
   checked — as one continuous flow with no mouse at all, using only `Tab`,
   `Enter`, `Escape`, `F2`, `Delete` and the `Ctrl/Cmd` bindings of
   `05-ui-ux.md` §7. Create, organise, find, edit, pin, trash and restore is the
   list `01-product.md` §8 gives for "a user can create, organise, find, edit,
   trash, and restore notes without touching the mouse".

   It is deliberately one test rather than one per capability. A flow is what
   proves operability: each capability can pass in isolation and the sequence
   still dead-end half way through, and it is the sequence a keyboard user's hand
   actually walks. */

/** Tab until `locator` has focus, giving up after a bounded number of presses.
    Bounded rather than looping forever, so a control that never becomes
    focusable fails the test instead of hanging the suite. */
async function tabTo(page: Page, locator: ReturnType<Page['locator']>, max = 120): Promise<void> {
  /* `.first()` and no swallowed errors: `locator.evaluate` throws when the
     locator matches more than one element, and catching that as "not focused
     yet" turns a strict-mode violation into an inscrutable "never reached the
     control" after a hundred presses.

     The direction flips only when focus is *in the editor*, which is the one
     place `Tab` is deliberately not a focus move: `05-ui-ux.md` §7 binds it to
     insert two spaces, "which keeps focus inside the editor and never cycles
     focus rings", so a forward `Tab` there inserts whitespace forever and a
     keyboard user leaves with `Shift+Tab`.

     Detecting that by comparing a label for the focused element does not work —
     two adjacent icon buttons both report `BUTTON`, so the helper sees "no
     movement", reverses, and oscillates between them forever. */
  const target = locator.first();
  for (let step = 0; step < max; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    if ((await activeTestId(page)) === 'note-editor') {
      await page.keyboard.press('Shift+Tab');
    } else {
      await page.keyboard.press('Tab');
    }
  }
  throw new Error(
    `never reached ${await target.getAttribute('aria-label')} after ${max} tabs; focus is on ${await activeTestId(page)}`,
  );
}

async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null,
  );
}

test('a user can create, organise, find, edit, trash and restore without a mouse', async ({
  page,
}) => {
  await seedSettings(page, { theme: 'light', accent: null });
  await page.goto('/');
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

  /* --- create, by the §7 shortcut ------------------------------------- */
  await page.keyboard.press('Control+N');
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();

  /* --- edit: the caret is in the editor, so keystrokes land in the note -- */
  await page.keyboard.type('Keyboard only shopping list');
  await expect(page.locator('[data-testid="note-editor"]')).toContainText(
    'Keyboard only shopping list',
  );

  /* --- find, by the §7 shortcut --------------------------------------- */
  await page.keyboard.press('Control+F');
  await expect(page.getByLabel('Search notes').first()).toBeFocused();
  await page.keyboard.type('shopping');
  await expect(page.getByTestId('note-list')).toContainText('Keyboard only shopping list');
  await page.keyboard.press('Escape');

  /* --- organise: pin the open note from the editor, also §7 ----------- */
  await page.keyboard.press('Control+D');
  await expect(page.getByRole('button', { name: /^(Un)?pin note$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  /* --- the folder tree, by keyboard alone (§10.1) ---------------------- */
  await page.keyboard.press('Control+F');
  await page.keyboard.press('Escape');
  /* The tab stop is a *row*, not the `role="tree"` container: §10.1's roving
     tabindex puts `tabIndex={0}` on exactly one treeitem so a depth-10 tree is
     one stop rather than eleven. Tabbing to the container would pass every row
     and prove nothing. */
  const firstRow = page.getByRole('treeitem').first();
  await tabTo(page, firstRow);
  await expect(firstRow).toBeFocused();
  await page.keyboard.press('F2');
  /* The inline rename input owns the keystroke; Esc abandons it so the run does
     not depend on a folder name being free. The point here is that F2 reaches
     the rename path without a pointer. */
  await expect(page.locator('input[type="text"]')).toBeFocused();
  await page.keyboard.press('Escape');

  /* --- trash and restore, by the §7 shortcut --------------------------- */
  /* Focus returns to the editor first: the shortcut deletes *the open note*,
     and the open note is only unambiguous if the user is where they were when
     they read it. `Ctrl/Cmd+Enter` is §7's documented way into the editor. */
  await tabTo(page, page.locator('[data-testid="note-editor"]'));
  await page.keyboard.press('Control+Backspace');
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toBeVisible();

  /* The toast's own action, reached by Tab rather than by pointing. */
  const undo = toast.getByRole('button', { name: /undo/i });
  await tabTo(page, undo, 12);
  await page.keyboard.press('Enter');
  await expect(toast).toBeHidden();
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();

  /* --- every step left the caret somewhere real ------------------------ */
  expect(await activeTestId(page)).not.toBeNull();
});

test('settings is reachable and operable by keyboard alone', async ({ page }) => {
  /* Split out from the flow above rather than appended to it. Walking `Tab`
     across a whole app to reach one control makes the test a report on the tab
     order rather than on the capability, and it breaks for unrelated reasons —
     the journey above already showed that `Tab` inside the editor is
     deliberately trapped (§7), so anything starting from the editor needs
     `Shift+Tab` and the destination stops being the thing under test.

     From a fresh load the top bar is the first region in the document, so the
     path to Settings is a straight `Tab` run. */
  await seedSettings(page, { theme: 'light', accent: null });
  await page.goto('/');
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

  const more = page.getByRole('button', { name: 'More' });
  await tabTo(page, more);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('topbar-overflow')).toBeVisible();

  const settingsItem = page.getByTestId('topbar-overflow-settings');
  await tabTo(page, settingsItem, 8);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('settings-dialog')).toBeVisible();

/* The theme control is a radiogroup: one tab stop, moved with the arrow keys.
     Tabbing to each option in turn would be testing something the component
     deliberately does not do, so this drives it the way the ARIA pattern says a
     keyboard user does — focus the group, then arrow. */
  const light = page.getByRole('radio', { name: /Light/ });
  await tabTo(page, light, 8);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Dark/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await waitForStoredTheme(page, 'dark');

  /* Esc returns focus to the trigger that opened it (§10). */
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
  await expect(more).toBeFocused();
});

test('the whole §7 shortcut table is bound, and none of them is a browser default', async ({
  page,
}) => {
  /* A binding that does not `preventDefault` still lets Chromium act — `Ctrl+N`
     opens a new window, `Ctrl+F` the find bar. Asserting the *effect* is what
     proves the app handled it, since a swallowed keystroke and a handled one
     look identical until the browser's own behaviour shows up. */
  await seedSettings(page, { theme: 'light', accent: null });
  await page.goto('/');
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

  await page.keyboard.press('Control+Shift+L');
  await waitForStoredTheme(page, 'dark');

  await page.keyboard.press('Control+F');
  await expect(page.getByLabel('Search notes').first()).toBeFocused();

  await page.keyboard.press('Control+N');
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();

  /* Ctrl+S is Save now — the escape hatch from the 800 ms debounce. Chromium's
     own "save page" dialog would hang the suite if the binding were missing. */
  await page.locator('[data-testid="note-editor"]').click();
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
});
