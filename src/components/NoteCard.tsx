import { memo } from 'react';
import { Folder, Hash, Pin } from 'lucide-react';
import type { NoteSummary } from '../types/ipc';

/* One row of the note list: title, excerpt, relative timestamp, pinned
   indicator, and an optional folder or tag chip (`05-ui-ux.md` §4). It receives
   a `NoteSummary` and nothing else — never a document, because the list must not
   load one (`02-architecture.md` §8, `03-data-model.md` §3.3).

   Metrics are copied from the prototype: 9/10 padding, 14 px title at 550,
   13 px excerpt clamped to two lines, 12 px meta row. */

const UNTITLED = 'Untitled';

type NoteCardProps = {
  note: NoteSummary;
  isOpen: boolean;
  /** Already formatted by the caller, so every row in a render shares one clock
      reading (`05-ui-ux.md` §6.5a). */
  timestamp: string;
  /** Folder name for the chip, or `null` when unfiled. Only rendered when the
      active selection is one that spans folders, matching the prototype. */
  folderName: string | null;
  showFolder: boolean;
  onOpen: (id: string) => void;
};

/* `memo` is not premature here: this is the component that renders once per
   visible row, in a list virtualised to a few dozen live instances over 10 000
   notes. Without it every 60 s clock tick re-renders every mounted card. The
   props are all primitives or a stable summary reference. */
export const NoteCard = memo(function NoteCard({
  note,
  isOpen,
  timestamp,
  folderName,
  showFolder,
  onOpen,
}: NoteCardProps) {
  const untitled = note.title.length === 0;

  return (
    <div
      role="option"
      aria-selected={isOpen}
      tabIndex={isOpen ? 0 : -1}
      data-testid="note-card"
      data-note-id={note.id}
      onClick={() => {
        onOpen(note.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(note.id);
        }
      }}
      className={`cursor-pointer rounded-[var(--r-input)] border px-[10px] py-[9px] transition-colors ${
        isOpen
          ? 'border-[var(--border)] bg-[var(--surface)]'
          : 'border-transparent hover:bg-[var(--surface)]'
      }`}
    >
      <div className="flex items-baseline gap-[6px]">
        {note.isPinned ? (
          <span className="flex flex-none self-center text-[var(--accent)]">
            <Pin className="icon i-16" aria-hidden="true" />
          </span>
        ) : null}
        <span
          className={`overflow-hidden text-ellipsis whitespace-nowrap text-[14px] leading-[1.4] ${
            untitled
              ? 'italic font-normal text-[var(--text-subtle)]'
              : 'font-medium text-[var(--text)]'
          }`}
        >
          {untitled ? UNTITLED : note.title}
        </span>
      </div>

      {note.excerpt.length > 0 ? (
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