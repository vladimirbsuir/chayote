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

/** The version the browser fallback reports. `tauri.conf.json` says `0.2.1`;
    it is restated here rather than imported because the frontend cannot read a
    file from `src-tauri`, and a build that drifted from the real one would show
    a version the app does not have. Bumping the release means bumping this and
    `MOCK_UPDATE.version` below, which must stay above it. */
const MOCK_VERSION = '0.2.1';

/** The one update the fallback can offer, for `?seed=update`. */
const MOCK_UPDATE = {
  version: '0.3.0',
  notes: 'Faster search, and the Updates tab.',
  date: '2026-10-17T09:00:00Z',
};

/** Which updater story the fallback tells.
    - `none` — supported, and nothing newer. The everyday case.
    - `available` — supported, with 0.3.0 waiting. The install path.
    - `unsupported` — cannot update at all, as on macOS (`06-platform.md` §3.8).
      The disabled button and its reason.
    - `offline` — supported, but the endpoint cannot be reached. A failure is a
      screen like any other and has to be reachable in a browser.
    - `needs-permission` — Android's `UPDATE_PERMISSION_REQUIRED` (ADR-025).
      Not a failure, and the tab words and styles it differently, so it needs to
      be a screen of its own rather than something a test has to provoke. */
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
      /* The title is kept, not re-derived: a typed one is not derivable from the
         document, so a save that recomputed it would blank the field on the next
         keystroke in the body. The Rust `save` reads the same two columns. */
      const saved: MockNote = {
        id: input.id,
        doc: input.doc,
        title: existing?.title ?? '',
        titleSource: existing?.titleSource ?? 'auto',
        folderId: input.folderId,
        isPinned: input.isPinned,
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

    /* No document in the input, and none loaded: the note list carries only a
       summary, so pinning from a card must not put a body on the write path.
       `updatedAt` moves with the flag, matching the Rust `set_pinned` — a pinned
       note sorts above everything, so pinning one changes where it appears in
       every list. */
    notes_set_pinned: ({ id, isPinned }) => {
      const note = requireNote(id);
      note.isPinned = isPinned;
      note.updatedAt = nowMs();
      return toNote(note, state);
    },

    notes_set_title: ({ id, title }) => {
      const note = requireNote(id);
      const trimmed = title.trim();
      /* Empty is not a note with no name — it is the note handing the title back
         to derivation, which needs the document. One write either way: no
         document on the write path, and no derived column recomputed, matching the
         Rust `set_title`. */
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
      // `position` is sibling-local and densified, matching the Rust side.
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
        // Zero-count tags stay listed (ADR-021): tags can be created before any
        // note carries them. Counts still exclude trashed notes (countNotes).
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
      tag.name = requireName(name, 'Give the tag a name.');
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

      /* Sanitisation yielding nothing is not an error: `03-data-model.md` §3.6
         falls back to the active filter ordered by recency, and the Rust service
         does the same. Ordered after sorting rather than before, so the fallback
         list is the one the user would have seen without the field. */
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
          /* The title is indexed beside the body, so a match in either counts.
             `matchesTokens` over both is what the JOIN in `03-data-model.md`
             §3.6 does; testing them separately would let a note match on a title
             and a different one on a body, which is not the same query. */
          if (!matchesTokens(`${summary.title} ${body}`, tokens)) return null;
          const rank = rankFor(summary.title, body, tokens);
          if (rank === null) return null;
          return { summary, rank, snippet: snippetFor(note.doc, tokens) };
        })
        .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
        /* bm25, not the pinned/updated order of the normal list — `05-ui-ux.md`
           §6.5, and the reason a search and a folder listing disagree. */
        .sort((a, b) => a.rank - b.rank);

      const page = hits.slice(input.offset, input.offset + input.limit);
      return {
        hits: page.map(({ summary, rank, snippet }) => ({ ...summary, rank, snippet })),
        total: hits.length,
        nextOffset: input.offset + page.length < hits.length ? input.offset + page.length : null,
      };
    },

    window_ready: () => undefined,

    /* Sync has no server in the browser fallback: the config round-trips in
       memory so the Settings Sync tab is drivable, and every other command
       answers the empty shape. `sync_set_config` validates like the Rust
       side so a bad string fails in a browser exactly where it fails on a
       device. */
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

    /* ADR-024. The updater has no endpoint in a browser, so the three commands
       answer from a fixed feed rather than a request. `updateFeed` is chosen by
       the caller — `ipc.ts` reads it off `?seed=` — because both the
       update-available and the cannot-update branch are real screens and neither
       is reachable from the default. */
    app_info: () => ({
      version: MOCK_VERSION,
      /* macOS is the only platform that cannot update (ADR-024, ADR-025), so it
         is the only one the unsupported feed needs to name. The grant feed
         reports Android, because the wording of that refusal is Android's and
         the pane branches on the platform name to choose it. */
      os:
        options.updateFeed === 'unsupported'
          ? 'macOS'
          : options.updateFeed === 'needs-permission'
            ? 'Android'
            : 'Linux',
      updatesSupported: options.updateFeed !== 'unsupported',
    }),

    updates_check: () => {
      /* `MockBackendError`, not a bare object: `only-throw-error` is right, and
         the tab's handling duck-types on `code` and `message` precisely so it
         works for an `Error` here and the bare `{ code, message }` a real
         rejected `invoke` carries. */
      if (options.updateFeed === 'offline') {
        throw unreachable();
      }
      /* `needs-permission` still finds an update. What it changes is what the
         *install* does with it, so a check that found nothing here would leave
         the grant branch with no Install button to be refused from. */
      const found = options.updateFeed === 'available' || options.updateFeed === 'needs-permission';
      return found ? MOCK_UPDATE : null;
    },

    /* Resolves rather than restarting anything: a browser has no process to
       replace, and the tab must reach its "installed" state to be testable at
       all. The channel arg is inert here — there is no transfer to report on. */
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

/// Sibling-local positions are densified on every move, so the list never
/// accumulates gaps. A no-op move leaves siblings untouched.
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

/// Trashed notes never count towards a tag, on either the Rust or the mock side.
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

/** The seeded database the browser fallback starts from: nested folders, tags
    with counts, pinned and unpinned notes, and one trashed note.

    Fixtures go through the same leading-heading lift migration `0006` applies, so
    the seeded library looks like a database that has been upgraded: each note's
    name lives in the field and not at the top of its text. A fixture left with a
    heading in its body would show the note's name twice in the editor and pin a
    state nothing will ever be in again. */
export function buildMockDatabase(): MockDatabase {
  const generated = buildDatabase({ noteCount: 0 });
  return {
    folders: generated.folders,
    tags: generated.tags,
    notes: [FIXTURE_NOTES, FIXTURE_TRASH, [EMPTY_NOTE]].flat().map(liftLeadingHeading),
  };
}

/** The empty database of ADR-014: zero folders, zero tags, zero notes.

    First launch is the first thing every user sees and it is a real screen, so
    it has to be reachable in a browser rather than only on a fresh install. The
    choice lives here rather than in a component so a test can ask for it and get
    the same thing a new device gets. */
export function buildEmptyMockDatabase(): MockDatabase {
  return { folders: [], tags: [], notes: [] };
}

export { deriveTitle, FIXTURE_NOW };
