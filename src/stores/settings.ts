import { create } from 'zustand';
import type { AccentChoice, SectionCollapse, Settings, Theme } from '../lib/settings';
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
  setAccent: (accent: AccentChoice) => void;
  setLastCustomHex: (hex: string) => void;
  setDefaultFolderId: (id: Uuid | null) => void;
  setSidebarWidth: (width: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  toggleFolderCollapsed: (id: Uuid) => void;
  /** Collapse or expand a whole structure section — the high-level Folders or
      Tags list — rather than one folder's twisty. Persisted like the rest, so
      a collapsed list stays collapsed across launches. */
  toggleSectionCollapsed: (section: keyof SectionCollapse) => void;
  setLastNote: (id: Uuid | null) => void;
  setLastSelection: (selection: Settings['lastSelection']) => void;
  /** Record that the updater looked, so the daily silent check does not repeat
      itself on every launch. Written even when the check found nothing or
      failed: the attempt happened, and that is what the timestamp means. */
  setLastUpdateCheckAt: (at: number) => void;
  reset: () => void;
};

const PERSISTED: ReadonlyArray<keyof Settings> = [
  'theme',
  'accent',
  'lastCustomHex',
  'defaultFolderId',
  'sidebarWidth',
  'sidebarCollapsed',
  'collapsedFolders',
  'sectionsCollapsed',
  'lastNoteId',
  'lastSelection',
  'lastUpdateCheckAt',
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
    setLastCustomHex: (lastCustomHex) => {
      update({ lastCustomHex });
    },
    setDefaultFolderId: (defaultFolderId) => {
      update({ defaultFolderId });
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
    toggleSectionCollapsed: (section) => {
      const current = get().sectionsCollapsed;
      update({
        sectionsCollapsed: { ...current, [section]: !current[section] },
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
    setLastUpdateCheckAt: (lastUpdateCheckAt) => {
      update({ lastUpdateCheckAt });
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
    (`05-ui-ux.md` §6.6), and the two are handled differently on purpose.

    A **preset** is written as a reference, `var(--accent-preset-N)`, not as its
    hex. The reference resolves through the cascade, so the dark theme still
    picks up its own value for the same preset — which is ADR-019's whole point,
    and the reason this takes an index rather than a colour. Writing the hex here
    would put it back to one value in both themes.

    A **custom** colour is a literal, because it is not in either token block and
    has no second value to switch to. It is used verbatim in both themes, which
    `05-ui-ux.md` §6.6 states plainly and the settings dialog measures and warns
    about.

    With no choice at all nothing is written, so `--accent` is whatever the
    theme block says. `--accent-soft` is derived from `--accent` by `color-mix`
    in the token file and is never written here. */
export function applyAccent(choice: AccentChoice): void {
  const root = document.documentElement;
  if (choice === null) {
    root.style.removeProperty('--accent');
    return;
  }
  root.style.setProperty(
    '--accent',
    choice.kind === 'preset' ? `var(--accent-preset-${choice.index})` : choice.hex,
  );
}

/** `system` resolves against the OS preference (`05-ui-ux.md` §6.6). */
export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}