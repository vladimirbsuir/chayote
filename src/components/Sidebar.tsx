import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FilePlus, Folder, Hash, Pin, Plus, Trash } from 'lucide-react';
import type { NoteSummary, Selection } from '../types/ipc';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';
import type { Uuid } from '../types/note';
import { NoteList } from './NoteList';
import { FolderTree } from './FolderTree';

/* The sidebar: three stacked regions, not three columns (`05-ui-ux.md` §2.1).
   Filters, then structure, then the list, separated by hairlines, with exactly
   one region interactive at a time. Folders cap at 40 % of the pane and tags at
   25 % (§2.2), so a long folder tree can never squeeze the note list out of
   existence.

   This component owns no selection state. It reads the selection store and
   writes to it, which keeps the model in one place (§5). */

type SidebarProps = {
  selection: Selection;
  width: number;
  folders: FolderNode[] | undefined;
  tags: TagWithCount[] | undefined;
  notes: NoteSummary[] | undefined;
  isPending: boolean;
  now: number;
  folderNames: Map<string, string>;
  folderCounts: Map<string, number>;
  collapsedFolders: Uuid[];
  openNoteId: Uuid | null;
  /** True when the database holds no live notes at all, which is a different
      empty state from a selection that happens to be empty (§8). */
  firstLaunch: boolean;
  onSelect: (selection: Selection) => void;
  onOpenNote: (id: Uuid) => void;
  onNewNote: () => void;
  /** `05-ui-ux.md` §6.3a. Absent in the trash, where a deleted note's pin is not
      something the user can act on. */
  onTogglePin?: (id: Uuid) => void;
  pinPendingId?: Uuid | null;
  onToggleFolder: (id: Uuid) => void;
  /** §6.3: creating a folder is an inline input in the tree, committed with `Enter`.
      Returns a promise so the input can stay open on a rejected write, rather than
      closing and losing what was typed. */
  onCreateFolder: (name: string, parentId: Uuid | null) => Promise<void>;
  onCreateTag: () => void;
  onRenameFolder: (id: Uuid, name: string) => Promise<void>;
  onDeleteFolder: (id: Uuid) => Promise<void>;
  /** §6.3: drag to re-parent and reorder. `position` is sibling-local and the
      backend densifies it (`03-data-model.md` §3.2). */
  onMoveFolder: (id: Uuid, newParentId: Uuid | null, position: number) => Promise<void>;
  /** Shown where a folder write failed. `AppError.message` is user-facing copy
      by contract (`10-conventions.md` §6). */
  onFolderError?: (message: string) => void;
};

export function Sidebar({
  selection,
  width,
  folders,
  tags,
  notes,
  isPending,
  now,
  folderNames,
  folderCounts,
  collapsedFolders,
  openNoteId,
  firstLaunch,
  onSelect,
  onOpenNote,
  onNewNote,
  onTogglePin,
  pinPendingId,
  onToggleFolder,
  onCreateFolder,
  onCreateTag,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onFolderError,
}: SidebarProps) {
  const header = useMemo(
    () => headerFor(selection, notes ?? EMPTY_NOTES, folderNames),
    [selection, notes, folderNames],
  );

  /* Whether the root-level folder create input is open. It lives here because the
     `+` that opens it is in the section header above the tree, and the input
     itself is rendered by `FolderTree` — the two halves of one control, each owned
     by the component that actually draws it. */
  const [creatingRoot, setCreatingRoot] = useState(false);

  const scoped = selection.kind === 'folder' || selection.kind === 'tag';

  /* §2.1: the three regions are separated by hairlines, and the note list is the
     one that takes the remaining space. Structure caps at 40 % + 25 % (§2.2) via
     the sections' own max-heights, so a deep folder tree cannot squeeze the list
     out — but the list also has to be allowed to *shrink* below its content when
     the window is short, which needs `min-h-0` on the flex child. */
  return (
    <aside
      aria-label="Sidebar"
      data-testid="sidebar"
      style={{ width }}
      className="flex flex-none flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--surface-raised)]"
    >
      <Filters selection={selection} onSelect={onSelect} />

      <section aria-label="Folders" className="min-h-0 overflow-hidden">
        <SectionHead
          icon={<Folder className="icon i-16" aria-hidden="true" />}
          label="Folders"
          singular="folder"
          /* §6.3: creating a folder is an inline input, not a dialog. `+` opens
             it and `Enter` commits, which is why this is a request rather than a
             write — the input has to exist before there is anything to write. */
          onAdd={() => {
            setCreatingRoot((open) => !open);
          }}
        />
        <FolderTree
          nodes={folders}
          counts={folderCounts}
          selection={selection}
          collapsed={collapsedFolders}
          onSelect={onSelect}
          onToggle={onToggleFolder}
          onCreate={onCreateFolder}
          onRename={onRenameFolder}
          onDelete={onDeleteFolder}
          onMove={onMoveFolder}
          onError={onFolderError}
          creatingRoot={creatingRoot}
          onCreatingRootChange={setCreatingRoot}
        />
      </section>

      <section aria-label="Tags" className="min-h-0 overflow-hidden">
        <SectionHead
          icon={<Hash className="icon i-16" aria-hidden="true" />}
          label="Tags"
          singular="tag"
          onAdd={onCreateTag}
        />
        <div className="max-h-[25vh] overflow-y-auto px-2 pb-[10px]">
          {tags === undefined || tags.length === 0 ? (
            <p className="px-[6px] py-1 text-[13px] text-[var(--text-subtle)]">No tags yet</p>
          ) : (
            tags.map((tag) => {
              const active = selection.kind === 'tag' && selection.id === tag.id;
              return (
                <div
                  key={tag.id}
                  data-testid="tag-row"
                  data-tag-id={tag.id}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    onSelect({ kind: 'tag', id: tag.id });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect({ kind: 'tag', id: tag.id });
                    }
                  }}
                  className={`flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[var(--r-input)] py-0 pl-[6px] pr-2 text-[13px] transition-colors ${
                    active
                      ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                      : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                  }`}
                >
                  <Hash className="icon i-16 flex-none opacity-70" aria-hidden="true" />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{tag.name}</span>
                  <span className="ml-auto pl-1 text-[11px] text-[var(--text-subtle)]">{tag.count}</span>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col border-t border-[var(--border)]">
        <header className="flex items-baseline justify-between border-b border-[var(--border)] px-3 py-[10px] text-[12px] font-medium text-[var(--text)]">
          <span className="truncate" data-testid="list-header">
            {header.title}
          </span>
          <span
            className="shrink-0 pl-2 font-normal text-[var(--text-subtle)]"
            data-testid="list-count"
          >
            {header.count}
          </span>
        </header>

        {isPending ? (
          <div className="min-h-0 flex-1" data-testid="list-pending" />
        ) : firstLaunch ? (
          <FirstLaunch onNewNote={onNewNote} />
        ) : (
          <NoteList
            notes={notes ?? EMPTY_NOTES}
            openNoteId={openNoteId}
            now={now}
            folderNames={folderNames}
            showFolder={!scoped}
            onOpen={onOpenNote}
            onTogglePin={selection.kind === 'trash' ? undefined : onTogglePin}
            pinPendingId={pinPendingId ?? null}
            empty={emptyFor(selection, onNewNote)}
          />
        )}
      </section>
    </aside>
  );
}

function Filters({
  selection,
  onSelect,
}: {
  selection: Selection;
  onSelect: (next: Selection) => void;
}) {
  const inTrash = selection.kind === 'trash';

  return (
    <div className="flex items-center gap-1 p-3">
      <div role="tablist" aria-label="Filters" className="flex flex-1 gap-[3px]">
        <FilterTab
          label="All"
          selected={selection.kind === 'all'}
          onClick={() => {
            onSelect({ kind: 'all' });
          }}
        />
        <FilterTab
          label="Pinned"
          icon={<Pin className="icon i-16" aria-hidden="true" />}
          selected={selection.kind === 'pinned'}
          onClick={() => {
            onSelect({ kind: 'pinned' });
          }}
        />
        <FilterTab
          label="Trash"
          icon={<Trash className="icon i-16" aria-hidden="true" />}
          selected={inTrash}
          onClick={() => {
            onSelect({ kind: 'trash' });
          }}
        />
      </div>
    </div>
  );
}

function FilterTab({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid={`filter-${label.toLowerCase()}`}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-[5px] rounded bg-transparent py-1.5 text-[12px] font-medium transition-colors ${
        selected
          ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SectionHead({
  icon,
  label,
  singular,
  onAdd,
}: {
  icon: ReactNode;
  label: string;
  singular: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-[6px] px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
      <span className="flex text-[var(--text-subtle)]">{icon}</span>
      {label}
      <button
        type="button"
        aria-label={`New ${singular}`}
        title={`New ${singular}`}
        onClick={onAdd}
        className="ml-auto grid h-5 w-5 place-items-center rounded bg-transparent text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--accent)]"
      >
        <Plus className="icon i-16" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ADR-014: first launch creates no folders and no tags, so the very first thing
   a user sees is an empty structure. The dashed border marks it as a starting
   point rather than a container that already exists. */
function FirstLaunch({ onNewNote }: { onNewNote: () => void }) {
  return (
    <div className="flex flex-1 items-start justify-center px-4 pt-8">
      <div className="flex min-h-[170px] w-full max-w-[280px] flex-col items-center justify-center gap-[10px] rounded-[var(--r-card)] border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-6 py-8 text-center">
        <span className="flex items-center gap-[7px] text-[15px] font-medium text-[var(--text)]">
          <span className="flex text-[var(--text-subtle)]">
            <FilePlus className="icon i-20" aria-hidden="true" />
          </span>
          No notes yet
        </span>
        <p className="max-w-[30ch] text-[13px] leading-[1.5] text-[var(--text-muted)]">
          Your notes are stored on this device and never leave it.
        </p>
        <button
          type="button"
          data-testid="first-launch-new-note"
          onClick={onNewNote}
          className="mt-1 flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="icon i-16" aria-hidden="true" />
          New note
        </button>
      </div>
    </div>
  );
}

function headerFor(
  selection: Selection,
  notes: NoteSummary[],
  folderNames: Map<string, string>,
): { title: string; count: string } {
  const count = plural(notes.length, 'note');
  switch (selection.kind) {
    case 'all':
      return { title: 'All notes', count };
    case 'pinned':
      return { title: 'Pinned', count };
    case 'trash':
      return { title: 'Trash', count };
    case 'folder':
      return { title: folderNames.get(selection.id) ?? 'Folder', count };
    case 'tag':
      /* `tags_list` returns the name, but the sidebar holds the flat tag list
         rather than threading it here; the first note in the list carries the
         same tag row, and an empty tag selection falls back to a generic title. */
      return { title: `Tag${tagNameOf(notes, selection.id)}`, count };
  }
}

function tagNameOf(notes: NoteSummary[], tagId: Uuid): string {
  for (const note of notes) {
    const tag = note.tags.find((candidate) => candidate.id === tagId);
    if (tag !== undefined) return `: ${tag.name}`;
  }
  return '';
}

/* Every empty state explains the cause, not just the fact (§8). The copy differs
   per selection because "nothing here" and "nothing pinned" are different
   situations and one generic message would explain neither. */
function emptyFor(
  selection: Selection,
  onNewNote: () => void,
): { title: string; body: string; action?: ReactNode } {
  switch (selection.kind) {
    case 'pinned':
      return {
        title: 'Nothing pinned',
        body: 'Pin a note with Ctrl+D to keep it at the top of the list.',
        action: <GhostAction label="New note" onClick={onNewNote} />,
      };
    case 'trash':
      return { title: 'Trash is empty', body: 'Deleted notes stay in the trash until you empty it.' };
    case 'folder':
      return {
        title: 'Nothing here',
        body: 'This folder is empty.',
        action: <GhostAction label="New note" onClick={onNewNote} />,
      };
    case 'tag':
      return { title: 'No notes with this tag', body: 'Add the tag from the editor status bar.' };
    case 'all':
      return {
        title: 'Nothing here',
        body: 'No notes in this view.',
        action: <GhostAction label="New note" onClick={onNewNote} />,
      };
  }
}

function GhostAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)]"
    >
      <Plus className="icon i-16" aria-hidden="true" />
      {label}
    </button>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/* One shared empty list rather than a fresh `[]` per render, so passing it to a
   memoised child does not invalidate the memo on every parent render. */
const EMPTY_NOTES: NoteSummary[] = [];
