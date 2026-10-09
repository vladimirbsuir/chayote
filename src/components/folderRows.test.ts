import { describe, expect, it } from 'vitest';
import { treeKeyAction, visibleFolderRows } from './folderRows';
import type { FolderNode } from '../types/folder';

/* `05-ui-ux.md` §10: the tree pattern — arrows move, `Right` expands, `Left`
   collapses, `Enter` selects. M4's acceptance bar is a depth-10 tree navigated by
   keyboard alone, so the traversal is tested as pure data rather than through the
   DOM: jsdom cannot lay out a tree and, more to the point, the traversal is the
   part that can be wrong independently of the rendering. */

function node(id: string, children: FolderNode[] = []): FolderNode {
  return { id, name: id, parentId: null, position: 0, children };
}

function child(id: string, parentId: string, children: FolderNode[] = []): FolderNode {
  return { id, name: id, parentId, position: 0, children };
}

/* depth: 0 → d, 1 → d/1, … 9 → d/9 — ten levels, the M4 acceptance bar. */
function deepTree(): FolderNode[] {
  const nodes: FolderNode[] = [node('d')];
  let current = nodes[0] as FolderNode;
  for (let depth = 1; depth < 10; depth += 1) {
    const next = child(`d/${depth}`, 'd');
    current.children.push(next);
    current = next;
  }
  return nodes;
}

describe('visibleFolderRows', () => {
  it('flattens depth-first so a row is followed by its own subtree', () => {
    const tree = [node('a', [node('a1', [node('a1x')]), node('a2')]), node('b')];

    expect(visibleFolderRows(tree, []).map((row) => row.node.id)).toEqual([
      'a',
      'a1',
      'a1x',
      'a2',
      'b',
    ]);
  });

  it('omits the descendants of a collapsed branch entirely', () => {
    const tree = [node('a', [node('a1'), node('a2')]), node('b')];

    expect(visibleFolderRows(tree, ['a']).map((row) => row.node.id)).toEqual(['a', 'b']);
  });

  it('records depth so indentation is derived from the row, not from recursion', () => {
    const rows = visibleFolderRows(deepTree(), []);

    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('points firstChildIndex at the first descendant so Right can enter a subtree', () => {
    const rows = visibleFolderRows(deepTree(), []);

    expect(rows[0]?.firstChildIndex).toBe(1);
    expect(rows[8]?.firstChildIndex).toBe(9);
  });

  it('leaves firstChildIndex at -1 for a leaf and for a collapsed branch', () => {
    const tree = [node('a', [node('a1')]), node('b')];
    const expanded = visibleFolderRows(tree, []);

    expect(expanded.find((row) => row.node.id === 'a1')?.firstChildIndex).toBe(-1);

    const collapsed = visibleFolderRows(tree, ['a']);
    expect(collapsed.find((row) => row.node.id === 'a')?.firstChildIndex).toBe(-1);
  });

  it('carries the parent id so Left can climb out of a branch', () => {
    const rows = visibleFolderRows(deepTree(), []);

    expect(rows[5]?.parentId).toBe('d/4');
    expect(rows[0]?.parentId).toBeNull();
  });

  it('reports sibling set size and position for aria-setsize and aria-posinset', () => {
    const tree = [node('a'), node('b'), node('c', [node('c1')])];
    const rows = visibleFolderRows(tree, []);

    expect(rows.find((row) => row.node.id === 'b')?.setSize).toBe(3);
    expect(rows.find((row) => row.node.id === 'b')?.posInSet).toBe(2);
    /* The child is alone among its siblings, so its set size is 1, not the
       parent's 3. */
    expect(rows.find((row) => row.node.id === 'c1')?.setSize).toBe(1);
    expect(rows.find((row) => row.node.id === 'c1')?.posInSet).toBe(1);
  });
});

describe('treeKeyAction', () => {
  const tree = [node('a', [node('a1'), node('a2')]), node('b')];

  it('moves down and up through the visible rows and stops at the ends', () => {
    const rows = visibleFolderRows(tree, []);

    expect(treeKeyAction(rows, 'a', 'ArrowDown')).toEqual({ kind: 'move', id: 'a1' });
    expect(treeKeyAction(rows, 'a1', 'ArrowUp')).toEqual({ kind: 'move', id: 'a' });
    expect(treeKeyAction(rows, 'a', 'ArrowUp')).toBeNull();
    expect(treeKeyAction(rows, 'b', 'ArrowDown')).toBeNull();
  });

  it('expands a collapsed branch on Right, then moves into it', () => {
    const collapsed = visibleFolderRows(tree, ['a']);
    expect(treeKeyAction(collapsed, 'a', 'ArrowRight')).toEqual({ kind: 'expand', id: 'a' });

    const expanded = visibleFolderRows(tree, []);
    expect(treeKeyAction(expanded, 'a', 'ArrowRight')).toEqual({ kind: 'move', id: 'a1' });
  });

  it('collapses an expanded branch on Left, then climbs to the parent', () => {
    const expanded = visibleFolderRows(tree, []);
    expect(treeKeyAction(expanded, 'a', 'ArrowLeft')).toEqual({ kind: 'collapse', id: 'a' });
    expect(treeKeyAction(expanded, 'a1', 'ArrowLeft')).toEqual({ kind: 'move', id: 'a' });
  });

  it('refuses to climb above a root folder', () => {
    expect(treeKeyAction(visibleFolderRows(tree, []), 'a', 'ArrowLeft')).toEqual({
      kind: 'collapse',
      id: 'a',
    });
    expect(treeKeyAction(visibleFolderRows(tree, []), 'b', 'ArrowLeft')).toBeNull();
  });

  it('does nothing on Right for a leaf, which has no subtree to enter', () => {
    expect(treeKeyAction(visibleFolderRows(tree, []), 'a2', 'ArrowRight')).toBeNull();
  });

  it('selects on Enter and on Space', () => {
    const rows = visibleFolderRows(tree, []);

    expect(treeKeyAction(rows, 'a1', 'Enter')).toEqual({ kind: 'select', id: 'a1' });
    expect(treeKeyAction(rows, 'a1', ' ')).toEqual({ kind: 'select', id: 'a1' });
  });

  it('jumps to the first and last visible row', () => {
    const rows = visibleFolderRows(tree, []);

    expect(treeKeyAction(rows, 'a1', 'End')).toEqual({ kind: 'move', id: 'b' });
    expect(treeKeyAction(rows, 'b', 'Home')).toEqual({ kind: 'move', id: 'a' });
  });

  it('ignores a key the tree does not bind, so text input still works', () => {
    const rows = visibleFolderRows(tree, []);

    expect(treeKeyAction(rows, 'a', 'a')).toBeNull();
    expect(treeKeyAction(rows, 'a', 'F2')).toBeNull();
    expect(treeKeyAction(rows, 'a', 'Escape')).toBeNull();
  });

  it('returns null for a row that is not in the list', () => {
    expect(treeKeyAction(visibleFolderRows(tree, []), 'missing', 'ArrowDown')).toBeNull();
  });

  it('reaches the tenth level of a depth-10 tree with arrows alone', () => {
    let rows = visibleFolderRows(deepTree(), []);
    let current = 'd';

    /* Nine presses to walk down nine levels. Every press has to land on a real
       row, which is what makes this an assertion about traversal rather than
       about the first row. */
    for (let press = 0; press < 9; press += 1) {
      const action = treeKeyAction(rows, current, 'ArrowDown');
      expect(action?.kind).toBe('move');
      current = action?.id ?? '';
    }
    expect(current).toBe('d/9');

    /* Climbing out of a chain alternates two behaviours, and both are needed to
       reach the root: the deepest node is a leaf, so `Left` on it climbs
       directly, while every node above it is an expanded branch, so `Left` first
       collapses it and only the next press climbs. The collapse removes the
       subtree from the row list, so each press after the first has to be resolved
       against the list *after* the toggle — which is the case the caller renders. */
    let collapsed: string[] = [];

    expect(treeKeyAction(rows, 'd/9', 'ArrowLeft')).toEqual({ kind: 'move', id: 'd/8' });
    current = 'd/8';

    for (let level = 8; level > 0; level -= 1) {
      expect(treeKeyAction(rows, current, 'ArrowLeft')).toEqual({
        kind: 'collapse',
        id: `d/${level}`,
      });
      collapsed = [...collapsed, `d/${level}`];
      rows = visibleFolderRows(deepTree(), collapsed);

      const climb = treeKeyAction(rows, current, 'ArrowLeft');
      expect(climb?.kind).toBe('move');
      current = climb?.id ?? '';
    }

    expect(current).toBe('d');
    /* The root refuses to climb further — there is nothing above it. */
    expect(treeKeyAction(rows, 'd', 'ArrowLeft')).toEqual({ kind: 'collapse', id: 'd' });
  });
});