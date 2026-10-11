import { describe, expect, it } from 'vitest';
import { applySaveToList, compareSummaries } from './noteOrder';
import type { NoteSummary } from '../types/ipc';

/* `03-data-model.md` §5: `is_pinned DESC, updated_at DESC` everywhere but the
   trash. The editor patches saves into the cached lists without refetching, so
   the patch has to carry the ordering — otherwise an edit strands its note
   mid-list. These pin the comparator and the patch-then-sort contract,
   including the two orderings a save must not touch. */

function summary(overrides: Partial<NoteSummary> & { id: string }): NoteSummary {
  return {
    title: overrides.id,
    excerpt: '',
    folderId: null,
    folderName: null,
    isPinned: false,
    wordCount: 0,
    updatedAt: 0,
    tags: [],
    ...overrides,
  };
}

describe('compareSummaries', () => {
  it('sorts pinned above unpinned whatever the timestamps say', () => {
    const pinned = summary({ id: 'a', isPinned: true, updatedAt: 100 });
    const fresh = summary({ id: 'b', updatedAt: 9000 });
    expect(compareSummaries(pinned, fresh)).toBeLessThan(0);
    expect(compareSummaries(fresh, pinned)).toBeGreaterThan(0);
  });

  it('sorts newest first among equally pinned notes', () => {
    const old = summary({ id: 'a', updatedAt: 100 });
    const recent = summary({ id: 'b', updatedAt: 200 });
    expect(compareSummaries(recent, old)).toBeLessThan(0);
    expect(compareSummaries(old, recent)).toBeGreaterThan(0);
    expect(compareSummaries(old, { ...old })).toBe(0);
  });
});

describe('applySaveToList', () => {
  it('moves the edited note to the top of a live list', () => {
    const existing = [
      summary({ id: 'a', updatedAt: 300 }),
      summary({ id: 'b', updatedAt: 200 }),
      summary({ id: 'c', updatedAt: 100 }),
    ];

    const next = applySaveToList(existing, summary({ id: 'c', updatedAt: 400 }), 'all');

    expect(next.map((row) => row.id)).toEqual(['c', 'a', 'b']);
    /* The input is not mutated: it may be another cache's entry. */
    expect(existing.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a pinned note above a freshly edited unpinned one', () => {
    const existing = [
      summary({ id: 'a', isPinned: true, updatedAt: 100 }),
      summary({ id: 'b', updatedAt: 200 }),
    ];

    const next = applySaveToList(existing, summary({ id: 'b', updatedAt: 9000 }), 'all');

    expect(next.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('patches a trash list without re-sorting it', () => {
    /* Trash orders by `deleted_at`, which a save cannot change and summaries do
       not carry — sorting by updatedAt here would scramble deletion order. */
    const existing = [
      summary({ id: 'a', updatedAt: 300 }),
      summary({ id: 'b', updatedAt: 200 }),
    ];

    const next = applySaveToList(existing, summary({ id: 'b', title: 'Retitled', updatedAt: 9000 }), 'trash');

    expect(next.map((row) => row.id)).toEqual(['a', 'b']);
    expect(next[1]?.title).toBe('Retitled');
  });
});
