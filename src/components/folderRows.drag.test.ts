import { describe, expect, it } from 'vitest';
import {
  dropZoneAt,
  isDescendant,
  isInsideSubtree,
  resolveDrop,
  visibleFolderRows,
} from './folderRows';
import type { FolderNode } from '../types/folder';

function node(id: string, children: FolderNode[] = []): FolderNode {
  return { id, name: id, parentId: null, position: 0, children };
}

describe('drop zones', () => {
  it('reads the outer quarters as reorder and the middle half as re-parent', () => {
    expect(dropZoneAt(1, 30)).toBe('before');
    expect(dropZoneAt(7, 30)).toBe('before');
    expect(dropZoneAt(8, 30)).toBe('inside');
    expect(dropZoneAt(15, 30)).toBe('inside');
    expect(dropZoneAt(21, 30)).toBe('inside');
    expect(dropZoneAt(23, 30)).toBe('after');
    expect(dropZoneAt(29, 30)).toBe('after');
  });

  it('treats a zero-height row as a re-parent rather than dividing by zero', () => {
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
    expect(resolveDrop(rows, 'c', 'a', 'inside')?.position).toBe(2);
  });

  it('reorders to the top among siblings when dropped above one', () => {
    expect(resolveDrop(rows, 'c', 'a', 'before')).toEqual({ newParentId: null, position: 0 });
  });

  it('reorders downward without landing one row too far', () => {
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
    expect(resolveDrop(rows, 'a', 'a', 'inside')).toBeNull();
  });

  it('refuses to re-parent a folder into its own descendant', () => {
    expect(resolveDrop(rows, 'a', 'a1', 'inside')).toBeNull();
    expect(resolveDrop(rows, 'a', 'a2', 'inside')).toBeNull();
  });

  it('allows re-parenting a descendant out to the root', () => {
    expect(resolveDrop(rows, 'a1', 'c', 'before')).toEqual({ newParentId: null, position: 2 });
  });

  it('resolves to nothing when the folder is already in that slot', () => {
    expect(resolveDrop(rows, 'a', 'a', 'before')).toBeNull();
    expect(resolveDrop(rows, 'a', 'a', 'after')).toBeNull();
    expect(resolveDrop(rows, 'b', 'a', 'after')).toBeNull();
  });

  it('still resolves a move that changes the order', () => {
    expect(resolveDrop(rows, 'c', 'a', 'before')).toEqual({ newParentId: null, position: 0 });
  });

  it('resolves to nothing for a row that is not visible', () => {
    const collapsed = visibleFolderRows([node('a', [node('a1')]), node('b')], ['a']);

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
    const collapsed = visibleFolderRows([node('a', [node('a1', [node('a1x')])])], ['a']);

    expect(isDescendant(collapsed, 'a', 'a1x')).toBe(false);
  });
});

describe('isInsideSubtree', () => {
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