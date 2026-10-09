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
  /** `05-ui-ux.md` §6.3a: the pin control on a card. Present on every selection but
      Trash, where a trashed note's pin is not something the user can act on. */
  onTogglePin?: (id: string) => void;
  /** A write is in flight for this card, so its pin control is disabled rather than
      accepting a second press that would race the first. */
  pinPending?: boolean;
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
  onTogglePin,
  pinPending = false,
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
      className={`group relative cursor-pointer rounded-[var(--r-input)] border px-[10px] py-[9px] transition-colors ${
        isOpen
          ? 'border-[var(--border)] bg-[var(--surface)]'
          : 'border-transparent hover:bg-[var(--surface)]'
      }`}
    >
      <div className="flex items-baseline gap-[6px]">
        {/* The pin is a control wherever there is anything to toggle, and a plain
            icon where there is not — the trash, where a deleted note's pin is not
            something the user can act on. A disabled button would read as a control
            that is broken rather than as one that does not exist here. */}
        {onTogglePin !== undefined ? (
          note.isPinned ? (
            <PinButton note={note} pending={pinPending} onTogglePin={onTogglePin} pinned />
          ) : (
            /* Unpinned rows get the control too, revealed on hover at `pointer:
               fine` (§9). A permanently visible pin on every card would make the
               pinned one stop meaning anything. */
            <span className="hidden flex-none self-center pointer-fine:group-hover:flex">
              <PinButton note={note} pending={pinPending} onTogglePin={onTogglePin} pinned={false} />
            </span>
          )
        ) : note.isPinned ? (
          <span
            data-testid="pin-indicator"
            className="flex flex-none self-center text-[var(--accent)]"
          >
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

function PinButton({
  note,
  pinned,
  pending,
  onTogglePin,
}: {
  note: NoteSummary;
  pinned: boolean;
  pending: boolean;
  onTogglePin?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      /* `aria-pressed` rather than a label that changes with the state: the control
         is one thing that is on or off, and a screen reader announcing
         "Pin"/"Unpin" forces the user to infer which is which. */
      aria-pressed={pinned}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${note.title.length === 0 ? UNTITLED : note.title}`}
      data-testid="pin-toggle"
      data-note-id={note.id}
      disabled={pending || onTogglePin === undefined}
      onClick={(event) => {
        /* The card is also a click target, and a pin that also opened the note would
           make the control useless on a row the user was trying to read. */
        event.stopPropagation();
        onTogglePin?.(note.id);
      }}
      className={`grid h-[18px] w-[18px] flex-none place-items-center rounded transition-opacity disabled:opacity-50 ${
        pinned
          ? 'text-[var(--accent)]'
          : 'text-[var(--text-subtle)] hover:text-[var(--accent)]'
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