import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

/* The folder tree flattened into the rows a user can actually see and reach with
   the keyboard. `05-ui-ux.md` §10 requires the tree pattern — arrows move,
   `Right` expands, `Left` collapses, `Enter` selects — and every one of those keys
   needs to know what row is next, which is a question about a flat list rather
   than about a recursive tree.

   Kept as pure functions in their own module so the traversal can be tested
   without a DOM: a depth-10 tree is the acceptance bar for M4 and jsdom cannot
   lay one out. */

export type FolderRow = {
  node: FolderNode;
  depth: number;
  parentId: Uuid | null;
  isCollapsed: boolean;
  /** Index of this row's first child in the flat list, or `-1` for a leaf. Lets
      `Right` jump into a subtree without re-walking it. */
  firstChildIndex: number;
  /** Number of siblings at this row's depth, including itself. `aria-setsize`. */
  setSize: number;
  /** One-based position among those siblings. `aria-posinset`. */
  posInSet: number;
};

/** Depth-first walk that stops at a collapsed node. A collapsed branch's
    descendants are absent from the list entirely, which is what makes them
    unreachable by arrow keys — the same fact that hides them on screen. */
export function visibleFolderRows(
  nodes: FolderNode[],
  collapsed: Uuid[],
): FolderRow[] {
  const rows: FolderRow[] = [];

  const walk = (list: FolderNode[], depth: number, parentId: Uuid | null): void => {
    list.forEach((node, index) => {
      const isCollapsed = collapsed.includes(node.id);
      const rowIndex = rows.length;
      rows.push({
        node,
        depth,
        parentId,
        isCollapsed,
        firstChildIndex: -1,
        setSize: list.length,
        posInSet: index + 1,
      });

      if (node.children.length === 0 || isCollapsed) return;

      const before = rows.length;
      walk(node.children, depth + 1, node.id);
      /* The first child is the row immediately after this one. Recorded after the
         recursion rather than predicted, so it stays correct if the walk ever
         skips a node. */
      const row = rows[rowIndex];
      if (row !== undefined && rows[before] !== undefined) {
        row.firstChildIndex = before;
      }
    });
  };

  walk(nodes, 0, null);
  return rows;
}

/** Count every folder strictly below `rootId`.
    `05-ui-ux.md` §6.3: deleting a folder with children needs a confirmation that
    *names the count*. Counting in the frontend rather than asking the backend is
    deliberate — the tree is already loaded, and a count the user can see before
    committing is the whole point of the confirmation. A folder's own notes are not
    counted: they survive as unfiled (`03-data-model.md` §3.3, `ON DELETE SET
    NULL`), so calling them descendants would be a lie. */
export function descendantCount(nodes: FolderNode[], rootId: Uuid): number {
  const find = (list: FolderNode[]): FolderNode | null => {
    for (const node of list) {
      if (node.id === rootId) return node;
      const hit = find(node.children);
      if (hit !== null) return hit;
    }
    return null;
  };

  const root = find(nodes);
  if (root === null) return 0;

  let count = 0;
  const walk = (list: FolderNode[]): void => {
    for (const node of list) {
      count += 1;
      walk(node.children);
    }
  };
  walk(root.children);
  return count;
}

export type TreeKeyAction =
  | { kind: 'move'; id: Uuid }
  | { kind: 'select'; id: Uuid }
  | { kind: 'expand'; id: Uuid }
  | { kind: 'collapse'; id: Uuid }
  | null;

/** Resolve one key press against the flat row list. Returns the action rather
    than performing it, so the caller owns focus and the selection store and this
    stays a pure decision.

    `Right` on an expanded branch moves into it, `Left` on a collapsed branch
    moves out to the parent — the WAI-ARIA tree behaviour, and the reason a
    keyboard user can reach a nested folder at all. */
export function treeKeyAction(
  rows: FolderRow[],
  focusedId: Uuid,
  key: string,
): TreeKeyAction {
  const index = rows.findIndex((row) => row.node.id === focusedId);
  /* `findIndex` returning a hit proves the row exists, and `noUncheckedIndexedAccess`
     is on, so this has to be a real check rather than an assertion. */
  const row = index === -1 ? undefined : rows[index];
  if (row === undefined) return null;

  const move = (target: number): TreeKeyAction => {
    const next = rows[target];
    return next === undefined ? null : { kind: 'move', id: next.node.id };
  };

  switch (key) {
    case 'ArrowDown':
      return move(index + 1);
    case 'ArrowUp':
      return move(index - 1);
    case 'ArrowRight': {
      if (row.node.children.length === 0) return null;
      return row.isCollapsed
        ? { kind: 'expand', id: row.node.id }
        : move(row.firstChildIndex);
    }
    case 'ArrowLeft': {
      if (!row.isCollapsed && row.node.children.length > 0) {
        return { kind: 'collapse', id: row.node.id };
      }
      return row.parentId === null ? null : { kind: 'move', id: row.parentId };
    }
    case 'Home':
      return move(0);
    case 'End':
      return move(rows.length - 1);
    case 'Enter':
    case ' ':
      return { kind: 'select', id: row.node.id };
    default:
      return null;
  }
}