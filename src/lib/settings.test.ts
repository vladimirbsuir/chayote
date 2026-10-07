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
    expect(DEFAULT_SETTINGS.accent).toBe('#2f6fed');
    // ADR-014: first launch creates no folders, so the default folder is none.
    expect(DEFAULT_SETTINGS.defaultFolderId).toBeNull();
    expect(DEFAULT_SETTINGS.collapsedFolders).toEqual([]);
    expect(DEFAULT_SETTINGS.lastNoteId).toBeNull();
  });

  it('round-trips through the store', async () => {
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      accent: '#0f766e',
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

  it('offers six accent presets, each with a name', () => {
    expect(ACCENT_PRESETS).toHaveLength(6);
    const values = ACCENT_PRESETS.map((preset) => preset.value);
    expect(new Set(values).size).toBe(6);
    for (const preset of ACCENT_PRESETS) {
      expect(preset.value).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.name.length).toBeGreaterThan(0);
    }
    // The first preset is the documented default accent.
    expect(ACCENT_PRESETS[0]?.value).toBe(DEFAULT_SETTINGS.accent);
  });

  it('matches the swatches the prototype ships', () => {
    // `prototype/index.html` §4 lists these in this order. If they drift, the
    // settings dialog and the prototype disagree, which ADR-016 forbids.
    expect(ACCENT_PRESETS.map((preset) => preset.value)).toEqual([
      '#2f6fed',
      '#1f7a4d',
      '#8b5cf6',
      '#c2410c',
      '#b91c5c',
      '#0f766e',
    ]);
  });
});