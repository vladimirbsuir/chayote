import type { Selection } from '../types/ipc';
import type { Uuid } from '../types/note';

export type Theme = 'light' | 'dark' | 'system';

export type AccentPreset = 1 | 2 | 3 | 4 | 5 | 6;

export type Settings = {
  theme: Theme;
  /** `null` means the theme's own default accent, resolved by the cascade from
      `--accent-preset-1`. A hex means a custom colour, which is written inline
      and therefore cannot follow the theme. */
  accent: string | null;
  /** `null` means notes start unfiled; nothing is pre-created. */
  defaultFolderId: Uuid | null;
  sidebarWidth: number;
  /** `true` when the sidebar is hidden. Width is remembered separately, so
      toggling back restores 320 px rather than the minimum. */
  sidebarCollapsed: boolean;
  collapsedFolders: Uuid[];
  lastNoteId: Uuid | null;
  lastSelection: Selection;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: null,
  defaultFolderId: null,
  sidebarWidth: 320,
  sidebarCollapsed: false,
  collapsedFolders: [],
  lastNoteId: null,
  lastSelection: { kind: 'all' },
};

const STORE_FILE = 'settings.json';
const SETTINGS_KEY = 'settings';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let cached: Settings | null = null;
let inflight: Promise<Settings> | null = null;

/**
 * Settings live in the Tauri store, never in the notes database, so resetting
 * or syncing them can never touch notes (`05-ui-ux.md` §6.6).
 *
 * Outside Tauri — `npm run dev`, Playwright — the store resolves to a
 * `localStorage`-backed stand-in so the settings dialog and theme switching can
 * be driven in a browser (ADR-018). That is the only difference from the real
 * path; the shape is identical.
 */
export async function loadSettings(): Promise<Settings> {
  if (cached !== null) return cached;
  inflight ??= read();
  try {
    cached = await inflight;
    return cached;
  } finally {
    inflight = null;
  }
}

async function read(): Promise<Settings> {
  const raw = await readRaw();
  return { ...DEFAULT_SETTINGS, ...normalise(parse(raw)) };
}

/** A settings file written before the accent became per-theme stores a preset's
    hex. Left alone it would read as a *custom* accent, be written inline, and
    defeat the cascade in dark mode — which is the bug this shape removes. A
    stored value equal to any preset in either theme means "the default". */
function normalise(value: Partial<Settings>): Partial<Settings> {
  if (typeof value.accent === 'string' && isPresetAccent(value.accent)) {
    return { ...value, accent: null };
  }
  return value;
}

/// Debounced at 300 ms by the caller (`10-conventions.md` §7).
export async function saveSettings(next: Settings): Promise<void> {
  cached = next;
  await writeRaw(JSON.stringify(next));
}

export function resetSettingsCache(): void {
  cached = null;
}

async function readRaw(): Promise<string | null> {
  if (!isTauri()) {
    return window.localStorage.getItem(STORE_FILE);
  }
  const { load } = await import('@tauri-apps/plugin-store');
  const store = await load(STORE_FILE, { autoSave: false });
  try {
    const value: unknown = await store.get(SETTINGS_KEY);
    return typeof value === 'string' ? value : null;
  } finally {
    await store.close();
  }
}

async function writeRaw(value: string): Promise<void> {
  if (!isTauri()) {
    window.localStorage.setItem(STORE_FILE, value);
    return;
  }
  const { load } = await import('@tauri-apps/plugin-store');
  const store = await load(STORE_FILE, { autoSave: true });
  try {
    await store.set(SETTINGS_KEY, value);
  } finally {
    await store.close();
  }
}

function parse(raw: string | null): Partial<Settings> {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    return value;
  } catch {
    // A corrupt settings file must not stop the app from starting. Defaults
    // are a working state; notes are untouched either way.
    return {};
  }
}

/// The six presets, in the order `05-ui-ux.md` §6.6 presents them. Each carries a
/// value per theme, because an accent used as text needs 4.5:1 against the raised
/// surface of whichever theme is active and one value cannot clear it in both.
/// The same pairs are in `styles/tokens.css`; the contrast test is what keeps the
/// two copies honest.
export const ACCENT_PRESETS: ReadonlyArray<{ name: string; light: string; dark: string }> = [
  { name: 'Default', light: '#2769ec', dark: '#4881ef' },
  { name: 'Green', light: '#1f7a4d', dark: '#26975f' },
  { name: 'Violet', light: '#814ef5', dark: '#9469f7' },
  { name: 'Rust', light: '#c2410c', dark: '#ea4f0e' },
  { name: 'Magenta', light: '#b91c5c', dark: '#e44a88' },
  { name: 'Teal', light: '#0f766e', dark: '#13948a' },
];

/** The value a preset resolves to in the given effective theme. */
export function presetValue(preset: (typeof ACCENT_PRESETS)[number], dark: boolean): string {
  return dark ? preset.dark : preset.light;
}

/** Preset values that have since been replaced. A file written before the accent
    became per-theme holds one of these, and it cannot be picked any more, so it
    is the default rather than a custom colour. */
const RETIRED_PRESETS: ReadonlySet<string> = new Set([
  '#2f6fed',
  '#8b5cf6',
  '#6f9bff',
]);

/** True when a stored accent is one of the preset values rather than a choice
    the user made. */
export function isPresetAccent(accent: string): boolean {
  return (
    RETIRED_PRESETS.has(accent) ||
    ACCENT_PRESETS.some((preset) => preset.light === accent || preset.dark === accent)
  );
}

export { STORE_FILE, SETTINGS_KEY };