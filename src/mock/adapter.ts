import type {
  Backend,
  CommandArgs,
  CommandName,
  CommandOutput,
  NoteFilter,
  Selection,
} from '../types/ipc';
import type { Uuid } from '../types/note';
import { EMPTY_DOC } from '../types/note';
import type { MockDatabase, MockFolder, MockNote } from './derive';
import { capTitle, deriveTitle, plainTextOf, toNote, toSummary, toTree } from './derive';
import { matchesTokens, rankFor, snippetFor, toSearchTokens } from './search';
import { buildDatabase, uuidFrom } from './generate';
import { MockBackendError, cycleDetected, notFound, unreachable, validation } from './errors';
import { EMPTY_NOTE, FIXTURE_NOTES, FIXTURE_NOW, FIXTURE_TRASH, liftLeadingHeading } from './fixtures';

function nowMs(): number {
  return Date.now();
}

const MOCK_VERSION = '0.2.1';

const MOCK_UPDATE = {
  version: '0.3.0',
  date: '2026-10-17T09:00:00Z',
};

export type MockUpdateFeed =
  | 'none'
  | 'available'
  | 'unsupported'
  | 'offline'
  | 'needs-permission';

export type MockOptions = {
  updateFeed: MockUpdateFeed;
};

export const DEFAULT_MOCK_OPTIONS: MockOptions = { updateFeed: 'none' };

function matchesFilter(note: MockNote, filter: Selection): boolean {
  switch (filter.kind) {
    case 'trash':
      return note.deletedAt !== null;
    case 'all':
      return note.deletedAt === null;
    case 'pinned':
      return note.deletedAt === null && note.isPinned;
    case 'folder':
      return note.deletedAt === null && note.folderId === filter.id;
    case 'tag':
      return note.deletedAt === null && note.tagIds.includes(filter.id);
  }
}

function sortNotes(notes: MockNote[], filter: Selection): MockNote[] {
  if (filter.kind === 'trash') {
    return [...notes].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  }
  return [...notes].sort(
    (a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt,
  );
}

function foldCase(value: string): string {
  return value.toLocaleLowerCase();
}

export function createMockBackend(
  db: MockDatabase,
  options: MockOptions = DEFAULT_MOCK_OPTIONS,
): Backend {
  const state = db;
  const syncState = { connectionString: '', enabled: false };

  const liveNotes = (): MockNote[] => state.notes;

  const requireNote = (id: Uuid): MockNote => {
    const note = state.notes.find((candidate) => candidate.id === id);
    if (note === undefined) {
      throw notFound();
    }
    return note;
  };

  const bySelection = (filter: NoteFilter): MockNote[] => {
    const matched = liveNotes().filter((note) => matchesFilter(note, filter));
    const ordered = sortNotes(matched, filter);
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? ordered.length;
    return ordered.slice(offset, offset + limit);
  };

  const handlers: {
    [C in CommandName]: (args: CommandArgs[C]) => CommandOutput[C];
  } = {
    notes_list: ({ filter }) => bySelection(filter).map((note) => toSummary(note, state)),

    notes_get: ({ id }) => toNote(requireNote(id), state),

    notes_create: ({ folderId }) => {
      const timestamp = nowMs();
      const note: MockNote = {
        id: uuidFrom(`n-${timestamp}-${state.notes.length}`),
        doc: EMPTY_DOC,
        title: '',
        titleSource: 'auto',
        folderId,
        isPinned: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        tagIds: [],
      };
      state.notes.push(note);
      return toNote(note, state);
    },

    notes_save: ({ input }) => {
      const existing = state.notes.find((note) => note.id === input.id);
      const timestamp = nowMs();
      const saved: MockNote = {
        id: input.id,
        doc: input.doc,
        title: existing?.title ?? '',
        titleSource: existing?.titleSource ?? 'auto',
        folderId: input.folderId,
        isPinned: existing?.isPinned ?? false,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        deletedAt: existing?.deletedAt ?? null,
        tagIds: [...input.tagIds],
      };
      if (existing === undefined) {
        throw notFound();
      }
      Object.assign(existing, saved);
      return toNote(existing, state);
    },

    notes_move: ({ id, folderId }) => {
      const note = requireNote(id);
      if (folderId !== null && !state.folders.some((folder) => folder.id === folderId)) {
        throw notFound();
      }
      note.folderId = folderId;
      note.updatedAt = nowMs();
      return toNote(note, state);
    },

    notes_set_pinned: ({ id, isPinned }) => {
      const note = requireNote(id);
      note.isPinned = isPinned;
      note.updatedAt = nowMs();
      return toNote(note, state);
    },

    notes_set_title: ({ id, title }) => {
      const note = requireNote(id);
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        note.title = '';
        note.titleSource = 'auto';
      } else {
        note.title = capTitle(trimmed);
        note.titleSource = note.title.length > 0 ? 'manual' : 'auto';
      }
      note.updatedAt = nowMs();
      return toNote(note, state);
    },

    notes_soft_delete: ({ id }) => {
      const note = requireNote(id);
      note.deletedAt = nowMs();
      note.updatedAt = note.deletedAt;
    },

    notes_restore: ({ id }) => {
      const note = requireNote(id);
      note.deletedAt = null;
      note.updatedAt = nowMs();
    },

    notes_destroy: ({ id }) => {
      requireNote(id);
      state.notes = state.notes.filter((note) => note.id !== id);
    },

    notes_empty_trash: () => {
      const trashed = state.notes.filter((note) => note.deletedAt !== null);
      state.notes = state.notes.filter((note) => note.deletedAt === null);
      return trashed.length;
    },

    folders_list: () => toTree(state.folders),

    folders_create: ({ name, parentId }) => {
      const clean = name.trim();
      if (clean.length === 0) {
        throw validation('Give the folder a name.');
      }
      if (parentId !== null && !state.folders.some((folder) => folder.id === parentId)) {
        throw notFound();
      }
      const siblings = state.folders.filter((folder) => folder.parentId === parentId);
      const folder = {
        id: uuidFrom(`f-${clean}-${siblings.length}`),
        name: clean,
        parentId,
        position: siblings.length,
      };
      state.folders.push(folder);
      return { ...folder, children: [] };
    },

    folders_rename: ({ id, name }) => {
      const folder = state.folders.find((candidate) => candidate.id === id);
      if (folder === undefined) {
        throw notFound();
      }
      const clean = name.trim();
      if (clean.length === 0) {
        throw validation('Give the folder a name.');
      }
      folder.name = clean;
      return { ...folder, children: [] };
    },

    folders_move: ({ id, newParentId, position }) => {
      const folder = state.folders.find((candidate) => candidate.id === id);
      if (folder === undefined) {
        throw notFound();
      }
      if (newParentId !== null && collectSubtree(state, id).includes(newParentId)) {
        throw cycleDetected();
      }
      if (
        newParentId !== null &&
        !state.folders.some((candidate) => candidate.id === newParentId)
      ) {
        throw notFound();
      }
      densifyFolders(state, newParentId, id, position);
      folder.parentId = newParentId;
      return { ...folder, children: [] };
    },

    folders_delete: ({ id }) => {
      if (!state.folders.some((candidate) => candidate.id === id)) {
        throw notFound();
      }
      const doomed = collectSubtree(state, id);
      const doomedSet = new Set(doomed);
      state.folders = state.folders.filter((folder) => !doomedSet.has(folder.id));
      state.notes = state.notes.map((note) =>
        note.folderId !== null && doomedSet.has(note.folderId) ? { ...note, folderId: null } : note,
      );
    },

    tags_list: () =>
      state.tags
        .map((tag) => ({ id: tag.id, name: tag.name, count: countNotes(state, tag.id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),

    tags_create: ({ name }) => {
      const clean = requireName(name, 'Give the tag a name.');
      const existing = state.tags.find((tag) => foldCase(tag.name) === foldCase(clean));
      if (existing !== undefined) {
        return { ...existing, count: countNotes(state, existing.id) };
      }
      const tag = { id: uuidFrom(`t-${clean}`), name: clean };
      state.tags.push(tag);
      return { ...tag, count: 0 };
    },

    tags_rename: ({ id, name }) => {
      const tag = state.tags.find((candidate) => candidate.id === id);
      if (tag === undefined) {
        throw notFound();
      }
      const clean = requireName(name, 'Give the tag a name.');
      if (state.tags.some((other) => other.id !== id && foldCase(other.name) === foldCase(clean))) {
        throw validation('A tag with that name already exists.');
      }
      tag.name = clean;
      return { ...tag, count: countNotes(state, tag.id) };
    },

    tags_delete: ({ id }) => {
      if (!state.tags.some((tag) => tag.id === id)) {
        throw notFound();
      }
      state.tags = state.tags.filter((tag) => tag.id !== id);
      state.notes = state.notes.map((note) =>
        note.tagIds.includes(id)
          ? { ...note, tagIds: note.tagIds.filter((tagId) => tagId !== id) }
          : note,
      );
    },

    search_query: ({ input }) => {
      const scoped = liveNotes().filter((note) => matchesFilter(note, input.filter));
      const tokens = toSearchTokens(input.query);

      if (tokens === null) {
        const ordered = sortNotes(scoped, input.filter);
        return {
          hits: ordered.slice(input.offset, input.offset + input.limit).map((note) => {
            const summary = toSummary(note, state);
            return { ...summary, rank: 0, snippet: summary.excerpt };
          }),
          total: ordered.length,
          nextOffset: null,
        };
      }

      const hits = scoped
        .map((note) => {
          const summary = toSummary(note, state);
          const body = plainTextOf(note.doc);
          if (!matchesTokens(`${summary.title} ${body}`, tokens)) return null;
          const rank = rankFor(summary.title, body, tokens);
          if (rank === null) return null;
          return { summary, rank, snippet: snippetFor(note.doc, tokens) };
        })
        .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
        .sort((a, b) => a.rank - b.rank);

      const page = hits.slice(input.offset, input.offset + input.limit);
      return {
        hits: page.map(({ summary, rank, snippet }) => ({ ...summary, rank, snippet })),
        total: hits.length,
        nextOffset: input.offset + page.length < hits.length ? input.offset + page.length : null,
      };
    },

    window_ready: () => undefined,

    sync_get_status: () => ({
      configured: syncState.connectionString.length > 0,
      enabled: syncState.enabled,
      pendingCount: 0,
      conflictCount: 0,
      lastSyncedAt: null,
      lastAttemptAt: null,
      lastError: null,
    }),

    sync_set_config: ({ connectionString, enabled }) => {
      const clean = connectionString.trim();
      if (!clean.startsWith('postgresql://') && !clean.startsWith('postgres://')) {
        throw validation(
          'That does not look like a Postgres connection string — it should start with postgresql://.',
        );
      }
      syncState.connectionString = clean;
      syncState.enabled = enabled;
    },

    sync_now: () => {
      if (!syncState.enabled || syncState.connectionString.length === 0) {
        throw validation(
          'Sync is not configured yet — paste a connection string under Settings → Sync.',
        );
      }
      return { pushed: 0, pulled: 0, conflicts: 0, deferred: 0, alreadyRunning: false };
    },

    sync_reupload: () => 0,

    sync_list_conflicts: () => [],

    sync_resolve_conflict: () => undefined,

    app_info: () => ({
      version: MOCK_VERSION,
      os:
        options.updateFeed === 'unsupported'
          ? 'macOS'
          : options.updateFeed === 'needs-permission'
            ? 'Android'
            : 'Linux',
      updatesSupported: options.updateFeed !== 'unsupported',
    }),

    updates_check: () => {
      if (options.updateFeed === 'offline') {
        throw unreachable();
      }
      const found = options.updateFeed === 'available' || options.updateFeed === 'needs-permission';
      return found ? MOCK_UPDATE : null;
    },

    updates_install: () => {
      if (options.updateFeed === 'offline') {
        throw unreachable();
      }
      if (options.updateFeed === 'needs-permission') {
        throw new MockBackendError(
          'UPDATE_PERMISSION_REQUIRED',
          'Android has not been allowed to install updates for Chayote yet.',
        );
      }
      return undefined;
    },
  };

  function invoke<C extends CommandName>(
    command: C,
    args: CommandArgs[C],
  ): Promise<CommandOutput[C]> {
    try {
      return Promise.resolve(handlers[command](args));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return { invoke };
}

function densifyFolders(
  db: MockDatabase,
  parentId: Uuid | null,
  movingId: Uuid,
  target: number,
): void {
  const siblings = db.folders
    .filter((folder) => folder.parentId === parentId && folder.id !== movingId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  const index = Math.max(0, Math.min(target, siblings.length));
  const ordered = [...siblings];
  ordered.splice(index, 0, db.folders.find((folder) => folder.id === movingId) as MockFolder);

  ordered.forEach((folder, position) => {
    folder.position = position;
  });
}

function countNotes(db: MockDatabase, tagId: Uuid): number {
  return db.notes.filter((note) => note.deletedAt === null && note.tagIds.includes(tagId)).length;
}

function requireName(raw: string, message: string): string {
  const clean = raw.trim();
  if (clean.length === 0) {
    throw validation(message);
  }
  return clean;
}

function collectSubtree(db: MockDatabase, rootId: Uuid): Uuid[] {
  const found: Uuid[] = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const folder of db.folders) {
      if (folder.parentId === current) {
        found.push(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return found;
}

export function buildMockDatabase(): MockDatabase {
  const generated = buildDatabase({ noteCount: 0 });
  return {
    folders: generated.folders,
    tags: generated.tags,
    notes: [FIXTURE_NOTES, FIXTURE_TRASH, [EMPTY_NOTE]].flat().map(liftLeadingHeading),
  };
}

export function buildEmptyMockDatabase(): MockDatabase {
  return { folders: [], tags: [], notes: [] };
}

export { deriveTitle, FIXTURE_NOW };
