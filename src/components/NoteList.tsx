import { useCallback, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactNode } from 'react';
import type { NoteRow } from '../types/ipc';
import type { Uuid } from '../types/note';
import { relativeTime } from '../lib/relativeTime';
import { NoteCard } from './NoteCard';
import { NoteRowMenu } from './NoteRowMenu';
import { EmptyState } from './EmptyState';

const ESTIMATED_CARD_HEIGHT = 104;
const OVERSCAN = 6;

const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 120;

type MenuState = {
  id: string;
  key: string;
  placement: { top: number; left: number };
};

function menuKey(hasRowActions: boolean): string {
  return String(hasRowActions);
}

type NoteListProps = {
  notes: NoteRow[];
  openNoteId: Uuid | null;
  now: number;
  folderNames: Map<string, string>;
  showFolder: boolean;
  onOpen: (id: Uuid) => void;
  onTogglePin?: (id: Uuid) => void;
  pinPendingId?: Uuid | null;
  onDeleteNote?: (id: Uuid) => void;
  onRestoreNote?: (id: Uuid) => void;
  onDestroyNote?: (id: Uuid) => void;
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

  const menuNote = menu === null ? undefined : notes.find((candidate) => candidate.id === menu.id);
  const validMenu =
    menu !== null && menuNote !== undefined && menu.key === menuKey(hasRowActions)
      ? { note: menuNote, placement: menu.placement }
      : null;

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => notes[index]?.id ?? index,
  });

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
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const note = notes[virtualRow.index];
          if (note === undefined) return null;
          return (
            <div
              key={virtualRow.key}
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
