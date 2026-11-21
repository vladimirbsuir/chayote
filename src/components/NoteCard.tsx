import { memo, useRef } from 'react';
import { Folder, Hash, Pin } from 'lucide-react';
import { sanitizeSnippet } from '../lib/sanitize';
import type { NoteRow } from '../types/ipc';

const UNTITLED = 'Untitled';

type NoteCardProps = {
  note: NoteRow;
  isOpen: boolean;
  timestamp: string;
  folderName: string | null;
  showFolder: boolean;
  onOpen: (id: string) => void;
  onTogglePin?: (id: string) => void;
  pinPending?: boolean;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDestroy?: (id: string) => void;
  menuOpen: boolean;
  onOpenMenu: (id: string, anchor: HTMLElement) => void;
  onCloseMenu: () => void;
};

export const NoteCard = memo(function NoteCard({
  note,
  isOpen,
  timestamp,
  folderName,
  showFolder,
  onOpen,
  onTogglePin,
  pinPending = false,
  onDelete,
  onRestore,
  onDestroy,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
}: NoteCardProps) {
  const untitled = note.title.length === 0;
  const hasRowActions =
    onDelete !== undefined || onRestore !== undefined || onDestroy !== undefined;

  const suppressOpenRef = useRef(false);
  const handleMenuClose = (): void => {
    suppressOpenRef.current = false;
    onCloseMenu();
  };

  const toggleMenu = (anchor: HTMLElement): void => {
    if (menuOpen) {
      handleMenuClose();
      return;
    }
    onOpenMenu(note.id, anchor);
  };

  return (
    <div
      role="option"
      aria-selected={isOpen}
      tabIndex={isOpen ? 0 : -1}
      data-testid="note-card"
      data-note-id={note.id}
      onClick={() => {
        if (suppressOpenRef.current) {
          suppressOpenRef.current = false;
          return;
        }
        onOpen(note.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(note.id);
        }
        if (event.key === 'ContextMenu') {
          if (!hasRowActions) return;
          event.preventDefault();
          toggleMenu(event.currentTarget);
        }
      }}
      onContextMenu={(event) => {
        if (!hasRowActions) return;
        event.preventDefault();
        if (!menuOpen) suppressOpenRef.current = true;
        toggleMenu(event.currentTarget);
      }}
      className={`group relative cursor-pointer rounded-[var(--r-input)] border px-[10px] py-[9px] transition-colors select-none [-webkit-touch-callout:none] ${
        isOpen
          ? 'border-[var(--accent)] bg-[var(--surface)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]'
      }`}
    >
      <div className="flex items-baseline gap-[6px]">
        {onTogglePin !== undefined ? (
          note.isPinned ? (
            <PinButton note={note} pending={pinPending} onTogglePin={onTogglePin} pinned />
          ) : null
        ) : note.isPinned ? (
          <span
            data-testid="pin-indicator"
            className="flex flex-none self-center text-[var(--accent)]"
          >
            <Pin className="icon i-16" aria-hidden="true" />
          </span>
        ) : null}
        <span
          className={`overflow-hidden text-[14px] leading-[1.4] text-ellipsis whitespace-nowrap ${
            untitled
              ? 'font-normal text-[var(--text-subtle)] italic'
              : 'font-medium text-[var(--text)]'
          }`}
        >
          {untitled ? UNTITLED : note.title}
        </span>
      </div>

      {note.snippet !== undefined && note.snippet.length > 0 ? (
        <Snippet snippet={note.snippet} />
      ) : note.excerpt.length > 0 ? (
        <p className="mt-[2px] line-clamp-2 overflow-hidden text-[13px] leading-[1.45] text-[var(--text-muted)]">
          {note.excerpt}
        </p>
      ) : null}

      <div className="mt-[5px] flex items-center gap-2 text-[12px] text-[var(--text-subtle)]">
        <span>{timestamp}</span>
        {showFolder && folderName !== null ? <FolderChip name={folderName} /> : null}
        {note.tags.length > 0 ? <TagChip name={note.tags[0]?.name ?? ''} /> : null}
      </div>
    </div>
  );
});

function Snippet({ snippet }: { snippet: string }) {
  return (
    <p
      data-testid="note-snippet"
      className="mt-[2px] line-clamp-2 overflow-hidden text-[13px] leading-[1.45] text-[var(--text-muted)] [&_mark]:rounded-[2px] [&_mark]:bg-[var(--accent-soft)] [&_mark]:px-[1px] [&_mark]:text-[var(--accent)]"
      dangerouslySetInnerHTML={{ __html: sanitizeSnippet(snippet) }}
    />
  );
}

function PinButton({
  note,
  pinned,
  pending,
  onTogglePin,
}: {
  note: NoteRow;
  pinned: boolean;
  pending: boolean;
  onTogglePin?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${note.title.length === 0 ? UNTITLED : note.title}`}
      data-testid="pin-toggle"
      data-note-id={note.id}
      disabled={pending || onTogglePin === undefined}
      onClick={(event) => {
        event.stopPropagation();
        onTogglePin?.(note.id);
      }}
      className={`grid h-[18px] w-[18px] flex-none place-items-center rounded transition-opacity disabled:opacity-50 ${
        pinned ? 'text-[var(--accent)]' : 'text-[var(--text-subtle)] hover:text-[var(--accent)]'
      }`}
    >
      <Pin className="icon i-16" aria-hidden="true" />
    </button>
  );
}

function FolderChip({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-[3px] rounded-[var(--r-pill)] bg-[var(--surface-sunken)] px-[6px] py-[1px] text-[11px] text-[var(--text-muted)]">
      <Folder className="icon i-16 opacity-60" aria-hidden="true" />
      {name}
    </span>
  );
}

function TagChip({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-[3px] rounded-[var(--r-pill)] bg-[var(--surface-sunken)] px-[6px] py-[1px] text-[11px] text-[var(--text-muted)]">
      <Hash className="icon i-16 opacity-70" aria-hidden="true" />
      {name}
    </span>
  );
}
