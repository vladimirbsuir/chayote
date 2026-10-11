import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import type { Uuid } from '../types/note';

/* The per-row overflow menu for a tag: rename, delete. `more-horizontal` from
   the `05-ui-ux.md` §3.3 inventory, which is what that icon is for.

   Why a menu rather than always-visible controls: a 26 px row has room for the
   glyph, the name, and a count — the same arithmetic as the folder rows, whose
   menu this mirrors, down to the portalled placement measured by the opener
   (the tags list scrolls inside an `overflow` container that would clip an
   in-row menu).

   **The items carry no icons**, for the folder menu's reason: the §3.3 inventory
   is closed and has no pencil or edit glyph, and two distinct English verbs
   need no illustration (§1: no icons where a word is clearer).

   A `menu` with `menuitem`s rather than a list of buttons, because that is what
   lets the arrow keys move between items and `Esc` return focus to the row. */

export type TagMenuAction = 'rename' | 'delete';

type TagRowMenuProps = {
  tagId: Uuid;
  tagName: string;
  /** Viewport coordinates, measured by the row in the handler that opened the
      menu — the same contract as `NoteRowMenu` and `FolderRowMenu`, for the
      same reason: an effect that measures and then sets state is a second
      render for geometry that was already in hand. */
  placement: { top: number; left: number };
  onAction: (action: TagMenuAction, id: Uuid) => void;
  onClose: () => void;
};

export function TagRowMenu({ tagId, tagName, placement, onAction, onClose }: TagRowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* Focus the first item on open, and hand focus back on close — both are what
     make the menu usable from the keyboard rather than only from the pointer
     that opened it. The row itself is not in the tab order, so the return is a
     best effort that no-ops rather than failing. */
  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      document.querySelector<HTMLElement>(`[data-tag-id="${tagId}"]`)?.focus();
    },
    [tagId],
  );

  /* Outside press closes, on `click` and `auxclick` rather than `mousedown` —
     the same contract as the other two row menus, for the same reason: the
     press that opens the menu from a touch hold is still down when the menu
     mounts, and closing on its release `mousedown` would shut the menu before
     the hold is over. `auxclick` keeps right-clicking another row to a single
     menu. */
  useEffect(() => {
    const onOutsidePress = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('click', onOutsidePress);
    document.addEventListener('auxclick', onOutsidePress);
    return () => {
      document.removeEventListener('click', onOutsidePress);
      document.removeEventListener('auxclick', onOutsidePress);
    };
  }, [onClose]);

  const items: ReadonlyArray<{ action: TagMenuAction; label: string; danger: boolean }> = [
    { action: 'rename', label: 'Rename', danger: false },
    { action: 'delete', label: 'Delete', danger: true },
  ];

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${tagName} actions`}
      data-testid="tag-menu"
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
      className="fixed z-50 min-w-[168px] overflow-hidden rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-pop)]"
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
          data-testid={`tag-menu-${item.action}`}
          onClick={() => {
            onAction(item.action, tagId);
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

/** The row's own affordance. Kept out of the tab order (`tabIndex={-1}`): the
    row's own keydown opens the menu, so a stop between every tag row and its
    menu is one more thing to tab past for no gain. On touch the menu opens by
    long-press instead (§9). */
export function TagMenuButton({
  tagName,
  onOpen,
}: {
  tagName: string;
  onOpen: (button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${tagName} actions`}
      aria-haspopup="menu"
      title={`${tagName} actions`}
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
