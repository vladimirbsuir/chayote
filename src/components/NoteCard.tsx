import { memo, useRef, useState } from 'react';
import { Folder, Hash, MoreHorizontal, Pin } from 'lucide-react';
import { NoteRowMenu } from './NoteRowMenu';
import { sanitizeSnippet } from '../lib/sanitize';
import type { NoteRow } from '../types/ipc';

/* One row of the note list: title, excerpt, relative timestamp, pinned
   indicator, and an optional folder or tag chip (`05-ui-ux.md` §4). It receives
   a `NoteSummary` and nothing else — never a document, because the list must not
   load one (`02-architecture.md` §8, `03-data-model.md` §3.3).

   Metrics are copied from the prototype: 9/10 padding, 14 px title at 550,
   13 px excerpt clamped to two lines, 12 px meta row. */

const UNTITLED = 'Untitled';

/** The menu's own metrics, from the prototype's popover: 168 px is the narrowest that
    fits "Delete permanently" at 13 px with its icon, and 120 px is its height with
    three items. Used only to decide which way it opens — enough to know whether there
    is room below, without laying it out first. */
const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 120;

/** Which note's menu is open, and where. Keyed rather than a boolean, so a row whose
    note, timestamp or available actions change simply stops matching — no effect
    needed to close a menu whose row has gone or moved. */
type MenuState = {
  key: string;
  placement: { top: number; left: number };
};

type NoteCardProps = {
  note: NoteRow;
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
  /** §6.2. Absent in the trash for `onDelete`, and in every live list for the other
      two: a card offers the actions its selection can actually perform, so there is
      never a control that would delete something permanently by accident. */
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDestroy?: (id: string) => void;
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
  onDelete,
  onRestore,
  onDestroy,
}: NoteCardProps) {
  const untitled = note.title.length === 0;
  const hasRowActions = onDelete !== undefined || onRestore !== undefined || onDestroy !== undefined;

  /* Which note's menu is open, held by id rather than as a boolean.
    A boolean has to be reset in an effect whenever the row changes underneath it —
     when the note is deleted, pinned, or its actions change with the selection — and
     an effect that repairs state after the render in which it went stale shows the
     wrong menu for a frame, with actions aimed at a note that is no longer there.
     Keying it by id makes that impossible: the menu is open only for the note it was
     opened for, and anything else renders none.

     `updatedAt` is part of the key because a note whose content changed has re-sorted
     under the pointer, and a menu left open over a list that has moved is a set of
     actions aimed at a row the user is no longer looking at. */
  const [menuFor, setMenuFor] = useState<MenuState | null>(null);
  const menuStamp = `${note.id}:${note.updatedAt}:${String(hasRowActions)}`;
  const openMenuFor = menuFor !== null && menuFor.key === menuStamp ? menuFor : null;

  /* A press that opened the menu via long-press is still a press: the release
     after the hold synthesises a click, and a click opens the note — covering
     the menu the user just asked for. The flag eats exactly that one. It is set
     where the menu opens from `contextmenu` and cleared wherever the menu
     closes, so a right-click followed by `Esc` leaves the next real click alone. */
  const suppressOpenRef = useRef(false);
  const closeMenu = (): void => {
    suppressOpenRef.current = false;
    setMenuFor(null);
  };

  /* Measured here, in the handler that opens the menu — the button click, a
     `contextmenu`, or the `ContextMenu` key — and handed to the menu as a plain value.

     Measuring inside the menu would need an effect, and an effect that measures the
     DOM and then sets state is a second render for something already known at the
     moment of the event. A click is an event; the geometry is available there.

     The list is a scroll container, so a menu opening downward is clipped at the
     bottom edge and one opening upward is covered at the top — and both happen
     routinely, because the first and last cards are the two a user is most likely to
     act on. Measured against the viewport rather than computed from the row's index,
     because the list is virtualised: the same index sits at a different height in a
     scrolled list, in a shorter window, and on a phone. */
  const openMenu = (anchor: HTMLElement): void => {
    if (openMenuFor !== null) {
      closeMenu();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const up = rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight && rect.top > MENU_ESTIMATED_HEIGHT;
    setMenuFor({
      key: menuStamp,
      placement: {
        top: up ? rect.top - 4 : rect.bottom + 4,
        left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
      },
    });
  };

  return (
    <div
      role="option"
      aria-selected={isOpen}
      tabIndex={isOpen ? 0 : -1}
      data-testid="note-card"
      data-note-id={note.id}
      onClick={() => {
        /* A press that opened the menu via long-press ends here too: the release
           after the hold synthesises a click, and opening the note under a menu
           the user just asked for would cover it. */
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
        /* §7: `ContextMenu` opens the focused row's menu — the application key
           on a Windows keyboard, and the standard way to ask for a menu. Without
           this the menu button's `tabIndex={-1}` leaves keyboard users with no
           path to the row's actions at all. */
        if (event.key === 'ContextMenu') {
          if (!hasRowActions) return;
          event.preventDefault();
          openMenu(event.currentTarget);
        }
      }}
      /* §2.2 and §9: right-click on desktop, long-press on touch — a hold fires
         `contextmenu` on the device — and the row's own button, all reach the
         same menu. `preventDefault` is what stops the hold from becoming a text
         selection instead. Rows with no actions have no menu to open.
         The `select-none` + `touch-callout` pair on the row is the other half:
         on a text-rich card the hold is a selection gesture and no `contextmenu`
         fires at all — measured on the device, where the hold selected text on
         the old build and opened nothing on the new one until the row stopped
         being selectable. Copying happens in the editor, not in the list, so
         nothing specified is lost. */
      onContextMenu={(event) => {
        if (!hasRowActions) return;
        event.preventDefault();
        suppressOpenRef.current = true;
        openMenu(event.currentTarget);
      }}
      className={`group relative cursor-pointer rounded-[var(--r-input)] border px-[10px] py-[9px] transition-colors select-none [-webkit-touch-callout:none] ${
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
        {hasRowActions ? (
          /* §9: hover styling exists at `pointer: fine` and nowhere else, and the
             menu button stays out of the tab order because the row's own keydown
             opens it — the same two rules the folder rows follow. */
          <span className="ml-auto hidden flex-none pointer-fine:group-hover:flex">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${titleOf(note)} actions`}
              aria-haspopup="menu"
              aria-expanded={openMenuFor !== null}
              title={`${titleOf(note)} actions`}
              data-testid="note-menu-button"
              data-note-id={note.id}
              onClick={(event) => {
                event.stopPropagation();
                openMenu(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu') {
                  event.preventDefault();
                  openMenu(event.currentTarget);
                }
              }}
              className="grid h-[20px] w-[20px] place-items-center rounded text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
            >
              <MoreHorizontal className="icon i-16" aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>

      {openMenuFor !== null ? (
        <NoteRowMenu
          note={note}
          placement={openMenuFor.placement}
          onDelete={onDelete}
          onRestore={onRestore}
          onDestroy={onDestroy}
          onClose={() => {
            closeMenu();
          }}
        />
      ) : null}
    </div>
  );
});

function titleOf(note: NoteRow): string {
  return note.title.length === 0 ? UNTITLED : note.title;
}

/**
 * A search result shows the sentence that matched rather than the note's
 * opening (`05-ui-ux.md` §6.5), with FTS5's `<mark>` around the terms.
 *
 * The snippet is backend-supplied markup: `plain_text` is whatever the user
 * typed and FTS5 escapes none of it, so a note containing a script tag produces
 * a snippet containing a script tag. It goes through the snippet allowlist
 * before insertion, and only `mark` survives it.
 *
 * The highlight's four values are the prototype's `.note-card mark` rule.
 */
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