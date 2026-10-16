import type { Theme } from './settings';

/* The three theme states and the order the cycle runs in.
   `05-ui-ux.md` §4 makes `ThemeToggle` a Light / Dark / System cycle and §7
   binds `Ctrl/Cmd+Shift+L` to it, so the same order has to be reachable from a
   button in the top bar, a shortcut from anywhere, and a segmented control in
   the settings dialog. Three copies of an increment is how they drift, so the
   cycle lives here and the components call it.

   `system` is last rather than first because it is the default and the value a
   reset returns to: cycling *to* the default from dark should take one press,
   not three. */

const ORDER: readonly Theme[] = ['light', 'dark', 'system'];

/** Light to dark to system and back. */
export function nextTheme(theme: Theme): Theme {
  const index = ORDER.indexOf(theme);
  return ORDER[(index + 1) % ORDER.length] ?? 'system';
}

/** The cycle step that actually changes what is on screen. `system` resolves
    against the OS, so stepping onto it from the theme it currently equals is
    a no-op press — stored dark on a dark OS would need two clicks to reach
    light. Such a step is skipped, exactly once (only `system` can alias). */
export function nextVisibleTheme(stored: Theme, systemDark: boolean): Theme {
  const os: 'light' | 'dark' = systemDark ? 'dark' : 'light';
  const effective = stored === 'system' ? os : stored;
  const next = nextTheme(stored);
  if ((next === 'system' ? os : next) === effective) return nextTheme(next);
  return next;
}

export function themeLabel(theme: Theme): string {
  if (theme === 'light') return 'Light';
  if (theme === 'dark') return 'Dark';
  return 'System';
}
