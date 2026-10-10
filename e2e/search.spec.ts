import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/* `05-ui-ux.md` §6.5 and §8, driven through the browser against the mock backend.

   This is the layer ADR-018 exists for: everything here is a claim about search
   that a human would otherwise have to open the packaged app to check. The
   backend answers with real `<mark>` snippets (`src/mock/search.ts`), so the
   highlighting asserted below is the highlighting the real FTS5 snippet would
   produce rather than a stub that happens to have the right shape. */

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

async function open(page: Page): Promise<void> {
  await page.addInitScript((id: string) => {
    if (window.localStorage.getItem('settings.json') !== null) return;
    window.localStorage.setItem(
      'settings.json',
      JSON.stringify({ theme: 'light', lastNoteId: id, lastSelection: { kind: 'all' } }),
    );
  }, RICH_NOTE);
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

function field(page: Page) {
  return page.getByRole('searchbox', { name: 'Search notes' });
}

/** Types a query and waits for the results to arrive.

    The wait is on the header rather than on a timer: `01-product.md` §8 forbids a
    visible loading state, so there is no spinner to wait for and nothing but the
    result itself says the query has landed. The debounce itself is pinned in
    `useSearch.test.tsx`, where the clock is under the test's control. */
async function search(page: Page, query: string): Promise<void> {
  await field(page).fill(query);
  await expect(page.getByTestId('list-header')).toContainText('Results for');
}

test.describe('search', () => {
  test('replaces the note list with results and marks the match', async ({ page }) => {
    await open(page);
    const before = await page.getByTestId('note-card').count();
    expect(before).toBeGreaterThan(0);

    await search(page, 'roadmap');

    await expect(page.getByTestId('list-header')).toHaveText('Results for “roadmap”');
    await expect(page.locator('[data-testid="note-snippet"] mark').first()).toBeVisible();

    /* The structure stays (§6.5: "the sidebar structure stays visible so the
       search can be scoped"), so the region above the list is untouched. */
    await expect(page.getByRole('tree', { name: /folder/i })).toBeVisible();
  });

  test('does not search below two characters', async ({ page }) => {
    await open(page);
    await field(page).fill('r');

    await expect(page.getByTestId('list-header')).toHaveText('All notes');
    await expect(page.getByTestId('note-card').first()).toBeVisible();
  });

  test('clears on Escape and restores the previous list', async ({ page }) => {
    await open(page);
    await search(page, 'roadmap');
    await expect(page.getByTestId('list-header')).toHaveText('Results for “roadmap”');

    await field(page).press('Escape');

    await expect(field(page)).toHaveValue('');
    await expect(page.getByTestId('list-header')).toHaveText('All notes');
    await expect(page.getByTestId('note-card').first()).toBeVisible();
  });

  test('names the query that found nothing, and offers a way out', async ({ page }) => {
    await open(page);
    await search(page, 'kumquat');

    await expect(page.getByText('No results for “kumquat”')).toBeVisible();

    /* Scoped to the sidebar: the field's own `x` carries the same accessible
       name, and two controls doing the same thing is right — one is a pixel and
       the other is an answer to "why is the list empty". */
    const clear = page.getByTestId('sidebar').getByRole('button', { name: 'Clear search' });
    await expect(clear).toBeVisible();

    await clear.click();
    await expect(page.getByTestId('list-header')).toHaveText('All notes');
  });

  test('announces the result count politely', async ({ page }) => {
    await open(page);
    const count = page.getByTestId('list-count');

    await expect(count).toHaveAttribute('aria-live', 'polite');
    await search(page, 'roadmap');
    await expect(count).toContainText('result');
  });

  test('narrows within the selected folder rather than replacing the scope', async ({ page }) => {
    await open(page);
    await search(page, 'the');
    const unscoped = await page.getByTestId('list-count').textContent();

    await page.getByTestId('folder-row').filter({ hasText: 'Work' }).first().click();
    await expect(page.getByTestId('list-header')).toHaveText(/^Results for “the”$/);

    const scoped = await page.getByTestId('list-count').textContent();
    expect(scoped).not.toBe(unscoped);
  });

  test('opens a result and leaves the field alone', async ({ page }) => {
    await open(page);
    await search(page, 'roadmap');

    await page.getByTestId('note-card').first().click();

    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    /* §6.5: a search scopes the list, it does not navigate away from it. */
    await expect(page.getByTestId('list-header')).toHaveText('Results for “roadmap”');
  });

  test('searches the trash as well, since it is a selection like any other', async ({ page }) => {
    await open(page);
    await page.getByTestId('filter-trash').click();
    await expect(page.getByTestId('list-header')).toHaveText('Trash');

    await search(page, 'brainstorm');
    await expect(page.getByTestId('list-header')).toHaveText('Results for “brainstorm”');
    await expect(page.getByTestId('note-card').first()).toBeVisible();
  });

  test('finds nothing for a token that only appears inside another word', async ({ page }) => {
    await open(page);
    await search(page, 'aunch');

    await expect(page.getByText('No results for “aunch”')).toBeVisible();
  });

  test('renders the mobile list view with its own field under the bar', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page);

    await expect(page.getByTestId('note-list')).toBeVisible();
    await expect(field(page)).toBeVisible();

    await search(page, 'roadmap');
    await expect(page.getByTestId('list-header')).toHaveText('Results for “roadmap”');
  });

  test('draws one focus ring on the field, not one inside it', async ({ page }) => {
    await open(page);
    const input = field(page);
    await input.focus();

    /* `TopBar` puts the ring on the container; the bare input must not add a
       second one, and `outline-none` cannot stop it — see `base.css`. */
    const ring = await input.evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(ring).toBe('none');

    /* Chromium's own cancel button is the other half of the same defect, and it
       is not assertable from computed style: `getComputedStyle` on
       `::-webkit-search-cancel-button` reports the user-agent value whatever the
       author sheet says. What *is* assertable is that a full field offers one
       clear control and not two; the picture is checked by eye in
       `screenshots/search-light.png`, per `11-verification.md` §4 level 2. */
    await search(page, 'road');
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(1);
  });

  test('captures the search state for review', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await open(page);

    /* The editor is code-split, so capturing before its chunk lands photographs
       the Suspense fallback rather than the state. */
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();

    await search(page, 'roadmap');
    await expect(page.locator('[data-testid="note-snippet"] mark').first()).toBeVisible();
    await page.screenshot({ path: 'screenshots/search-light.png', fullPage: false });
  });
});