import { useCallback, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactNode } from 'react';
import type { NoteRow } from '../types/ipc';
import type { Uuid } from '../types/note';
import { relativeTime } from '../lib/relativeTime';
import { NoteCard } from './NoteCard';
import { NoteRowMenu } from './NoteRowMenu';
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

const ESTIMATED_CARD_HEIGHT = 104;
const OVERSCAN = 6;

/** The menu's own metrics, from the prototype's popover: 168 px is the narrowest that
    fits "Delete permanently" at 13 px with its icon, and 120 px is its height with
    three items. Used only to decide which way it opens — enough to know whether there
    is room below, without laying it out first. */
const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 120;

/** One open row menu for the whole list, held here rather than in the cards:
    per-card state lets two holds open two menus at once — found on a phone, where
    long-pressing a second row left the first menu up. The folder tree holds its
    single menu the same way. Keyed by the note's id and the actions on offer, so a
    re-sorting list cannot leave one open over the wrong note.

    Deliberately **not** keyed by `updatedAt`. The timestamp moves on every write, so
    keying on it made *any* write close an open menu — including the very write the
    menu triggers, and including a background write that had nothing to do with the
    menu. That is not theoretical: on CI a menu opened by a hold on a freshly pinned
    row vanished between the hold and the read that followed, because the pin's own
    response arrived after the key was taken (one flaky touch test, and a menu a
    person can watch disappear under their finger).

    Choosing an item closes the menu itself (`NoteRowMenu`), and a note leaving the
    list stops matching by id — which is the guarantee this key exists for. */
type MenuState = {
  id: string;
  key: string;
  placement: { top: number; left: number };
};

function menuKey(hasRowActions: boolean): string {
  return String(hasRowActions);
}

type NoteListProps = {
  /** `NoteSummary` in a selection, `SearchHit` while searching — the second is
      assignable to the first with a snippet, which is the whole reason the row
      type exists (`src/types/ipc.ts`). */
  notes: NoteRow[];
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
  /** §6.2: pin and delete from a live list; restore and permanent delete from the
      trash. All go through the row's overflow menu, so a card stays a card. */
  onDeleteNote?: (id: Uuid) => void;
  onRestoreNote?: (id: Uuid) => void;
  onDestroyNote?: (id: Uuid) => void;
  /** Copy for the empty state, which differs per selection and per search (§8).
      The icon comes from the sidebar rather than from here: §3.3's inventory
      gives each state its own glyph, and a list that chose for itself would have
      to know which of the six situations it is in. */
  empty: { title: string; body: string; icon: ReactNode; action?: ReactNode };
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

  const hasRowActions =
    onTogglePin !== undefined ||
    onDeleteNote !== undefined ||
    onRestoreNote !== undefined ||
    onDestroyNote !== undefined;
  const [menu, setMenu] = useState<MenuState | null>(null);

  /* Measured in the handler that opens it and handed to the menu as a plain value —
     the `NoteCard` contract, moved up with the state. A plain value rather than an
     anchor element so the menu does not have to measure anything: an effect that
     measures the DOM and then sets state is a second render for a value that was
     already available when the event arrived.

     Always sets, never toggles: the card decides open versus close (it knows
     whether its own menu is up), so a second press on the same row closes through
     `onCloseMenu` and a press on another row replaces. */
  const openMenu = useCallback(
    (id: Uuid, anchor: HTMLElement): void => {
      const note = notes.find((candidate) => candidate.id === id);
      if (note === undefined) return;
      const rect = anchor.getBoundingClientRect();
      const up =
        rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight &&
        rect.top > MENU_ESTIMATED_HEIGHT;
      setMenu({
        id,
        key: menuKey(hasRowActions),
        placement: {
          /* Clamped so the estimate always lands inside the viewport. Moving
             the top above the row does not move the box's bottom edge with it —
             the menu still grows down from its top — so a tall row near the
             fold fits neither below nor above, and arrived 13 px clipped in the
             trash-restore flow once taller cards pushed the row into that zone.
             Overlapping the row is fine: the menu is transient chrome above
             everything, not layout. */
          top: Math.min(
            Math.max(8, up ? rect.top - 4 : rect.bottom + 4),
            window.innerHeight - MENU_ESTIMATED_HEIGHT - 8,
          ),
          left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
        },
      });
    },
    [hasRowActions, notes],
  );
  const closeMenu = useCallback((): void => {
    setMenu(null);
  }, []);

  /* Valid only while its note is still in the list and offering the same actions.
     A pin, delete or restore re-sorts the list under the menu; the id lookup drops
     a note that has left it, and the key drops a change of actions, rather than
     needing an effect to close it. */
  const menuNote = menu === null ? undefined : notes.find((candidate) => candidate.id === menu.id);
  const validMenu =
    menu !== null && menuNote !== undefined && menu.key === menuKey(hasRowActions)
      ? { note: menuNote, placement: menu.placement }
      : null;

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
        <EmptyState title={empty.title} body={empty.body} icon={empty.icon} action={empty.action} />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Notes"
      data-testid="note-list"
      className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
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
                 `start` offset come from the same measurement. The bottom
                 padding is the 8 px gap between cards — it is inside the
                 measured row, so the virtualiser positions neighbours after
                 it rather than under it. */
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="pb-2"
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
                menuOpen={validMenu?.note.id === note.id}
                onOpenMenu={openMenu}
                onCloseMenu={closeMenu}
              />
            </div>
          );
        })}
      </div>
      {validMenu === null ? null : (
        <NoteRowMenu
          note={validMenu.note}
          placement={validMenu.placement}
          pinned={validMenu.note.isPinned}
          onTogglePin={onTogglePin}
          onDelete={onDeleteNote}
          onRestore={onRestoreNote}
          onDestroy={onDestroyNote}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
