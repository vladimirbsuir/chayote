import type { Selection } from '../types/ipc';
import type { Uuid } from '../types/note';
import { parseHex } from './contrast';

export type Theme = 'light' | 'dark' | 'system';

/** Which accent is in use. The distinction that matters is preset versus
    custom, not the hex: a preset can be written inline as a *reference* to
    `--accent-preset-N`, which the dark theme then resolves to its own value,
    while a custom colour is a literal that cannot. Collapsing both onto a hex
    would make all six presets indistinguishable from "the default" — and would
    re-break ADR-019, because an inline hex defeats the cascade. */
export type AccentChoice =
  | { kind: 'preset'; index: number }
  | { kind: 'custom'; hex: string }
  | null;

export type AccentPreset = 1 | 2 | 3 | 4 | 5 | 6;

/** Which of the sidebar's structure sections are collapsed as a whole. This is
    the high-level list, not the per-folder twisty state in `collapsedFolders`:
    with many top-level folders or tags the tree itself is the thing to hide. */
export type SectionCollapse = {
  folders: boolean;
  tags: boolean;
};

export type Settings = {
  theme: Theme;
  accent: AccentChoice;
  /** `null` means notes start unfiled; nothing is pre-created. */
  defaultFolderId: Uuid | null;
  sidebarWidth: number;
  /** `true` when the sidebar is hidden. Width is remembered separately, so
      toggling back restores 320 px rather than the minimum. */
  sidebarCollapsed: boolean;
  collapsedFolders: Uuid[];
  sectionsCollapsed: SectionCollapse;
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
  sectionsCollapsed: { folders: false, tags: false },
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
  const stored = parse(raw);
  /* The accent is the one field whose stored shape has changed, and the only one
     that can be a bare hex, an object or absent. Parsed here rather than trusted
     so a file from an earlier build loads as what it meant. */
  return { ...DEFAULT_SETTINGS, ...stored, accent: parseAccent(stored.accent) };
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

/** Preset values that have since been replaced, and which theme they came from.
    A file written before the accent became per-theme holds one of these as a
    bare hex. Each maps to the preset it used to be, so a user who had chosen
    Violet keeps Violet rather than being handed a custom colour the theme can
    no longer lift. */
const RETIRED_PRESETS: ReadonlyMap<string, number> = new Map([
  ['#2f6fed', 1],
  ['#8b5cf6', 3],
  ['#6f9bff', 1],
]);

/** True when a stored accent is one of the current preset values rather than a
    choice the user made. Kept for the settings test and for `parseAccent`. */
function isPresetAccent(accent: string): boolean {
  return ACCENT_PRESETS.some((preset) => preset.light === accent || preset.dark === accent);
}
function parseAccent(value: unknown): AccentChoice {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const retired = RETIRED_PRESETS.get(value.toLowerCase());
    if (retired !== undefined) return { kind: 'preset', index: retired };
    if (isPresetAccent(value)) return null;
    return /^#[0-9a-f]{6}$/i.test(value) ? { kind: 'custom', hex: value } : null;
  }

  if (typeof value === 'object') {
    const choice = value as { kind?: unknown; index?: unknown; hex?: unknown };
    if (
      choice.kind === 'preset' &&
      typeof choice.index === 'number' &&
      Number.isInteger(choice.index) &&
      choice.index >= 1 &&
      choice.index <= ACCENT_PRESETS.length
    ) {
      return { kind: 'preset', index: choice.index };
    }
    if (choice.kind === 'custom' && typeof choice.hex === 'string' && parseHex(choice.hex) !== null) {
      return { kind: 'custom', hex: choice.hex };
    }
  }

  return null;
}

export { STORE_FILE, SETTINGS_KEY };