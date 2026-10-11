import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

/* Where a status-bar popover goes.

   Measured by the caller in its click handler rather than by the popover in an
   effect: the geometry is available at the click, and an effect that reads the DOM
   and then sets state is a second render for a value already in hand — plus a frame
   of the popover painted in the wrong place.

   The status bar sits at the bottom of the window, so this always opens upward and
   the only variable is how far. The horizontal offset is the anchor's own left edge
   rather than a guess, so it stays put as the editor pane is resized — except on
   a narrow viewport, where a 260 px panel at the anchor's edge parks against the
   right screen edge with a sliver of margin. There it is centred instead: at
   360 px the anchor's position says nothing worth following, and a centred panel
   is reachable by either thumb.

   In its own module because it is the one piece of geometry here that is not
   component behaviour, and a component file exporting a function makes every edit to
   it reload the editor. */
export function popoverPlacement(anchor: HTMLElement): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect();
  const top = Math.max(8, rect.top - POPOVER_MAX_HEIGHT - 8);
  /* Width-based, not breakpoint-based: a phone in landscape is 800 px wide with
     room to spare, and only the narrow portrait viewport needs centring. */
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
/* Below this width the anchor-relative panel would hug the screen edge, so the
   popover is centred. Deliberately its own constant rather than the layout's
   `MOBILE_MAX`: that one answers which navigation tree mounts, this one answers
   whether a fixed-width panel fits beside its anchor — a phone in landscape is
   mobile and wide. */
const NARROW_VIEWPORT = 768;

/** The folder tree flattened for a listbox.
    A tree rendered as a flat list with indentation is what a listbox needs, and the
    folder tree's own nested `role="treeitem"` rendering is neither reusable nor
    correct here — a picker is not a tree. */
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