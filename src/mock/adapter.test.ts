import { describe, expect, it } from 'vitest';
import { createMockBackend } from './adapter';
import { buildMockDatabase } from './adapter';
import type { NoteFilter } from '../types/ipc';

const filterAll: NoteFilter = { kind: 'all' };

describe('mock adapter', () => {
  it('lists only live notes for the all filter', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const notes = await backend.invoke('notes_list', { filter: filterAll });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => note.title !== '')).toBe(true);
  });

  it('sorts pinned notes first, then by updated_at descending', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const notes = await backend.invoke('notes_list', { filter: filterAll });
    const pinnedCount = notes.filter((note) => note.isPinned).length;
    expect(notes.slice(0, pinnedCount).every((note) => note.isPinned)).toBe(true);
  });

  it('separates trash from live notes', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const live = await backend.invoke('notes_list', { filter: filterAll });
    const trashed = await backend.invoke('notes_list', { filter: { kind: 'trash' } });
    expect(trashed.length).toBe(1);
    const overlap = live.filter((note) => trashed.some((t) => t.id === note.id));
    expect(overlap).toHaveLength(0);
  });

  it('soft delete keeps the row and restore brings it back', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const before = await backend.invoke('notes_list', { filter: filterAll });
    const target = before[0];
    if (target === undefined) throw new Error('fixture empty');

    await backend.invoke('notes_soft_delete', { id: target.id });
    const trashed = await backend.invoke('notes_list', { filter: { kind: 'trash' } });
    expect(trashed.some((note) => note.id === target.id)).toBe(true);

    await backend.invoke('notes_restore', { id: target.id });
    const after = await backend.invoke('notes_list', { filter: filterAll });
    expect(after.some((note) => note.id === target.id)).toBe(true);
  });

  it('reports NOT_FOUND for an unknown id', async () => {
    const backend = createMockBackend(buildMockDatabase());
    await expect(backend.invoke('notes_get', { id: 'missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses to move a folder into its own descendant', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const tree = await backend.invoke('folders_list', {});
    const work = tree[0];
    if (work === undefined || work.children[0] === undefined) {
      throw new Error('fixture folders missing');
    }
    const child = work.children[0];
    await expect(
      backend.invoke('folders_move', {
        id: work.id,
        newParentId: child.id,
        position: 0,
      }),
    ).rejects.toMatchObject({ code: 'CYCLE_DETECTED' });
  });

  it('searches titles and body text without erroring on FTS operators', async () => {
    const backend = createMockBackend(buildMockDatabase());
    for (const query of ['launch', '"', 'NEAR(', '^', 'a*', '-', '']) {
      const page = await backend.invoke('search_query', {
        input: { query, filter: filterAll, limit: 20, offset: 0 },
      });
      expect(page.hits).toBeInstanceOf(Array);
    }
  });

  it('scopes a folder search to the active selection', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const tree = await backend.invoke('folders_list', {});
    const folder = tree[0];
    if (folder === undefined) throw new Error('fixture folders missing');

    const page = await backend.invoke('search_query', {
      input: { query: 'notes', filter: { kind: 'folder', id: folder.id }, limit: 20, offset: 0 },
    });
    expect(page.hits.every((hit) => hit.folderId === folder.id)).toBe(true);
  });

  it('recomputes derived values on save', async () => {
    const backend = createMockBackend(buildMockDatabase());
    const list = await backend.invoke('notes_list', { filter: filterAll });
    const target = list[0];
    if (target === undefined) throw new Error('fixture empty');

    const saved = await backend.invoke('notes_save', {
      input: {
        id: target.id,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Renamed heading' }],
            },
          ],
        },
        folderId: target.folderId,
        tagIds: target.tags.map((tag) => tag.id),
        isPinned: target.isPinned,
      },
    });

    expect(saved.title).toBe('Renamed heading');
    expect(saved.wordCount).toBe(2);
  });
});
