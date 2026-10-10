import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSettings } from './helpers';

/* The last two bindings of `05-ui-ux.md` §7, and the two that could not be
   checked by a per-component unit test because both are about the relationship
   between two surfaces: the caret crossing from the list into the editor, and
   `Esc` closing the drawer only when nothing is stacked above it. */

const SHELL = '[data-testid="app-shell"]';

async function firstCard(page: Page): Promise<void> {
  await page.locator('[data-testid="note-list"] [role="option"]').first().click();
  await expect(page.locator('[data-testid="note-editor"]')).toBeVisible();
}

test.describe('the remaining §7 shortcuts', () => {
  test('Ctrl+Enter moves focus from the list into the editor', async ({ page }) => {
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toBeVisible();
    await firstCard(page);

    /* Focus is deliberately moved out of the editor first, so the assertion is
       about the shortcut doing the moving rather than about autofocus having
       left it there. The search field rather than a note row: rows are
       `role="option"` divs without a tabindex, so `.focus()` on one is a no-op
       and the editor would still hold focus when the key is pressed. */
    await page.getByLabel('Search notes').first().focus();
    await expect(page.locator('[data-testid="note-editor"]')).not.toBeFocused();

    await page.keyboard.press('Control+Enter');
    await expect(page.locator('[data-testid="note-editor"]')).toBeFocused();
  });

  test('Ctrl+Enter in the editor still toggles a task item', async ({ page }) => {
    /* The same key is §7's "move focus" from the list and its "toggle task"
       inside the editor. Without the target check the first would fire on the
       second and focus would jump while the user was typing. */
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toBeVisible();
    await firstCard(page);

    await page.locator('[data-testid="note-editor"]').click();
    await page.keyboard.type('- [ ] write the thing');
    /* The seeded note already contains list items, so the one this test just
       typed is the last. Addressing "the task item" would match five. */
    const item = page.locator('[data-testid="note-editor"] li').last();
    await expect(item).toHaveAttribute('data-checked', 'false');

    await item.click();
    /* A frame, per the driver note in `10-conventions.md` §10: a click returns
       to the driver before ProseMirror has processed it, and the shortcut would
       then be evaluated against the previous selection. */
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );

    await page.keyboard.press('Control+Enter');
    await expect(item).toHaveAttribute('data-checked', 'true');
    /* Still in the editor, and still focused. */
    await expect(page.locator('[data-testid="note-editor"]')).toBeFocused();
  });

  test('Escape closes the tablet drawer', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 });
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toHaveAttribute('data-breakpoint', 'tablet');

    const drawer = page.getByTestId('sidebar-drawer');
    await expect(drawer).toHaveAttribute('data-open', 'false');

    await page.keyboard.press('Control+\\');
    await expect(drawer).toHaveAttribute('data-open', 'true');

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('data-open', 'false');
  });

  test('Escape closes the dialog and not the drawer underneath it', async ({ page }) => {
    /* `Esc` is the cheapest way out of every surface in the app, and they nest.
       One key must close exactly one thing, or a user pressing it once to close
       a dialog finds the sidebar has gone too. */
    await page.setViewportSize({ width: 900, height: 820 });
    await seedSettings(page, { theme: 'light', accent: null });
    await page.goto('/');
    await expect(page.locator(SHELL)).toHaveAttribute('data-breakpoint', 'tablet');

    const drawer = page.getByTestId('sidebar-drawer');
    await page.keyboard.press('Control+\\');
    await expect(drawer).toHaveAttribute('data-open', 'true');

    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeHidden();
    await expect(drawer).toHaveAttribute('data-open', 'true');
  });
});