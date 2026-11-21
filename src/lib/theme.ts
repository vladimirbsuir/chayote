import type { Theme } from './settings';

const ORDER: readonly Theme[] = ['light', 'dark', 'system'];

export function nextTheme(theme: Theme): Theme {
  const index = ORDER.indexOf(theme);
  return ORDER[(index + 1) % ORDER.length] ?? 'system';
}

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
