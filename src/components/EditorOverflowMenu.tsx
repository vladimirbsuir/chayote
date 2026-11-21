import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pin, Trash } from 'lucide-react';
import { IconButton } from './IconButton';

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