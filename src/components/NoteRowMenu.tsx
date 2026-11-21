import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Pin, RotateCw, Trash } from 'lucide-react';
import type { NoteSummary } from '../types/ipc';

export type NoteRowAction = 'pin' | 'delete' | 'restore' | 'destroy';

type NoteRowMenuProps = {
  note: NoteSummary;
  placement: { top: number; left: number };
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
