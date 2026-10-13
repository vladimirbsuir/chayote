import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCENT_PRESETS,
  DEFAULT_SETTINGS,
  loadSettings,
  resetSettingsCache,
  saveSettings,
  STORE_FILE,
} from './settings';
import type { Settings } from './settings';

describe('settings store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSettingsCache();
  });

  it('starts from the documented defaults, with nothing pre-created', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(DEFAULT_SETTINGS.accent).toBeNull();
    expect(DEFAULT_SETTINGS.lastCustomHex).toBe('#2f6fed');
    // ADR-014: first launch creates no folders, so the default folder is none.
    expect(DEFAULT_SETTINGS.defaultFolderId).toBeNull();
    expect(DEFAULT_SETTINGS.collapsedFolders).toEqual([]);
    expect(DEFAULT_SETTINGS.sectionsCollapsed).toEqual({ folders: false, tags: false });
    expect(DEFAULT_SETTINGS.lastNoteId).toBeNull();
  });

  it('round-trips through the store', async () => {
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      accent: { kind: 'preset', index: 6 },
      sidebarWidth: 280,
      collapsedFolders: ['f-work', 'f-personal'],
      lastNoteId: 'n-1',
      lastSelection: { kind: 'folder', id: 'f-work' },
    };

    await saveSettings(next);
    const loaded = await loadSettings();

    expect(loaded).toEqual(next);
    expect(loaded.lastSelection).toEqual({ kind: 'folder', id: 'f-work' });
  });

  it('falls back to defaults when nothing is stored', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when the stored value is corrupt', async () => {
    // A corrupt settings file must not stop the app from starting; notes are
    // untouched either way.
    window.localStorage.setItem(STORE_FILE, '{ not json');
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when the stored value is not an object', async () => {
    window.localStorage.setItem(STORE_FILE, '"a string"');
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial stored value over the defaults', async () => {
    window.localStorage.setItem(STORE_FILE, JSON.stringify({ theme: 'light' }));
    const loaded = await loadSettings();
    expect(loaded.theme).toBe('light');
    // Everything absent keeps its default rather than becoming undefined.
    expect(loaded.accent).toBe(DEFAULT_SETTINGS.accent);
    expect(loaded.sidebarWidth).toBe(DEFAULT_SETTINGS.sidebarWidth);
  });

  it('reads once and caches until reset', async () => {
    const first = await loadSettings();
    expect(first).toEqual(DEFAULT_SETTINGS);

    // A write behind the store's back must not be observed while cached.
    window.localStorage.setItem(STORE_FILE, JSON.stringify({ theme: 'dark' }));
    expect((await loadSettings()).theme).toBe('system');

    resetSettingsCache();
    expect((await loadSettings()).theme).toBe('dark');
  });

  it('offers six accent presets, each with a name and a value per theme', () => {
    expect(ACCENT_PRESETS).toHaveLength(6);
    const light = ACCENT_PRESETS.map((preset) => preset.light);
    const dark = ACCENT_PRESETS.map((preset) => preset.dark);
    expect(new Set(light).size).toBe(6);
    expect(new Set(dark).size).toBe(6);
    for (const preset of ACCENT_PRESETS) {
      expect(preset.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });

  it('matches the swatches the prototype ships', () => {
    // `prototype/index.html` §5 lists these in this order. If they drift, the
    // settings dialog and the prototype disagree, which ADR-016 forbids.
    expect(ACCENT_PRESETS.map((preset) => preset.light)).toEqual([
      '#2769ec',
      '#1f7a4d',
      '#814ef5',
      '#c2410c',
      '#b91c5c',
      '#0f766e',
    ]);
    expect(ACCENT_PRESETS.map((preset) => preset.dark)).toEqual([
      '#4881ef',
      '#26975f',
      '#9469f7',
      '#ea4f0e',
      '#e44a88',
      '#13948a',
    ]);
  });

  it('reads a stored preset hex as that preset, not as a custom accent', async () => {
    /* Files written before M6 hold a bare hex. Left as a custom colour it would
       be written inline and defeat the cascade in dark mode — the bug ADR-019
       records. Each retired hex maps back to the preset it used to be, so a user
       who had chosen Violet keeps Violet rather than being handed a colour the
       dark theme can no longer lift. */
    window.localStorage.setItem(STORE_FILE, JSON.stringify({ accent: '#2f6fed' }));
    expect((await loadSettings()).accent).toEqual({ kind: 'preset', index: 1 });

    window.localStorage.setItem(STORE_FILE, JSON.stringify({ accent: '#8b5cf6' }));
    resetSettingsCache();
    expect((await loadSettings()).accent).toEqual({ kind: 'preset', index: 3 });
  });

  it('keeps a genuinely custom accent', async () => {
    window.localStorage.setItem(STORE_FILE, JSON.stringify({ accent: '#123456' }));
    expect((await loadSettings()).accent).toEqual({ kind: 'custom', hex: '#123456' });
  });

  it('remembers the last custom colour behind a preset', async () => {
    window.localStorage.setItem(
      STORE_FILE,
      JSON.stringify({ accent: { kind: 'preset', index: 2 }, lastCustomHex: '#123456' }),
    );
    const loaded = await loadSettings();
    expect(loaded.accent).toEqual({ kind: 'preset', index: 2 });
    expect(loaded.lastCustomHex).toBe('#123456');
  });

  it('falls back when the remembered custom colour is missing or malformed', async () => {
    for (const stored of [{}, { lastCustomHex: 'blue' }, { lastCustomHex: '#12' }, { lastCustomHex: 42 }]) {
      window.localStorage.setItem(STORE_FILE, JSON.stringify(stored));
      resetSettingsCache();
      expect((await loadSettings()).lastCustomHex, JSON.stringify(stored)).toBe('#2f6fed');
    }
  });

  it('reads a stored preset object, and falls back on anything malformed', async () => {
    /* A settings file must never be able to stop the app starting, whatever it
       contains — so an out-of-range index or a non-hex is the default, not an
       error. */
    for (const stored of [
      { kind: 'preset', index: 0 },
      { kind: 'preset', index: 99 },
      { kind: 'preset', index: 2.5 },
      { kind: 'custom', hex: 'not-a-colour' },
      { kind: 'nonsense' },
      'blue',
      42,
    ]) {
      window.localStorage.setItem(STORE_FILE, JSON.stringify({ accent: stored }));
      resetSettingsCache();
      expect((await loadSettings()).accent, JSON.stringify(stored)).toBeNull();
    }
  });
});