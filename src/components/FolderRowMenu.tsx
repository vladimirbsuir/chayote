import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import type { Uuid } from '../types/note';

/* The per-row overflow menu for a folder: rename, new subfolder, delete.
   `more-horizontal` from the `05-ui-ux.md` §3.3 inventory, which is what that icon
   is for.

   Why a menu rather than three always-visible icons: a 26 px row has room for the
   twisty, the folder glyph, the name, and a count. Three more controls would leave
   the name about forty pixels wide. A menu also matches §2.2's "right-click for
   menu", which is why the row opens this on right-click as well as on the button.

   **The items carry no icons.** The `05-ui-ux.md` §3.3 inventory is closed and has
   no pencil or edit glyph, and ADR-015 says adding an icon to the UI means adding
   it there first. Rather than grow the inventory for three verbs that are already
   words, the menu is text — which is also §1's rule that no icon sits where a word
   is clearer, applied to a menu whose items are three distinct English verbs.

    The menu is a `menu` with `menuitem`s rather than a list of buttons, because that
    is what lets the arrow keys move between items and `Esc` return focus to the row
    — the behaviour a user expects from a menu that opened under their cursor.

    Portalled against the viewport, like `NoteRowMenu`: the tree scrolls inside
    an `overflow` container, and a menu rendered in the row is clipped by it —
    the long-press menu on a phone arrived as a sliver. Placement is measured by
    the opener and arrives as a prop, never measured here in an effect. */

export type FolderMenuAction = 'rename' | 'create' | 'delete';

type FolderRowMenuProps = {
  folderId: Uuid;
  folderName: string;
  /** Viewport coordinates, measured by the row in the handler that opened the
      menu — the same contract as `NoteRowMenu`, for the same reason: an effect
      that measures and then sets state is a second render for geometry that
      was already in hand. */
  placement: { top: number; left: number };
  onAction: (action: FolderMenuAction, id: Uuid) => void;
  onClose: () => void;
};

export function FolderRowMenu({
  folderId,
  folderName,
  placement,
  onAction,
  onClose,
}: FolderRowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* Focus the first item on open, and hand focus back on close — both are what
     make the menu usable from the keyboard rather than only from the mouse that
     opened it. */
  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      document.querySelector<HTMLElement>(`[data-folder-id="${folderId}"]`)?.focus();
    },
    [folderId],
  );

  /* Outside press closes on `mousedown` (plus `click` for presses with no
     button-down) — the same contract as `NoteRowMenu`: never on `auxclick`,
     whose order against `contextmenu` differs by platform and shuts the
     just-opened menu where it lands after. */
  useEffect(() => {
    const onOutsidePress = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onOutsidePress);
    document.addEventListener('click', onOutsidePress);
    return () => {
      document.removeEventListener('mousedown', onOutsidePress);
      document.removeEventListener('click', onOutsidePress);
    };
  }, [onClose]);

  const items: ReadonlyArray<{ action: FolderMenuAction; label: string; danger: boolean }> = [
    { action: 'rename', label: 'Rename', danger: false },
    { action: 'create', label: 'New folder inside', danger: false },
    { action: 'delete', label: 'Delete', danger: true },
  ];

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${folderName} actions`}
      data-testid="folder-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

        event.preventDefault();
        event.stopPropagation();
        const current = itemRefs.current.findIndex((item) => item === document.activeElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const count = items.length;
        const next = (current === -1 ? 0 : current + delta + count) % count;
        itemRefs.current[next]?.focus();
      }}
      style={{ top: placement.top, left: placement.left }}
      /* Menu labels are chrome, not content: a hold on an item must press it,
         never select its text. */
      className="fixed z-50 min-w-[168px] overflow-hidden rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-pop)] select-none"
    >
      {items.map((item, index) => (
        <button
          key={item.action}
          ref={(element) => {
            itemRefs.current[index] = element;
            if (index === 0 && element !== null) firstItemRef.current = element;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-testid={`folder-menu-${item.action}`}
          onClick={() => {
            onAction(item.action, folderId);
          }}
          className={`block w-full px-3 py-[6px] text-left text-[13px] ${
            item.danger
              ? 'text-[var(--danger)] hover:bg-[var(--surface-sunken)]'
              : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** The row's own affordance. Kept out of the tab order (`tabIndex={-1}`) for the
    same reason the collapse twisty is: the row's own keydown handles the menu, so a
    stop between every folder row and its menu is one more thing to tab past for no
    gain. */
export function FolderMenuButton({
  folderName,
  onOpen,
}: {
  folderName: string;
  onOpen: (button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${folderName} actions`}
      aria-haspopup="menu"
      title={`${folderName} actions`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
      className="ml-auto grid h-[22px] w-[22px] flex-none place-items-center rounded text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
    >
      <MoreHorizontal className="icon i-16" aria-hidden="true" />
    </button>
  );
}
