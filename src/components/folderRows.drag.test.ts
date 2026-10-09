import { describe, expect, it } from 'vitest';
import {
  dropZoneAt,
  isDescendant,
  isInsideSubtree,
  resolveDrop,
  visibleFolderRows,
} from './folderRows';
import type { FolderNode } from '../types/folder';

/* `05-ui-ux.md` §6.3: "Reordering and re-parenting by drag; `position` values are
   densified in one transaction." The backend refuses a cycle and densifies; what the
   frontend owes is picking the right slot, and refusing the impossible drop before a
   write is attempted at all. */

function node(id: string, children: FolderNode[] = []): FolderNode {
  return { id, name: id, parentId: null, position: 0, children };
}

describe('drop zones', () => {
  it('reads the outer quarters as reorder and the middle half as re-parent', () => {
    /* A quarter each: re-parenting is the rarer intent but needs a target big
       enough to hit, and thirds would leave it under nine pixels on a 26 px row. */
    expect(dropZoneAt(1, 30)).toBe('before');
    expect(dropZoneAt(7, 30)).toBe('before');
    expect(dropZoneAt(8, 30)).toBe('inside');
    expect(dropZoneAt(15, 30)).toBe('inside');
    expect(dropZoneAt(21, 30)).toBe('inside');
    expect(dropZoneAt(23, 30)).toBe('after');
    expect(dropZoneAt(29, 30)).toBe('after');
  });

  it('treats a zero-height row as a re-parent rather than dividing by zero', () => {
    /* jsdom reports every rect as zero, and a NaN zone would silently drop every
       drag a test attempts. */
    expect(dropZoneAt(5, 0)).toBe('inside');
  });
});

describe('resolveDrop', () => {
  const rows = visibleFolderRows(
    [node('a', [node('a1'), node('a2')]), node('b'), node('c')],
    [],
  );

  it('re-parents onto a row when dropped in its middle', () => {
    expect(resolveDrop(rows, 'b', 'a', 'inside')).toEqual({ newParentId: 'a', position: 2 });
  });

  it('appends a new child after the destination existing ones', () => {
    /* `a` already holds a1 and a2, so a new child lands third. */
    expect(resolveDrop(rows, 'c', 'a', 'inside')?.position).toBe(2);
  });

  it('reorders to the top among siblings when dropped above one', () => {
    expect(resolveDrop(rows, 'c', 'a', 'before')).toEqual({ newParentId: null, position: 0 });
  });

  it('reorders downward without landing one row too far', () => {
    /* Moving `a` after `c` must count `a`'s own slot as removed first. Counting with
       it still in the list puts the answer past the end, which clamps to the slot it
       already occupies — the classic off-by-one in tree reordering, and one that
       looks like the drag simply did not work. */
    expect(resolveDrop(rows, 'a', 'c', 'after')).toEqual({ newParentId: null, position: 2 });
  });

  it('reorders a middle folder past its neighbour in both directions', () => {
    expect(resolveDrop(rows, 'b', 'c', 'after')).toEqual({ newParentId: null, position: 2 });
    expect(resolveDrop(rows, 'c', 'b', 'before')).toEqual({ newParentId: null, position: 1 });
  });

  it('reorders within a nested level, not just at the root', () => {
    expect(resolveDrop(rows, 'a2', 'a1', 'before')).toEqual({ newParentId: 'a', position: 0 });
    expect(resolveDrop(rows, 'a1', 'a2', 'after')).toEqual({ newParentId: 'a', position: 1 });
  });

  it('refuses to re-parent a folder into itself', () => {
    /* `folders_move` would answer CYCLE_DETECTED; refusing here means no write is
       attempted for something that cannot succeed. */
    expect(resolveDrop(rows, 'a', 'a', 'inside')).toBeNull();
  });

  it('refuses to re-parent a folder into its own descendant', () => {
    /* M4's acceptance bar: "dragging a folder onto its own descendant is refused
       with an explanation". The backend enforces it too — this is the frontend half,
       so the refusal arrives while the pointer is still down. */
    expect(resolveDrop(rows, 'a', 'a1', 'inside')).toBeNull();
    expect(resolveDrop(rows, 'a', 'a2', 'inside')).toBeNull();
  });

  it('allows re-parenting a descendant out to the root', () => {
    expect(resolveDrop(rows, 'a1', 'c', 'before')).toEqual({ newParentId: null, position: 2 });
  });

  it('resolves to nothing when the folder is already in that slot', () => {
    /* Reordering a folder onto its own position must not burn a transaction and an
       outbox row to change nothing. */
    expect(resolveDrop(rows, 'a', 'a', 'before')).toBeNull();
    expect(resolveDrop(rows, 'a', 'a', 'after')).toBeNull();
    /* `b` sits directly after `a` already, so "after `a`" is where it is. */
    expect(resolveDrop(rows, 'b', 'a', 'after')).toBeNull();
  });

  it('still resolves a move that changes the order', () => {
    /* `c` is last and `a` is first, so "before `a`" is a real change — the
       counterpart to the case above, which would pass by accident if this one
       asserted nothing. */
    expect(resolveDrop(rows, 'c', 'a', 'before')).toEqual({ newParentId: null, position: 0 });
  });

  it('resolves to nothing for a row that is not visible', () => {
    const collapsed = visibleFolderRows([node('a', [node('a1')]), node('b')], ['a']);

    /* `a1` is inside a collapsed branch, so there is no row to drop onto. */
    expect(resolveDrop(collapsed, 'b', 'a1', 'inside')).toBeNull();
  });

  it('resolves to nothing when either folder is absent from the list', () => {
    expect(resolveDrop(rows, 'missing', 'a', 'inside')).toBeNull();
    expect(resolveDrop(rows, 'b', 'missing', 'inside')).toBeNull();
  });
});

describe('isDescendant', () => {
  const rows = visibleFolderRows([node('a', [node('a1', [node('a1x')])]), node('b')], []);

  it('is true for a strict descendant at any depth', () => {
    expect(isDescendant(rows, 'a', 'a1')).toBe(true);
    expect(isDescendant(rows, 'a', 'a1x')).toBe(true);
  });

  it('is false for a folder itself, a sibling, and an ancestor', () => {
    expect(isDescendant(rows, 'a', 'a')).toBe(false);
    expect(isDescendant(rows, 'a', 'b')).toBe(false);
    expect(isDescendant(rows, 'a1', 'a')).toBe(false);
  });

  it('cannot see a descendant hidden inside a collapsed branch', () => {
    /* Honest rather than clever: a collapsed subtree is not in the row list, so it
       cannot be dropped onto and does not need to be reasoned about. */
    const collapsed = visibleFolderRows([node('a', [node('a1', [node('a1x')])])], ['a']);

    expect(isDescendant(collapsed, 'a', 'a1x')).toBe(false);
  });
});

describe('isInsideSubtree', () => {
  /* The shell asks this after a move, where collapse state is irrelevant: a
     selection naming a folder inside the moved subtree still resolves, it just
     resolves to something different than it did a moment ago. */
  const nested: FolderNode[] = [node('a', [node('a1', [node('a1x')])]), node('b')];

  it('includes the folder itself', () => {
    expect(isInsideSubtree(nested, 'a', 'a')).toBe(true);
  });

  it('reaches a descendant however deep', () => {
    expect(isInsideSubtree(nested, 'a', 'a1x')).toBe(true);
  });

  it('excludes a sibling and a subtree root that is not in the tree', () => {
    expect(isInsideSubtree(nested, 'a', 'b')).toBe(false);
    expect(isInsideSubtree(nested, 'missing', 'a')).toBe(false);
  });
});