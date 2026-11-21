import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

export function popoverPlacement(anchor: HTMLElement): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect();
  const top = Math.max(8, rect.top - POPOVER_MAX_HEIGHT - 8);
  if (window.innerWidth < NARROW_VIEWPORT) {
    return { top, left: Math.max(8, (window.innerWidth - POPOVER_WIDTH) / 2) };
  }
  return {
    top,
    left: Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8),
  };
}

const POPOVER_WIDTH = 260;
const POPOVER_MAX_HEIGHT = 280;
const NARROW_VIEWPORT = 768;

export type FolderOption = { id: Uuid; name: string; depth: number };

export function flattenFolders(nodes: FolderNode[]): FolderOption[] {
  const out: FolderOption[] = [];
  const walk = (list: FolderNode[], depth: number): void => {
    for (const node of list) {
      out.push({ id: node.id, name: node.name, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}