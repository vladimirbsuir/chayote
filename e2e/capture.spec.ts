import { expect, test } from '@playwright/test';
import { seedSettings } from './helpers';

/* `11-verification.md` §4 level 2: capture each state at a fixed viewport in both
   themes into `screenshots/`, which is committed so a reviewer can compare runs
   by eye. Level 1 assertions live in `smoke.spec.ts` and `editor.spec.ts`, and
   level 3 (pixel diffing) is deliberately not done — §4's recommendation is that
   a brittle 1 px failure trains people to ignore the suite.

   §4 asks for all three viewports in *both* themes. M0 covered four of the six
   combinations and M6 covers the rest, because a contrast token changed and the
   point of a capture is that someone looks at the result. */

const RICH_NOTE = '01980000-0000-7000-8000-000000000001';

const VIEWPORTS = {
  desktop: { width: 1280, height: 820 },
  tablet: { width: 900, height: 1023 },
  mobile: { width: 360, height: 640 },
} as const;

const THEMES = ['light', 'dark'] as const;

for (const [viewport, size] of Object.entries(VIEWPORTS)) {
  for (const theme of THEMES) {
    test(`captures ${viewport}-${theme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme });
      await seedSettings(page, { theme, accent: null, lastNoteId: RICH_NOTE, lastSelection: { kind: 'all' } });

      await page.goto('/');
      /* §2.4: below 768 px only the list is on screen at rest — the editor is a
         pushed view. Capturing the mobile editor therefore means opening a note,
         which is the real user path and not a special case in the test. */
      if (size.width < 768) {
        await expect(page.getByTestId('note-list')).toBeVisible();
        await page.getByTestId('note-card').first().click();
      }
      await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
      await expect(page.getByTestId('save-state')).toHaveText('Saved');
      await page.screenshot({ path: `screenshots/${viewport}-${theme}.png`, fullPage: false });
    });
  }
}

/* The dialogs, because a settings dialog that has never been looked at is a
   settings dialog that is wrong somewhere. Both themes, at the desktop size,
   which is where the review will happen. */
for (const theme of THEMES) {
  test(`captures settings-${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.emulateMedia({ colorScheme: theme });
    await seedSettings(page, { theme, accent: null });

    await page.goto('/');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('topbar-overflow-settings').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await page.screenshot({ path: `screenshots/settings-${theme}.png`, fullPage: false });
  });
}

/* The status-bar popovers in dark, where the accent token and the text ladder
   both changed and neither has been seen on screen in that theme. */
for (const theme of THEMES) {
  test(`captures tag-editor-${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.emulateMedia({ colorScheme: theme });
    await seedSettings(page, { theme, accent: null, lastNoteId: RICH_NOTE });

    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
    /* The aria-label names the action, and says "Change" rather than "Choose"
   when the note already carries tags — §6.4 asks for exactly that, so a screen
   reader announces what pressing the control would do rather than its value.
   Both spellings are matched rather than picking one, because the seeded note
   decides which it is and the capture should not depend on that. */
await page.getByRole('button', { name: /^(Choose|Change) tags$/ }).click();
    await expect(page.getByRole('listbox').first()).toBeVisible();
    await page.screenshot({ path: `screenshots/tag-editor-${theme}.png`, fullPage: false });
  });
}