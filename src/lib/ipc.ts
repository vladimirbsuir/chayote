import type { Backend, CommandArgs, CommandName, CommandOutput } from '../types/ipc';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';
import type { Note, NoteFilter, NoteSummary, SaveNoteInput } from '../types/ipc';
import type { SearchInput, SearchPage } from '../types/search';
import type { Uuid } from '../types/note';
import {
  buildEmptyMockDatabase,
  buildMockDatabase,
  createMockBackend,
} from '../mock/adapter';
import type { MockDatabase } from '../mock/derive';

export { cycleDetected, MockBackendError, notFound } from '../mock/errors';

/* ADR-018: one module owns IPC. Components never import `@tauri-apps/api`
   directly, so the frontend can run in a plain browser and Playwright can
   drive the real component tree. R6 is enforced structurally by this file. */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function tauriBackend(): Backend {
  return {
    async invoke<C extends CommandName>(
      command: C,
      args: CommandArgs[C],
    ): Promise<CommandOutput[C]> {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke(command, args);
    },
  };
}

let active: Backend | null = null;

/** `?seed=empty` starts the browser fallback from an empty database, which is the
    ADR-014 first-launch state. It is read here, in the one module that owns the
    adapter choice, so a test reaches it by URL rather than by importing the mock
    into a component — which `10-conventions.md` §5 forbids. */
function mockDatabaseForUrl(): MockDatabase {
  const seed = new URLSearchParams(window.location.search).get('seed');
  return seed === 'empty' ? buildEmptyMockDatabase() : buildMockDatabase();
}

function resolve(): Backend {
  if (active !== null) return active;
  if (import.meta.env.DEV && !isTauri) {
    active = createMockBackend(mockDatabaseForUrl());
    return active;
  }
  active = tauriBackend();
  return active;
}

export function setMockBackend(db = buildMockDatabase()): void {
  active = createMockBackend(db);
}

export function setTauriBackend(): void {
  active = tauriBackend();
}

export function invoke<C extends CommandName>(
  command: C,
  args: CommandArgs[C],
): Promise<CommandOutput[C]> {
  return resolve().invoke(command, args);
}

export function isMockBackend(): boolean {
  return import.meta.env.DEV && !isTauri;
}

export const notesApi = {
  list: (filter: NoteFilter): Promise<NoteSummary[]> => invoke('notes_list', { filter }),
  get: (id: Uuid): Promise<Note> => invoke('notes_get', { id }),
  create: (folderId: Uuid | null): Promise<Note> => invoke('notes_create', { folderId }),
  save: (input: SaveNoteInput): Promise<Note> => invoke('notes_save', { input }),
  move: (id: Uuid, folderId: Uuid | null): Promise<Note> => invoke('notes_move', { id, folderId }),
  setPinned: (id: Uuid, isPinned: boolean): Promise<Note> =>
    invoke('notes_set_pinned', { id, isPinned }),
  softDelete: (id: Uuid): Promise<void> => invoke('notes_soft_delete', { id }),
  restore: (id: Uuid): Promise<void> => invoke('notes_restore', { id }),
  destroy: (id: Uuid): Promise<void> => invoke('notes_destroy', { id }),
  emptyTrash: (): Promise<number> => invoke('notes_empty_trash', {}),
};

export const foldersApi = {
  list: (): Promise<FolderNode[]> => invoke('folders_list', {}),
  create: (name: string, parentId: Uuid | null): Promise<FolderNode> =>
    invoke('folders_create', { name, parentId }),
  rename: (id: Uuid, name: string): Promise<FolderNode> => invoke('folders_rename', { id, name }),
  move: (id: Uuid, newParentId: Uuid | null, position: number): Promise<FolderNode> =>
    invoke('folders_move', { id, newParentId, position }),
  remove: (id: Uuid): Promise<void> => invoke('folders_delete', { id }),
};

export const tagsApi = {
  list: (): Promise<TagWithCount[]> => invoke('tags_list', {}),
  create: (name: string): Promise<TagWithCount> => invoke('tags_create', { name }),
  rename: (id: Uuid, name: string): Promise<TagWithCount> => invoke('tags_rename', { id, name }),
  remove: (id: Uuid): Promise<void> => invoke('tags_delete', { id }),
};

export const searchApi = {
  query: (input: SearchInput): Promise<SearchPage> => invoke('search_query', { input }),
};

export const windowApi = {
  ready: (): Promise<void> => invoke('window_ready', {}),
};

/** The global the Android activity calls. It lives here rather than in a component
    because R6 makes this file the only place that talks to the platform, and a
    `window` property assigned anywhere else would be a second path to it. */
type BackBridge = { __chayoteHandleBack__?: () => boolean };

/** Install the handler the Android back button asks, returning whether it consumed
    the press.

    `06-platform.md` §4.4: back walks the view stack and at the root it is the
    platform's job. Returning `false` at the root is what lets `MainActivity.kt`
    hand the press back to Tauri, whose default backgrounds or finishes the task —
    the app never decides when to exit.

    Why Kotlin and not an event: Tauri 2.12 has no JavaScript-reachable back
    button. `AppPlugin.hasListener` reads a Java-only map that `listen()` from JS
    never populates, `Plugin.trigger` sends only to Java channels, and
    `WryActivity.handleBackNavigation` installs `goBack`-or-finish rather than
    reaching the web layer. §4.4 records the evidence.

    Rejects a handler that throws rather than letting a broken one eat the back
    button: the press would then do nothing at all, which is the failure this
    whole path exists to remove. */
export function installBackHandler(handler: () => boolean): () => void {
  if (!isTauri) return () => {};
  const bridge = window as Window & BackBridge;
  const wrapper = (): boolean => {
    try {
      return handler();
    } catch {
      return false;
    }
  };
  bridge.__chayoteHandleBack__ = wrapper;
  return () => {
    if (bridge.__chayoteHandleBack__ === wrapper) {
      delete bridge.__chayoteHandleBack__;
    }
  };
}

export { isTauri };
