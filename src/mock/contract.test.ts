import { describe, expect, it } from 'vitest';
import type { NoteFilter, SaveNoteInput } from '../types/ipc';
import type { SearchInput } from '../types/search';
import { buildMockDatabase, createMockBackend } from './adapter';

const all: NoteFilter = { kind: 'all' };

describe('mock adapter against the real command surface', () => {
  /* `10-conventions.md` §10 test 11: the mock returns the same shape as the
     real IPC for every command in `02-architecture.md` §7. The shapes here
     are the ones `src/types/ipc.ts` declares, which `src-tauri/src/tests.rs`
     asserts against the Rust side. */

  it('answers notes_list with summaries that carry no document body', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const notes = await backend.invoke('notes_list', { filter: all });

    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(Object.keys(note).sort()).toEqual([
        'excerpt',
        'folderId',
        'folderName',
        'id',
        'isPinned',
        'tags',
        'title',
        'updatedAt',
        'wordCount',
      ]);
      expect(typeof note.id).toBe('string');
      expect(typeof note.isPinned).toBe('boolean');
      expect(typeof note.updatedAt).toBe('number');
      expect(Array.isArray(note.tags)).toBe(true);
      expect(note).not.toHaveProperty('doc');
    }
  });

  it('answers notes_get with the document and its lifecycle timestamps', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const [first] = await backend.invoke('notes_list', { filter: all });
    if (first === undefined) throw new Error('fixture empty');

    const note = await backend.invoke('notes_get', { id: first.id });
    expect(note.doc.type).toBe('doc');
    expect(Array.isArray(note.doc.content)).toBe(true);
    expect(typeof note.createdAt).toBe('number');
    expect(note.deletedAt).toBeNull();
  });

  it('creates, saves, moves, deletes, restores and destroys', async () => {
    const backend = createMockBackend(buildMockDatabase());

    const created = await backend.invoke('notes_create', { folderId: null });
    expect(created.title).toBe('Untitled');
    expect(created.doc.type).toBe('doc');

    const input: SaveNoteInput = {
      id: created.id,
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Saved' }] },
        ],
      },
      folderId: null,
      tagIds: [],
      isPinned: true,
    };
    const saved = await backend.invoke('notes_save', { input });
    expect(saved.title).toBe('Saved');
    expect(saved.isPinned).toBe(true);

    await backend.invoke('notes_soft_delete', { id: created.id });
    await backend.invoke('notes_restore', { id: created.id });
    expect((await backend.invoke('notes_get', { id: created.id })).deletedAt).toBeNull();

    await expect(backend.invoke('notes_destroy', { id: created.id })).resolves.toBeUndefined();
    await expect(backend.invoke('notes_get', { id: created.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('types a title that derivation cannot take back, until the field is cleared', async () => {
    /* ADR-023, asserted against the browser backend because that is what the
       Playwright suite drives: a typed title survives a later document save, which
       is the half that silently broke before the Rust side read the stored
       column, and clearing it hands the title back to derivation rather than
       leaving the note nameless. */
    const backend = createMockBackend(buildMockDatabase());
    const created = await backend.invoke('notes_create', { folderId: null });

    const titled = await backend.invoke('notes_set_title', { id: created.id, title: '  Plan  ' });
    expect(titled.title).toBe('Plan');
    /* The body is untouched: the command writes the title without loading or
       rewriting a document. */
    expect(titled.doc).toEqual(created.doc);

    const saved = await backend.invoke('notes_save', {
      input: {
        id: created.id,
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A first line' }] }],
        },
        folderId: null,
        tagIds: [],
        isPinned: false,
      },
    });
    expect(saved.title).toBe('Plan');

    const cleared = await backend.invoke('notes_set_title', { id: created.id, title: '   ' });
    expect(cleared.title).toBe('A first line');

    await expect(
      backend.invoke('notes_set_title', { id: created.id, title: 'ok' }),
    ).resolves.toHaveProperty('title', 'ok');
    await expect(
      backend.invoke('notes_set_title', { id: '01980000-0000-7000-8000-999999999999', title: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('empties the trash and reports how many rows went', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const [first] = await backend.invoke('notes_list', { filter: all });
    if (first === undefined) throw new Error('fixture empty');

    await backend.invoke('notes_soft_delete', { id: first.id });
    const removed = await backend.invoke('notes_empty_trash', {});
    expect(typeof removed).toBe('number');
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await backend.invoke('notes_list', { filter: { kind: 'trash' } })).length).toBe(0);
  });

  it('answers the folder tree with the node shape the UI renders', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const tree = await backend.invoke('folders_list', {});

    expect(tree.length).toBeGreaterThan(0);
    for (const node of tree) {
      expect(Object.keys(node).sort()).toEqual(['children', 'id', 'name', 'parentId', 'position']);
      expect(Array.isArray(node.children)).toBe(true);
    }
    expect(tree.some((node) => node.children.length > 0)).toBe(true);
  });

  it('creates, renames, moves and deletes folders', async () => {
    const backend = createMockBackend(buildMockDatabase());

    const roots = await backend.invoke('folders_list', {});
    const folder = await backend.invoke('folders_create', { name: 'Scratch', parentId: null });
    expect(folder.name).toBe('Scratch');
    // A new root folder lands after the existing ones.
    expect(folder.position).toBe(roots.length);

    const renamed = await backend.invoke('folders_rename', { id: folder.id, name: 'Studio' });
    expect(renamed.name).toBe('Studio');

    const moved = await backend.invoke('folders_move', {
      id: folder.id,
      newParentId: null,
      position: 0,
    });
    expect(moved.position).toBe(0);
    expect((await backend.invoke('folders_list', {}))[0]?.id).toBe(folder.id);

    await expect(backend.invoke('folders_delete', { id: folder.id })).resolves.toBeUndefined();
  });

  it('creates, renames and deletes tags, with counts', async () => {
    const backend = createMockBackend(buildMockDatabase());

    const tag = await backend.invoke('tags_create', { name: 'urgent' });
    expect(tag.name).toBe('urgent');
    expect(typeof tag.count).toBe('number');

    const renamed = await backend.invoke('tags_rename', { id: tag.id, name: 'critical' });
    expect(renamed.name).toBe('critical');

    const listed = await backend.invoke('tags_list', {});
    for (const entry of listed) {
      expect(Object.keys(entry).sort()).toEqual(['count', 'id', 'name']);
    }

    await expect(backend.invoke('tags_delete', { id: tag.id })).resolves.toBeUndefined();
  });

  it('answers search_query with hits, a total and a cursor', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const input: SearchInput = {
      query: 'roadmap',
      filter: all,
      limit: 2,
      offset: 0,
    };
    const page = await backend.invoke('search_query', { input });

    expect(Object.keys(page).sort()).toEqual(['hits', 'nextOffset', 'total']);
    expect(typeof page.total).toBe('number');
    for (const hit of page.hits) {
      expect(Object.keys(hit).sort()).toEqual([
        'excerpt',
        'folderId',
        'folderName',
        'id',
        'isPinned',
        'rank',
        'snippet',
        'tags',
        'title',
        'updatedAt',
        'wordCount',
      ]);
      expect(typeof hit.rank).toBe('number');
      expect(typeof hit.snippet).toBe('string');
    }
  });

  it('acknowledges window_ready without a payload', async () => {
    const backend = createMockBackend(buildMockDatabase());
    await expect(backend.invoke('window_ready', {})).resolves.toBeUndefined();
  });

  /* ADR-024. `app_info` is the one updater command that exists on every
     platform, so its shape is the one a browser test and a device share. */
  it('answers app_info with the three fields the Updates tab renders from', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const info = await backend.invoke('app_info', {});
    expect(Object.keys(info).sort()).toEqual(['os', 'updatesSupported', 'version']);
    expect(typeof info.version).toBe('string');
    expect(info.version.length).toBeGreaterThan(0);
    expect(typeof info.os).toBe('string');
    expect(typeof info.updatesSupported).toBe('boolean');
  });

  it('reports no update on the default feed, and one when asked for it', async () => {
    const plain = createMockBackend(buildMockDatabase());
    await expect(plain.invoke('updates_check', {})).resolves.toBeNull();

    const seeded = createMockBackend(buildMockDatabase(), { updateFeed: 'available' });
    const found = await seeded.invoke('updates_check', {});
    expect(found).not.toBeNull();
    expect(Object.keys(found ?? {}).sort()).toEqual(['date', 'notes', 'version']);
    expect(typeof found?.version).toBe('string');
    expect(typeof found?.notes).toBe('string');
    /* `notes` is a string and never null: the pane has no use for a key it
       cannot render, and Rust already collapsed a missing one to "". */
    expect(found?.notes).not.toBeNull();
  });

  it('claims no update support on the unsupported feed, and says which platform', async () => {
    const backend = createMockBackend(buildMockDatabase(), { updateFeed: 'unsupported' });
    const info = await backend.invoke('app_info', {});
    expect(info.updatesSupported).toBe(false);
    expect(info.os).toBe('macOS');
  });

  /* The install resolves rather than replacing a process — there is nothing to
     restart in a browser — but it must resolve, or the tab's installed state
     would be unreachable outside Tauri. */
  it('resolves an install without a channel, matching the real command', async () => {
    const backend = createMockBackend(buildMockDatabase(), { updateFeed: 'available' });
    await expect(backend.invoke('updates_install', { onEvent: undefined })).resolves.toBeUndefined();
  });

  /* ADR-025: Android's grant is refused with a code of its own, because the tab
     words it as something to do rather than as a failure. A mock that reused
     `NETWORK` here would make that branch unreachable in a browser. */
  it('reports Android’s outstanding grant with its own code', async () => {
    const backend = createMockBackend(buildMockDatabase(), { updateFeed: 'needs-permission' });
    const info = await backend.invoke('app_info', {});
    expect(info.updatesSupported).toBe(true);
    expect(info.os).toBe('Android');
    await expect(backend.invoke('updates_install', { onEvent: undefined })).rejects.toMatchObject({
      code: 'UPDATE_PERMISSION_REQUIRED',
    });
  });

  it('fails every read command with a coded error for an unknown id', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const commands = [
      { run: () => backend.invoke('notes_get', { id: 'missing' }) },
      { run: () => backend.invoke('notes_save', { input: missingSave() }) },
      { run: () => backend.invoke('notes_move', { id: 'missing', folderId: null }) },
      { run: () => backend.invoke('notes_soft_delete', { id: 'missing' }) },
      { run: () => backend.invoke('notes_restore', { id: 'missing' }) },
      { run: () => backend.invoke('notes_destroy', { id: 'missing' }) },
      { run: () => backend.invoke('folders_rename', { id: 'missing', name: 'x' }) },
      { run: () => backend.invoke('folders_delete', { id: 'missing' }) },
      { run: () => backend.invoke('tags_rename', { id: 'missing', name: 'x' }) },
      { run: () => backend.invoke('tags_delete', { id: 'missing' }) },
    ];

    for (const { run } of commands) {
      await expect(run()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('refuses invalid input with VALIDATION, matching the Rust side', async () => {
    const backend = createMockBackend(buildMockDatabase());
    await expect(
      backend.invoke('folders_create', { name: '   ', parentId: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(backend.invoke('tags_create', { name: '' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

function missingSave(): SaveNoteInput {
  return {
    id: 'missing',
    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    folderId: null,
    tagIds: [],
    isPinned: false,
  };
}
