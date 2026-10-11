import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pin, Trash } from 'lucide-react';
import { IconButton } from './IconButton';

/* The mobile editor's overflow menu, and the handler for the "three dots" that
   previously had none: `EditorPane.tsx` rendered an `IconButton` with no `onClick`,
   so the control existed, looked tappable, and did nothing — which `05-ui-ux.md` §1
   and §9 both forbid, and which the user reported on a device.

   `05-ui-ux.md` §2.4 gives the mobile editor its own bar "because it needs a back
   affordance, the note title, and a delete action", so delete belongs here. Pinning
   joins it because §6.3a requires a visible control and the status bar no longer has
   room for one at 360 px.

   Both icons are already in the closed `05-ui-ux.md` §3.3 inventory — `pin` and
   `trash` — which is what makes this the right home for the pin rather than a new
   screen, and is why `NoteRowMenu` is the sibling to copy rather than `TopBar`'s
   single-item menu.

   Same shape as `FolderRowMenu`: `role="menu"` with `menuitem`s, focus to the first
   item on open, focus back to the trigger on close, dismissed by an outside press or
   by `Esc`. */

type EditorOverflowMenuProps = {
  isPinned: boolean;
  onTogglePin: () => void;
  onTrash: () => void;
};

export function EditorOverflowMenu({
  isPinned,
  onTogglePin,
  onTrash,
}: EditorOverflowMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const run = (action: () => void): void => {
    /* Focus goes to the trigger before the action runs. The menu item is about to
       unmount, and `useDialogFocus` captures `document.activeElement` as the element
       to restore — returning focus to a removed node strands a keyboard user on the
       body, so the next `Tab` restarts at the top of the page. `TopBar.tsx` carries
       the same note for the same reason. */
    triggerRef.current?.focus();
    setOpen(false);
    action();
  };

  return (
    <div className="relative" ref={menuRef}>
      <IconButton
        ref={triggerRef}
        label="More"
        size="mobile"
        hasPopup="menu"
        expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <MoreHorizontal className="icon i-24" aria-hidden="true" />
      </IconButton>
      {open ? (
        <div
          role="menu"
          data-testid="editor-overflow"
          /* Menu labels are chrome, not content: a hold on an item must press
             it, never select its text. */
          className="absolute right-0 top-[48px] z-40 w-[200px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-[var(--shadow-pop)] select-none"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            ref={firstItemRef}
            data-testid="editor-overflow-pin"
            aria-pressed={isPinned}
            onClick={() => {
              run(onTogglePin);
            }}
            className={`flex w-full items-center gap-2 rounded-[5px] px-2 py-2 text-left text-[13px] hover:bg-[var(--surface)] ${
              isPinned ? 'text-[var(--accent)]' : 'text-[var(--text)]'
            }`}
          >
            <Pin className="icon i-16" aria-hidden="true" />
            {isPinned ? 'Unpin note' : 'Pin note'}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="editor-overflow-trash"
            onClick={() => {
              run(onTrash);
            }}
            className="flex w-full items-center gap-2 rounded-[5px] px-2 py-2 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--surface)]"
          >
            <Trash className="icon i-16" aria-hidden="true" />
            Move to trash
          </button>
        </div>
      ) : null}
    </div>
  );
}