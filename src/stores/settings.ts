import { create } from 'zustand';
import type { Settings, Theme } from '../lib/settings';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings';
import { debounce } from '../lib/debounce';
import type { Debounced } from '../lib/debounce';
import type { Uuid } from '../types/note';

/* UI state that outlives a session: theme, accent, sidebar width, collapsed
   folders, and the note last open (`02-architecture.md` §5). It is persisted in
   the Tauri store, never in the notes database (`05-ui-ux.md` §6.6), and written
   debounced at 300 ms (`10-conventions.md` §7).

   Zustand owns the live values so a toggle re-renders without a round trip;
   `lib/settings.ts` owns the file. Neither holds a document. */

export type SettingsState = Settings & {
  /** `false` until the store has been read, so nothing can paint a default that
      the persisted value would contradict. */
  hydrated: boolean;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: string) => void;
  setSidebarWidth: (width: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  toggleFolderCollapsed: (id: Uuid) => void;
  setLastNote: (id: Uuid | null) => void;
  setLastSelection: (selection: Settings['lastSelection']) => void;
  reset: () => void;
};

const PERSISTED: ReadonlyArray<keyof Settings> = [
  'theme',
  'accent',
  'defaultFolderId',
  'sidebarWidth',
  'sidebarCollapsed',
  'collapsedFolders',
  'lastNoteId',
  'lastSelection',
];

let write: Debounced<[]> | null = null;

function persist(state: SettingsState): void {
  const values = Object.fromEntries(PERSISTED.map((key) => [key, state[key]])) as Settings;
  void saveSettings(values).catch(() => {
    /* A settings write that fails must not take the app down, and the next write
       carries the same value. The store has no error channel for this and
       `06-platform.md` §2 defines no surface for one. */
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  write ??= debounce(() => {
    persist(get());
  }, 300);

  const update = (patch: Partial<Settings>): void => {
    set(patch);
    write?.();
  };

  return {
    ...DEFAULT_SETTINGS,
    hydrated: false,
    setTheme: (theme) => {
      update({ theme });
    },
    setAccent: (accent) => {
      update({ accent });
    },
    setSidebarWidth: (sidebarWidth) => {
      update({ sidebarWidth });
    },
    setSidebarCollapsed: (sidebarCollapsed) => {
      update({ sidebarCollapsed });
    },
    toggleSidebarCollapsed: () => {
      update({ sidebarCollapsed: !get().sidebarCollapsed });
    },
    toggleFolderCollapsed: (id) => {
      const current = get().collapsedFolders;
      update({
        collapsedFolders: current.includes(id)
          ? current.filter((candidate) => candidate !== id)
          : [...current, id],
      });
    },
    /* Which note is open and which selection is active are persisted so a
       relaunch lands where the user left off — `06-platform.md` §6 "Close and
       reopen restores … selection, and the open note." They are written on every
       note switch, which is why this goes through the same 300 ms debounce. */
    setLastNote: (lastNoteId) => {
      update({ lastNoteId });
    },
    setLastSelection: (lastSelection) => {
      update({ lastSelection });
    },
    /* `05-ui-ux.md` §6.6: settings never touch notes, so a reset is exactly the
       defaults and nothing else. */
    reset: () => {
      update(DEFAULT_SETTINGS);
    },
  };
});

/** Read the persisted store into Zustand. Called once at startup, before the
    theme reaches the document, so the first paint is in the right theme rather
    than flashing the default. */
export async function hydrateSettings(): Promise<void> {
  const stored = await loadSettings();
  useSettingsStore.setState({ ...stored, hydrated: true });
}

/** Run the pending debounced write now. Window close is the case that matters:
    an unflushed 300 ms write would lose the last setting the user touched. */
export function flushSettings(): void {
  write?.flush();
}

/** The only tokens a user configures are `--accent` and `--accent-soft`
    (`05-ui-ux.md` §6.6). Setting them inline switches the accent with no
    re-render of the editor subtree, which is the reason themes are CSS
    variables at all (ADR-008). */
export function applyAccent(accent: string): void {
  const root = document.documentElement;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-soft', `${accent}20`);
}

/** `system` resolves against the OS preference (`05-ui-ux.md` §6.6). */
export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}