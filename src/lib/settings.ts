import type { Selection } from '../types/ipc';
import type { Uuid } from '../types/note';

export type Theme = 'light' | 'dark' | 'system';

export type AccentPreset = 1 | 2 | 3 | 4 | 5 | 6;

export type Settings = {
  theme: Theme;
  /** A hex colour, either a `--accent-preset-N` value or a custom one. */
  accent: string;
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
  accent: '#2f6fed',
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
  return { ...DEFAULT_SETTINGS, ...parse(raw) };
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

/// The six presets, in the order `05-ui-ux.md` §6.6 presents them. Each holds
/// 4.5:1 against both `--surface` and `--surface-raised`.
export const ACCENT_PRESETS: ReadonlyArray<{ value: string; name: string }> = [
  { value: '#2f6fed', name: 'Default' },
  { value: '#1f7a4d', name: 'Green' },
  { value: '#8b5cf6', name: 'Violet' },
  { value: '#c2410c', name: 'Rust' },
  { value: '#b91c5c', name: 'Magenta' },
  { value: '#0f766e', name: 'Teal' },
];

export { STORE_FILE, SETTINGS_KEY };