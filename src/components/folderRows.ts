import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

export type FolderRow = {
  node: FolderNode;
  depth: number;
  parentId: Uuid | null;
  isCollapsed: boolean;
  firstChildIndex: number;
  setSize: number;
  posInSet: number;
};

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
      const row = rows[rowIndex];
      if (row !== undefined && rows[before] !== undefined) {
        row.firstChildIndex = before;
      }
    });
  };

  walk(nodes, 0, null);
  return rows;
}

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

export type DropZone = 'before' | 'inside' | 'after';

const EDGE_BAND = 1 / 4;

export function dropZoneAt(offsetY: number, rowHeight: number): DropZone {
  if (rowHeight <= 0) return 'inside';
  const ratio = offsetY / rowHeight;
  if (ratio < EDGE_BAND) return 'before';
  if (ratio > 1 - EDGE_BAND) return 'after';
  return 'inside';
}

export type DropMove = { newParentId: Uuid | null; position: number };

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
    if (isDescendant(rows, draggedId, targetId)) return null;
    return { newParentId: targetId, position: rows.filter((row) => row.parentId === targetId).length };
  }

  const parentId = target.parentId;
  const siblings = rows
    .filter((row) => row.parentId === parentId)
    .map((row) => row.node.id);

  const targetIndex = siblings.indexOf(targetId);
  if (targetIndex === -1) return null;
  const insertAt = zone === 'before' ? targetIndex : targetIndex + 1;

  if (draggedId === targetId) return null;

  const withoutDragged = siblings.filter((id) => id !== draggedId);
  const position = Math.min(insertAt, withoutDragged.length);

  const currentIndex = siblings.indexOf(draggedId);
  if (currentIndex !== -1 && currentIndex === position) return null;

  return { newParentId: parentId, position };
}

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

export function treeKeyAction(
  rows: FolderRow[],
  focusedId: Uuid,
  key: string,
): TreeKeyAction {
  const index = rows.findIndex((row) => row.node.id === focusedId);
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