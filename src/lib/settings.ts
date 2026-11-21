import type { Selection } from '../types/ipc';
import type { Uuid } from '../types/note';
import { parseHex } from './contrast';

export type Theme = 'light' | 'dark' | 'system';

export type AccentChoice =
  | { kind: 'preset'; index: number }
  | { kind: 'custom'; hex: string }
  | null;

export type AccentPreset = 1 | 2 | 3 | 4 | 5 | 6;

export type SectionCollapse = {
  folders: boolean;
  tags: boolean;
};

export const DEFAULT_CUSTOM_HEX = '#2f6fed';

export type Settings = {
  theme: Theme;
  accent: AccentChoice;
  lastCustomHex: string;
  defaultFolderId: Uuid | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  collapsedFolders: Uuid[];
  sectionsCollapsed: SectionCollapse;
  lastNoteId: Uuid | null;
  lastSelection: Selection;
  lastUpdateCheckAt: number | null;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: null,
  lastCustomHex: DEFAULT_CUSTOM_HEX,
  defaultFolderId: null,
  sidebarWidth: 320,
  sidebarCollapsed: false,
  collapsedFolders: [],
  sectionsCollapsed: { folders: false, tags: false },
  lastNoteId: null,
  lastSelection: { kind: 'all' },
  lastUpdateCheckAt: null,
};

const STORE_FILE = 'settings.json';
const SETTINGS_KEY = 'settings';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let cached: Settings | null = null;
let inflight: Promise<Settings> | null = null;

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
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    accent: parseAccent(stored.accent),
    lastCustomHex: parseCustomHex(stored.lastCustomHex),
  };
}

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
    return {};
  }
}

export const ACCENT_PRESETS: ReadonlyArray<{ name: string; light: string; dark: string }> = [
  { name: 'Blue', light: '#2769ec', dark: '#4881ef' },
  { name: 'Green', light: '#1f7a4d', dark: '#26975f' },
  { name: 'Violet', light: '#814ef5', dark: '#9469f7' },
  { name: 'Rust', light: '#c2410c', dark: '#ea4f0e' },
  { name: 'Magenta', light: '#b91c5c', dark: '#e44a88' },
  { name: 'Teal', light: '#0f766e', dark: '#13948a' },
];

export function presetValue(preset: (typeof ACCENT_PRESETS)[number], dark: boolean): string {
  return dark ? preset.dark : preset.light;
}

const RETIRED_PRESETS: ReadonlyMap<string, number> = new Map([
  ['#2f6fed', 1],
  ['#8b5cf6', 3],
  ['#6f9bff', 1],
]);

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

function parseCustomHex(value: unknown): string {
  if (typeof value === 'string' && parseHex(value) !== null) return value.toLowerCase();
  return DEFAULT_CUSTOM_HEX;
}

export { STORE_FILE, SETTINGS_KEY };