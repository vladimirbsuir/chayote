import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import type { NoteSummary } from '../types/ipc';
import type { Uuid } from '../types/note';
import { relativeTime } from '../lib/relativeTime';
import { NoteCard } from './NoteCard';
import { EmptyState } from './EmptyState';

/* The virtualised note list (`02-architecture.md` §8: 10 000 notes at 60 fps,
   virtualised from the first commit). Every row receives a `NoteSummary`; the
   list never loads a document body (`03-data-model.md` §3.3 provides `excerpt`
   and `word_count` for exactly this reason).

   Rows are measured, not assumed. A card is a title line, an excerpt clamped to
   two lines, and a meta line, and the middle part is optional: a note with no
   excerpt is one line shorter than one with a long excerpt. The prototype's
   clamp bounds the variance at three line-heights rather than eliminating it, so
   a single fixed `estimateSize` cannot be right for every card — and being wrong
   is visible, because a row positioned at 78 px while the card is 104 px tall
   overlaps its neighbour and clips the text between them. `estimateSize` stays
   as the first guess, and `measureElement` corrects it per row. */

const ESTIMATED_CARD_HEIGHT = 96;
const OVERSCAN = 6;

type NoteListProps = {
  notes: NoteSummary[];
  openNoteId: Uuid | null;
  /** One clock reading for the whole list, re-read every 60 s (§6.5a). */
  now: number;
  folderNames: Map<string, string>;
  /** A folder or tag selection scopes the list, so a folder chip would be
      redundant; `all` and `pinned` span folders and show it. */
  showFolder: boolean;
  onOpen: (id: Uuid) => void;
  /** `05-ui-ux.md` §6.3a. Absent in the trash, where the pin of a deleted note is
      not something the user can act on. */
  onTogglePin?: (id: Uuid) => void;
  /** The note with a pin write in flight, so its control can be disabled. */
  pinPendingId?: Uuid | null;
  /** §6.2: delete from a live list; restore and permanent delete from the trash.
      All three go through the row's overflow menu, so a card stays a card. */
  onDeleteNote?: (id: Uuid) => void;
  onRestoreNote?: (id: Uuid) => void;
  onDestroyNote?: (id: Uuid) => void;
  /** Copy for the empty state, which differs per selection (§8). */
  empty: { title: string; body: string; action?: ReactNode };
};

export function NoteList({
  notes,
  openNoteId,
  now,
  folderNames,
  showFolder,
  onOpen,
  onTogglePin,
  pinPendingId = null,
  onDeleteNote,
  onRestoreNote,
  onDestroyNote,
  empty,
}: NoteListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  /* The React Compiler skips memoising a component that calls `useVirtualizer`,
     because the instance is rebuilt on every render and its accessors would
     close over stale values. That is correct here and is what we want: the
     windowing maths must be recomputed as the scroll offset changes. Nothing
     derived from the instance is passed to `NoteCard` — the row's `note` comes
     from the `notes` prop and its `start` is a number — so the stale-value
     failure mode the rule warns about cannot occur. */
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => notes[index]?.id ?? index,
  });

  /* The empty state is not a scroll container: a listbox with no options is an
     accessibility dead end, and the empty state has its own action. */
  if (notes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center px-4 pt-8">
        <EmptyState
          title={empty.title}
          body={empty.body}
          icon={<Inbox className="icon i-20" aria-hidden="true" />}
          action={empty.action}
        />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Notes"
      data-testid="note-list"
      className="min-h-0 flex-1 overflow-y-auto px-1 py-1"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const note = notes[virtualRow.index];
          if (note === undefined) return null;
          return (
            <div
              key={virtualRow.key}
              /* No `height` here: it would defeat `measureElement`. The measured
                 row becomes the positioning unit, so the total size and every
                 `start` offset come from the same measurement. */
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <NoteCard
                note={note}
                isOpen={note.id === openNoteId}
                timestamp={relativeTime(note.updatedAt, now)}
                folderName={
                  note.folderId === null ? null : (folderNames.get(note.folderId) ?? null)
                }
                showFolder={showFolder}
                onOpen={onOpen}
                onTogglePin={onTogglePin}
                pinPending={pinPendingId === note.id}
                onDelete={onDeleteNote}
                onRestore={onRestoreNote}
                onDestroy={onDestroyNote}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}