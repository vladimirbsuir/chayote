import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Pin, RotateCw, Trash } from 'lucide-react';
import type { NoteSummary } from '../types/ipc';

/* The note row's overflow menu: `05-ui-ux.md` §6.2. Pin and delete in a live
   list; restore and permanent delete in the trash.

   All three icons are from the `05-ui-ux.md` §3.3 inventory — `pin` is listed
   for the row's own pin control, `rotate-cw` for "Retry a failed save, reset
   settings" (a restore is the same gesture in the opposite direction), and
   `trash` for "permanent delete". No new icons, so no inventory change, which
   is the point of the inventory being closed. The pin duplicates the row's
   hover control deliberately: on touch there is no hover, so without it a
   phone could only pin from inside the editor.

   **Permanent delete is the only item that asks first**, and it is deliberately not
   the same dialog as the folder's: there is no count to name, because one note is
   gone rather than a subtree. `05-ui-ux.md` §6.2 gives permanent delete and empty
   trash a `ConfirmDialog` and gives soft delete an undo toast; a row that offered
   both a toast and a dialog for the same press would be asking twice. */

export type NoteRowAction = 'pin' | 'delete' | 'restore' | 'destroy';

type NoteRowMenuProps = {
  note: NoteSummary;
  /** Viewport coordinates, measured by the card in the click handler. A plain value
     rather than an anchor element so the menu does not have to measure anything —
     an effect that measures the DOM and then sets state is a second render for a
     value that was already available when the click arrived. */
  placement: { top: number; left: number };
  /** Whether the note is currently pinned, naming the pin item. Absent with the
     handler in the trash, where a deleted note's pin is not actionable. */
  pinned?: boolean;
  onTogglePin?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDestroy?: (id: string) => void;
  onClose: () => void;
};

export function NoteRowMenu({
  note,
  placement,
  pinned,
  onTogglePin,
  onDelete,
  onRestore,
  onDestroy,
  onClose,
}: NoteRowMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const title = titleOf(note);

  const items = buildItems(pinned ?? false, onTogglePin, onDelete, onRestore, onDestroy);

  /* Rendered through a portal and positioned against the viewport, which is the only
     way this menu is clickable at all.

     The note list is virtualised: every row is an absolutely positioned element with a
     `transform`, and a transform creates a stacking context. A menu rendered inside a
     row is therefore trapped under that row's context, so `z-index` cannot lift it
     above the rows after it — the next card paints over it and swallows the click,
     which is what Playwright reported. The scroll container's `overflow` clips it the
     same way. */
  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      document
        .querySelector<HTMLElement>(`[data-testid="note-card"][data-note-id="${note.id}"]`)
        ?.focus();
    },
    [note.id],
  );

  /* Outside press closes on `mousedown` (plus `click` for presses with no
     button-down, like keyboard activation) — deliberately never on `auxclick`.
     The same physical press both opens the menu (`contextmenu`) and releases
     (`auxclick`), and their order differs by platform: where `auxclick` lands
     after `contextmenu`, closing on it shuts the just-opened menu in the
     user's face — found on Linux, invisible on Windows. `mousedown` always
     precedes `contextmenu`, so it can never close what the press is opening;
     a hold that produced `contextmenu` synthesises no mouse events on release
     at all, so the touch path is unaffected. Right-clicking another row still
     lands on one menu, because opening replaces the list's single menu state
     rather than stacking. The row swallows the release's own `click` (it would
     open the note under the menu). */
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

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${title} actions`}
      data-testid="note-menu"
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
          data-testid={`note-menu-${item.action}`}
          onClick={() => {
            /* Choosing closes: the menu's job is done, and the note has not
               changed yet — without this a permanent delete leaves the menu
               sitting under its own confirmation dialog. The data-change
               keying closes it a moment later for the other actions; closing
               here as well is what makes all three behave the same. */
            item.run(note.id);
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-[6px] text-left text-[13px] hover:bg-[var(--surface-sunken)] ${
            item.danger ? 'text-[var(--danger)]' : 'text-[var(--text)]'
          }`}
        >
          <item.icon className="icon i-16 flex-none" aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

type Item = {
  action: NoteRowAction;
  label: string;
  icon: typeof Trash;
  danger: boolean;
  run: (id: string) => void;
};

/** Built from whichever callbacks the caller supplied rather than from a `trashed`
    flag. A card offers the actions its selection can actually perform, so there is
    never a control that would delete something permanently by accident — and the
    caller cannot get the two out of step, because there is only one source. The pin
    leads: it is non-destructive and, on touch without hover, the only path to it
    outside the editor. */
function buildItems(
  pinned: boolean,
  onTogglePin: ((id: string) => void) | undefined,
  onDelete: ((id: string) => void) | undefined,
  onRestore: ((id: string) => void) | undefined,
  onDestroy: ((id: string) => void) | undefined,
): Item[] {
  const items: Item[] = [];
  if (onTogglePin !== undefined) {
    items.push({
      action: 'pin',
      label: pinned ? 'Unpin note' : 'Pin note',
      icon: Pin,
      danger: false,
      run: onTogglePin,
    });
  }
  if (onDelete !== undefined) {
    items.push({
      action: 'delete',
      label: 'Move to trash',
      icon: Trash,
      /* Destructive like every other delete in the app's menus — the editor's
         overflow menu already paints this same verb red, and a trash move in
         default text reads as harmless housekeeping rather than deletion. */
      danger: true,
      run: onDelete,
    });
  }
  if (onRestore !== undefined) {
    items.push({
      action: 'restore',
      label: 'Restore',
      icon: RotateCw,
      danger: false,
      run: onRestore,
    });
  }
  if (onDestroy !== undefined) {
    items.push({
      action: 'destroy',
      label: 'Delete permanently',
      icon: Trash,
      danger: true,
      run: onDestroy,
    });
  }
  return items;
}

function titleOf(note: NoteSummary): string {
  return note.title.length === 0 ? 'Untitled' : note.title;
}
