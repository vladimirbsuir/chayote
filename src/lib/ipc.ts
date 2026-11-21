import type { Backend, CommandArgs, CommandName, CommandOutput } from '../types/ipc';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';
import type { Note, NoteFilter, NoteSummary, SaveNoteInput } from '../types/ipc';
import type { SearchInput, SearchPage } from '../types/search';
import type { SyncConflict, SyncStatus, SyncSummary } from '../types/sync';
import type { AppInfo, DownloadEvent, UpdateSummary } from '../types/update';
import type { Channel } from '@tauri-apps/api/core';
import type { Uuid } from '../types/note';
import {
  DEFAULT_MOCK_OPTIONS,
  buildEmptyMockDatabase,
  buildMockDatabase,
  createMockBackend,
} from '../mock/adapter';
import type { MockOptions } from '../mock/adapter';
import type { MockDatabase } from '../mock/derive';

export { cycleDetected, MockBackendError, notFound } from '../mock/errors';

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

function mockSeedFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('seed');
}

function mockDatabaseForSeed(seed: string | null): MockDatabase {
  return seed === 'empty' ? buildEmptyMockDatabase() : buildMockDatabase();
}

function mockOptionsForSeed(seed: string | null): MockOptions {
  if (seed === 'update') return { updateFeed: 'available' };
  if (seed === 'no-updates') return { updateFeed: 'unsupported' };
  if (seed === 'offline') return { updateFeed: 'offline' };
  if (seed === 'needs-permission') return { updateFeed: 'needs-permission' };
  return DEFAULT_MOCK_OPTIONS;
}

function resolve(): Backend {
  if (active !== null) return active;
  if (import.meta.env.DEV && !isTauri) {
    const seed = mockSeedFromUrl();
    active = createMockBackend(mockDatabaseForSeed(seed), mockOptionsForSeed(seed));
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
  setTitle: (id: Uuid, title: string): Promise<Note> => invoke('notes_set_title', { id, title }),
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

export const syncApi = {
  status: (): Promise<SyncStatus> => invoke('sync_get_status', {}),
  setConfig: (connectionString: string, enabled: boolean): Promise<void> =>
    invoke('sync_set_config', { connectionString, enabled }),
  now: (openNoteId: Uuid | null): Promise<SyncSummary> => invoke('sync_now', { openNoteId }),
  reupload: (): Promise<number> => invoke('sync_reupload', {}),
  conflicts: (): Promise<SyncConflict[]> => invoke('sync_list_conflicts', {}),
  resolve: (id: string, keepLocal: boolean): Promise<void> =>
    invoke('sync_resolve_conflict', { id, keepLocal }),
};

export const windowApi = {
  ready: (): Promise<void> => invoke('window_ready', {}),
};

export const updatesApi = {
  info: (): Promise<AppInfo> => invoke('app_info', {}),
  check: (): Promise<UpdateSummary | null> => invoke('updates_check', {}),
  install: async (onEvent: (event: DownloadEvent) => void): Promise<void> => {
    await invoke('updates_install', {
      onEvent: isTauri ? await buildChannel(onEvent) : onEvent,
    });
  },
};

async function buildChannel(
  onEvent: (event: DownloadEvent) => void,
): Promise<Channel<DownloadEvent>> {
  const { Channel } = await import('@tauri-apps/api/core');
  return new Channel<DownloadEvent>(onEvent);
}

export function onWindowCloseRequested(flush: () => Promise<void>): () => void {
  if (!isTauri) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
    const stop = await getCurrentWindow().onCloseRequested(async () => {
      await flush().catch(() => {});
    });
    if (cancelled) stop();
    else unlisten = stop;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

type BackBridge = { __chayoteHandleBack__?: () => boolean };

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
