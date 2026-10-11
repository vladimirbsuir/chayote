import { memo, useRef } from 'react';
import { Folder, Hash, MoreHorizontal, Pin } from 'lucide-react';
import { sanitizeSnippet } from '../lib/sanitize';
import type { NoteRow } from '../types/ipc';

/* One row of the note list: title, excerpt, relative timestamp, pinned
   indicator, and an optional folder or tag chip (`05-ui-ux.md` §4). It receives
   a `NoteSummary` and nothing else — never a document, because the list must not
   load one (`02-architecture.md` §8, `03-data-model.md` §3.3).

   Every card carries its own border and surface, with an 8 px gap from the
   list's virtual rows around it: adjacent notes must read as separate cards,
   not as one continuous block. The open card's border is the accent rather
   than a second background, so it stays distinct from a merely hovered one
   without adding a tint that would compete with the pin.

   Metrics are copied from the prototype: 9/10 padding, 14 px title at 550,
   13 px excerpt clamped to two lines, 12 px meta row. */

const UNTITLED = 'Untitled';

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
  /** Whether this row's menu is the list's open one. The state lives in the list —
      per-card state lets two holds open two menus at once — so this is a read-only
      flag for the toggle below. */
  menuOpen: boolean;
  /** Open this row's menu, measured from the anchor. Always opens; the card
      decides open versus close. */
  onOpenMenu: (id: string, anchor: HTMLElement) => void;
  onCloseMenu: () => void;
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
  menuOpen,
  onOpenMenu,
  onCloseMenu,
}: NoteCardProps) {
  const untitled = note.title.length === 0;
  const hasRowActions = onDelete !== undefined || onRestore !== undefined || onDestroy !== undefined;

  /* A press that opened the menu via long-press is still a press: the release
     after the hold synthesises a click, and a click opens the note — covering
     the menu the user just asked for. The flag eats exactly that one. It is set
     where the menu opens from `contextmenu` and cleared wherever the menu
     closes, so a right-click followed by `Esc` leaves the next real click alone. */
  const suppressOpenRef = useRef(false);
  const handleMenuClose = (): void => {
    suppressOpenRef.current = false;
    onCloseMenu();
  };

  /* The card decides open versus close — the list only sets — so a second press
     on the same row closes through `onCloseMenu` and a press on another row
     replaces. */
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
          toggleMenu(event.currentTarget);
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
        /* Only a fresh open can precede a release click: when this row's menu is
           already up the press closes it, and no click follows that. */
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
              aria-expanded={menuOpen}
              title={`${titleOf(note)} actions`}
              data-testid="note-menu-button"
              data-note-id={note.id}
              onClick={(event) => {
                event.stopPropagation();
                toggleMenu(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu') {
                  event.preventDefault();
                  toggleMenu(event.currentTarget);
                }
              }}
              className="grid h-[20px] w-[20px] place-items-center rounded text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
            >
              <MoreHorizontal className="icon i-16" aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>
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