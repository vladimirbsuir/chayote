import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import type { Uuid } from '../types/note';

export type TagMenuAction = 'rename' | 'delete';

type TagRowMenuProps = {
  tagId: Uuid;
  tagName: string;
  placement: { top: number; left: number };
  onAction: (action: TagMenuAction, id: Uuid) => void;
  onClose: () => void;
};

export function TagRowMenu({ tagId, tagName, placement, onAction, onClose }: TagRowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      document.querySelector<HTMLElement>(`[data-tag-id="${tagId}"]`)?.focus();
    },
    [tagId],
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
