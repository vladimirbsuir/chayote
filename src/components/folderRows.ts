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

/* ------------------------------------------------------------------ *
 *  Drag to re-parent and reorder — `05-ui-ux.md` §6.3
 * ------------------------------------------------------------------ */

/** Where in a row a drop landed. Three bands, because a 26 px row cannot also carry
    two separate hit targets and a user aiming for "into" must not get "above"
    instead.

    `before` and `after` reorder among siblings; `inside` makes the row the new
    parent. */
export type DropZone = 'before' | 'inside' | 'after';

/** The fraction of the row at each end that means "beside" rather than "inside".
    A quarter each, leaving half the row for "into" — re-parenting is the rarer
    intent but needs a target big enough to hit, and thirds would have left it under
    nine pixels on a 26 px row. */
const EDGE_BAND = 1 / 4;

export function dropZoneAt(offsetY: number, rowHeight: number): DropZone {
  if (rowHeight <= 0) return 'inside';
  const ratio = offsetY / rowHeight;
  if (ratio < EDGE_BAND) return 'before';
  if (ratio > 1 - EDGE_BAND) return 'after';
  return 'inside';
}

/** What a drop resolves to, in the terms `folders_move` takes. `null` when the drop
    is not a move at all — the folder is already there, so writing it would burn a
    database transaction and an outbox row to change nothing. */
export type DropMove = { newParentId: Uuid | null; position: number };

/** Translate a drop into the parent and sibling index `folders_move` expects.
    `position` is sibling-local and the backend densifies it (`03-data-model.md`
    §3.2), so the only thing to get right here is *which* slot, counted among the
    destination's current children.

    The dragged folder is removed from its old slot before the new index is counted.
    That is the whole reason reordering is fiddly: moving a folder down among its
    own siblings shifts every sibling below it up one, so counting without removing
    first lands one row too far. */
export function resolveDrop(
  rows: FolderRow[],
  draggedId: Uuid,
  targetId: Uuid,
  zone: DropZone,
): DropMove | null {
  const target = rows.find((row) => row.node.id === targetId);
  const dragged = rows.find((row) => row.node.id === draggedId);
  if (target === undefined || dragged === undefined) return null;

  if (zone === 'inside') {
    if (targetId === draggedId) return null;
    /* Dropping onto one's own descendant would detach the subtree from the tree
       entirely, so it is refused here rather than sent and refused in Rust: the
       user gets the explanation while the pointer is still down, and no write is
       attempted for something that cannot succeed. */
    if (isDescendant(rows, draggedId, targetId)) return null;
    /* A child goes to the end of the destination's children. `append` is expressed
       as the current count, which is also what "after the last one" means. */
    return { newParentId: targetId, position: rows.filter((row) => row.parentId === targetId).length };
  }

  const parentId = target.parentId;
  const siblings = rows
    .filter((row) => row.parentId === parentId)
    .map((row) => row.node.id);

  /* The index this folder would occupy if it were dropped exactly on the target
     row's own position: either just before it or just after. */
  const targetIndex = siblings.indexOf(targetId);
  if (targetIndex === -1) return null;
  const insertAt = zone === 'before' ? targetIndex : targetIndex + 1;

  /* Dropped on its own row: the folder is already exactly there, in either
     direction. Counting the `after` case would insert it after itself and shift it
     down one sibling, which is a move the user did not ask for. */
  if (draggedId === targetId) return null;

  /* The dragged folder leaves its old slot before the new index is counted, so
     dropping it lower among its own siblings does not land one row too far. */
  const withoutDragged = siblings.filter((id) => id !== draggedId);
  const position = Math.min(insertAt, withoutDragged.length);

  /* Already in that slot: nothing to write. Reordering a folder onto itself, or
     onto the row it already occupies, must not burn a transaction and an outbox
     row to change nothing. */
  const currentIndex = siblings.indexOf(draggedId);
  if (currentIndex !== -1 && currentIndex === position) return null;

  return { newParentId: parentId, position };
}

/** Is `candidate` the folder `rootId` or somewhere below it, in the whole tree
    rather than the visible rows?

    The shell needs this after a move, where the question is about the selected
    folder's *contents* and the collapsed state is irrelevant — a selection naming a
    folder inside the moved subtree still resolves, it just resolves to something
    different than it did a moment ago. */
export function isInsideSubtree(
  nodes: FolderNode[],
  rootId: Uuid,
  candidate: Uuid,
): boolean {
  const root = findSubtree(nodes, rootId);
  if (root === null) return false;
  if (root.id === candidate) return true;

  const walk = (list: FolderNode[]): boolean => {
    for (const node of list) {
      if (node.id === candidate) return true;
      if (walk(node.children)) return true;
    }
    return false;
  };
  /* The search starts at `root`, not at the top of the tree. Searching the whole
     tree would answer "does this folder exist anywhere", which is a different
     question and true for every folder in the database. */
  return walk(root.children);
}

function findSubtree(nodes: FolderNode[], rootId: Uuid): FolderNode | null {
  for (const node of nodes) {
    if (node.id === rootId) return node;
    const hit = findSubtree(node.children, rootId);
    if (hit !== null) return hit;
  }
  return null;
}

/** Is `candidate` below `ancestor` in the visible row list? True for a strict
    descendant only — a folder is not its own descendant, though
    `folders_move` treats dropping onto itself as a cycle too, and the row code
    refuses `zone === 'inside'` on the dragged row for that reason. */
export function isDescendant(rows: FolderRow[], ancestorId: Uuid, candidateId: Uuid): boolean {
  const byId = new Map(rows.map((row) => [row.node.id, row]));
  let current = byId.get(candidateId);
  while (current !== undefined) {
    if (current.parentId === ancestorId) return true;
    if (current.parentId === null) return false;
    current = byId.get(current.parentId);
  }
  return false;
}

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