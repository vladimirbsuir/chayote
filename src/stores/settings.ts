import { create } from 'zustand';
import type { AccentChoice, SectionCollapse, Settings, Theme } from '../lib/settings';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings';
import { debounce } from '../lib/debounce';
import type { Debounced } from '../lib/debounce';
import type { Uuid } from '../types/note';

export type SettingsState = Settings & {
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
  toggleSectionCollapsed: (section: keyof SectionCollapse) => void;
  setLastNote: (id: Uuid | null) => void;
  setLastSelection: (selection: Settings['lastSelection']) => void;
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
let lastWrite: Promise<void> = Promise.resolve();

function persist(state: SettingsState): void {
  const values = Object.fromEntries(PERSISTED.map((key) => [key, state[key]])) as Settings;
  lastWrite = saveSettings(values).catch(() => {});
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  write ??= debounce(() => {
    persist(get());
  }, 300);

  const update = (patch: Partial<Settings>): void => {
    set(patch);
    if (get().hydrated) write?.();
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
    setLastNote: (lastNoteId) => {
      update({ lastNoteId });
    },
    setLastSelection: (lastSelection) => {
      update({ lastSelection });
    },
    setLastUpdateCheckAt: (lastUpdateCheckAt) => {
      update({ lastUpdateCheckAt });
    },
    reset: () => {
      update(DEFAULT_SETTINGS);
    },
  };
});

export async function hydrateSettings(): Promise<void> {
  const stored = await loadSettings();
  useSettingsStore.setState({ ...stored, hydrated: true });
}

export function flushSettings(): void {
  write?.flush();
}

export async function flushSettingsAsync(): Promise<void> {
  write?.flush();
  await lastWrite;
}

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

export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}