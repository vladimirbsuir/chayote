import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FilePlus,
  Folder,
  Hash,
  Inbox,
  Pin,
  Plus,
  Search,
  Trash,
  X,
} from 'lucide-react';
import type { NoteRow, Selection } from '../types/ipc';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';
import type { Uuid } from '../types/note';
import { NoteList } from './NoteList';
import { FolderTree } from './FolderTree';
import { ConfirmDialog } from './ConfirmDialog';
import { InlineNameInput } from './InlineNameInput';
import { TagMenuButton, TagRowMenu } from './TagRowMenu';
import type { TagMenuAction } from './TagRowMenu';

export type SidebarSearch = {
  query: string;
  total: number;
};

const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 120;

type SidebarProps = {
  selection: Selection;
  width: number | null;
  folders: FolderNode[] | undefined;
  tags: TagWithCount[] | undefined;
  notes: NoteRow[] | undefined;
  search: SidebarSearch | null;
  onClearSearch: () => void;
  searchFooter?: ReactNode;
  isPending: boolean;
  now: number;
  folderNames: Map<string, string>;
  folderCounts: Map<string, number>;
  collapsedFolders: Uuid[];
  foldersCollapsed?: boolean;
  tagsCollapsed?: boolean;
  onToggleFoldersCollapsed?: () => void;
  onToggleTagsCollapsed?: () => void;
  openNoteId: Uuid | null;
  firstLaunch: boolean;
  onSelect: (selection: Selection) => void;
  onOpenNote: (id: Uuid) => void;
  onNewNote: () => void;
  onTogglePin?: (id: Uuid) => void;
  pinPendingId?: Uuid | null;
  onDeleteNote?: (id: Uuid) => void;
  onRestoreNote?: (id: Uuid) => void;
  onDestroyNote?: (id: Uuid) => void;
  onEmptyTrash?: () => void;
  onToggleFolder: (id: Uuid) => void;
  onCreateFolder: (name: string, parentId: Uuid | null) => Promise<void>;
  onRenameFolder: (id: Uuid, name: string) => Promise<void>;
  onDeleteFolder: (id: Uuid) => Promise<void>;
  onMoveFolder: (id: Uuid, newParentId: Uuid | null, position: number) => Promise<void>;
  onFolderError?: (message: string) => void;
  onCreateTag: (name: string) => Promise<void>;
  onRenameTag: (id: Uuid, name: string) => Promise<void>;
  onDeleteTag: (id: Uuid) => Promise<void>;
  onTagError?: (message: string) => void;
  conflictCount?: number;
  onOpenConflicts?: () => void;
};

export function Sidebar({
  selection,
  width,
  folders,
  tags,
  notes,
  search,
  onClearSearch,
  searchFooter,
  isPending,
  now,
  folderNames,
  folderCounts,
  collapsedFolders,
  foldersCollapsed: foldersCollapsedProp,
  tagsCollapsed: tagsCollapsedProp,
  openNoteId,
  firstLaunch,
  onSelect,
  onOpenNote,
  onNewNote,
  onTogglePin,
  pinPendingId,
  onDeleteNote,
  onRestoreNote,
  onDestroyNote,
  onEmptyTrash,
  onToggleFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onFolderError,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
  onTagError,
  onToggleFoldersCollapsed: onToggleFoldersCollapsedProp,
  onToggleTagsCollapsed: onToggleTagsCollapsedProp,
  conflictCount,
  onOpenConflicts,
}: SidebarProps) {
  const header = useMemo(
    () => headerFor(selection, notes ?? EMPTY_NOTES, folderNames, tags, search),
    [selection, notes, folderNames, tags, search],
  );

  const [creatingRoot, setCreatingRoot] = useState(false);

  const [foldersLocal, setFoldersLocal] = useState(false);
  const [tagsLocal, setTagsLocal] = useState(false);
  const foldersIsCollapsed = foldersCollapsedProp ?? foldersLocal;
  const tagsIsCollapsed = tagsCollapsedProp ?? tagsLocal;
  const toggleFoldersCollapsed =
    onToggleFoldersCollapsedProp ??
    (() => {
      setFoldersLocal((open) => !open);
    });
  const toggleTagsCollapsed =
    onToggleTagsCollapsedProp ??
    (() => {
      setTagsLocal((open) => !open);
    });

  const [creatingTag, setCreatingTag] = useState(false);
  const [tagName, setTagName] = useState('');
  const [renamingTag, setRenamingTag] = useState<{ id: Uuid; name: string } | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagMenu, setTagMenu] = useState<{
    id: Uuid;
    placement: { top: number; left: number };
  } | null>(null);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<{
    id: Uuid;
    name: string;
    count: number;
  } | null>(null);

  const suppressTagOpenRef = useRef(false);

  const openTagMenu = (id: Uuid, anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect();
    const up =
      rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight && rect.top > MENU_ESTIMATED_HEIGHT;
    setTagMenu({
      id,
      placement: {
        top: Math.min(
          Math.max(8, up ? rect.top - 4 : rect.bottom + 4),
          window.innerHeight - MENU_ESTIMATED_HEIGHT - 8,
        ),
        left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
      },
    });
  };
  const closeTagMenu = (): void => {
    suppressTagOpenRef.current = false;
    setTagMenu(null);
  };

  const closeTagEditing = (): void => {
    setCreatingTag(false);
    setTagName('');
    setRenamingTag(null);
    setTagError(null);
  };

  const commitTagCreate = (): void => {
    const name = tagName.trim();
    if (name.length === 0) {
      closeTagEditing();
      return;
    }
    void onCreateTag(name).then(
      () => {
        closeTagEditing();
      },
      (error: unknown) => {
        setTagError(messageOf(error));
      },
    );
  };

  const commitTagRename = (): void => {
    if (renamingTag === null) return;
    const target = renamingTag;
    const name = target.name.trim();
    if (name.length === 0) {
      closeTagEditing();
      return;
    }
    void onRenameTag(target.id, name).then(
      () => {
        closeTagEditing();
      },
      (error: unknown) => {
        setTagError(messageOf(error));
      },
    );
  };

  const runTagMenuAction = (action: TagMenuAction, id: Uuid): void => {
    closeTagMenu();
    const tag = tags?.find((candidate) => candidate.id === id);
    if (tag === undefined) return;
    if (action === 'rename') {
      setCreatingTag(false);
      setTagName('');
      setRenamingTag({ id, name: tag.name });
      setTagError(null);
      return;
    }
    setPendingDeleteTag({ id, name: tag.name, count: tag.count });
  };

  const scoped = selection.kind === 'folder' || selection.kind === 'tag';

  return (
    <aside
      aria-label="Sidebar"
      data-testid="sidebar"
      style={width === null ? undefined : { width }}
      className={`flex flex-col overflow-hidden bg-[var(--surface-raised)] select-none ${
        width === null ? 'min-h-0 flex-1' : 'flex-none border-r border-[var(--border)]'
      }`}
    >
      <Filters selection={selection} onSelect={onSelect} />

      <section aria-label="Folders" className="min-h-0 overflow-hidden">
        <SectionHead
          icon={<Folder className="icon i-16" aria-hidden="true" />}
          label="Folders"
          singular="folder"
          onAdd={() => {
            if (foldersIsCollapsed) toggleFoldersCollapsed();
            setCreatingRoot((open) => !open);
          }}
          collapsed={foldersIsCollapsed}
          onToggleCollapsed={toggleFoldersCollapsed}
          controlsId="sidebar-folders"
        />
        {foldersIsCollapsed ? null : (
          <div id="sidebar-folders">
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
          </div>
        )}
      </section>

      <section aria-label="Tags" className="min-h-0 overflow-hidden">
        <SectionHead
          icon={<Hash className="icon i-16" aria-hidden="true" />}
          label="Tags"
          singular="tag"
          onAdd={() => {
            if (tagsIsCollapsed) toggleTagsCollapsed();
            setRenamingTag(null);
            setTagError(null);
            setCreatingTag((open) => !open);
          }}
          collapsed={tagsIsCollapsed}
          onToggleCollapsed={toggleTagsCollapsed}
          controlsId="sidebar-tags"
        />
        {tagsIsCollapsed ? null : (
          <div id="sidebar-tags" className="max-h-[25vh] overflow-y-auto px-2 pb-[10px]">
            {tags === undefined || tags.length === 0 ? (
              <p className="px-[6px] py-1 text-[13px] text-[var(--text-subtle)]">No tags yet</p>
            ) : (
              tags.map((tag) => {
                const active = selection.kind === 'tag' && selection.id === tag.id;
                if (renamingTag !== null && renamingTag.id === tag.id) {
                  return (
                    <div key={tag.id}>
                      <InlineNameInput
                        label={`Rename ${tag.name}`}
                        placeholder="Tag name"
                        testId="tag-name-input"
                        value={renamingTag.name}
                        error={tagError}
                        onChange={(name) => {
                          setRenamingTag({ id: tag.id, name });
                          setTagError(null);
                        }}
                        onCommit={commitTagRename}
                        onCancel={closeTagEditing}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={tag.id}
                    data-testid="tag-row"
                    data-tag-id={tag.id}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      if (suppressTagOpenRef.current) {
                        suppressTagOpenRef.current = false;
                        return;
                      }
                      onSelect({ kind: 'tag', id: tag.id });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect({ kind: 'tag', id: tag.id });
                      }
                      if (event.key === 'ContextMenu') {
                        event.preventDefault();
                        openTagMenu(tag.id, event.currentTarget);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (tagMenu === null) suppressTagOpenRef.current = true;
                      openTagMenu(tag.id, event.currentTarget);
                    }}
                    className={`group relative flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[var(--r-input)] py-0 pr-2 pl-1 text-[13px] transition-colors select-none ${
                      active
                        ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                        : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                    }`}
                  >
                    <span aria-hidden="true" className="w-5 flex-none" />
                    <Hash
                      data-testid="tag-icon"
                      className="icon i-16 flex-none opacity-70"
                      aria-hidden="true"
                    />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {tag.name}
                    </span>
                    <span className="ml-auto pl-1 text-[11px] text-[var(--text-subtle)]">
                      {tag.count}
                    </span>
                    {tagMenu !== null && tagMenu.id === tag.id ? (
                      <TagRowMenu
                        tagId={tag.id}
                        tagName={tag.name}
                        placement={tagMenu.placement}
                        onAction={runTagMenuAction}
                        onClose={closeTagMenu}
                      />
                    ) : (
                      <span className="ml-auto hidden flex-none pointer-fine:group-hover:flex">
                        <TagMenuButton
                          tagName={tag.name}
                          onOpen={(button) => {
                            openTagMenu(tag.id, button);
                          }}
                        />
                      </span>
                    )}
                  </div>
                );
              })
            )}
            {creatingTag ? (
              <InlineNameInput
                label="New tag name"
                placeholder="Tag name"
                testId="tag-name-input"
                value={tagName}
                error={tagError}
                onChange={(name) => {
                  setTagName(name);
                  setTagError(null);
                }}
                onCommit={commitTagCreate}
                onCancel={closeTagEditing}
              />
            ) : null}
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col border-t border-[var(--border)] select-none">
        <header className="flex items-baseline justify-between border-b border-[var(--border)] px-3 py-[10px] text-[12px] font-medium text-[var(--text)]">
          <span className="truncate" data-testid="list-header">
            {header.title}
          </span>
          <div className="flex shrink-0 items-center gap-2 pl-2">
            <span
              aria-live="polite"
              className="font-normal text-[var(--text-subtle)]"
              data-testid="list-count"
            >
              {header.count}
            </span>
            {selection.kind === 'trash' &&
            onEmptyTrash !== undefined &&
            (notes?.length ?? 0) > 0 ? (
              <button
                type="button"
                data-testid="empty-trash"
                onClick={onEmptyTrash}
                className="text-[12px] text-[var(--danger)] hover:underline"
              >
                Empty trash
              </button>
            ) : null}
          </div>
        </header>

        {(conflictCount ?? 0) > 0 ? (
          <button
            type="button"
            data-testid="sync-conflict-badge"
            onClick={onOpenConflicts}
            className="flex flex-none items-center justify-center gap-1 border-b border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[12px] font-medium text-[var(--text)]"
          >
            <AlertCircle className="icon i-16" aria-hidden="true" />
            {conflictCount === 1
              ? '1 note changed on another device — review'
              : `${conflictCount} notes changed on another device — review`}
          </button>
        ) : null}

        {isPending ? (
          <div className="min-h-0 flex-1" data-testid="list-pending" />
        ) : firstLaunch && search === null ? (
          <FirstLaunch onNewNote={onNewNote} />
        ) : (
          <>
            <NoteList
              notes={notes ?? EMPTY_NOTES}
              openNoteId={openNoteId}
              now={now}
              folderNames={folderNames}
              showFolder={!scoped}
              onOpen={onOpenNote}
              onTogglePin={selection.kind === 'trash' ? undefined : onTogglePin}
              pinPendingId={pinPendingId ?? null}
              onDeleteNote={onDeleteNote}
              onRestoreNote={onRestoreNote}
              onDestroyNote={onDestroyNote}
              empty={emptyFor(selection, search, onNewNote, onClearSearch)}
            />
            {searchFooter}
          </>
        )}
      </section>
      {pendingDeleteTag === null ? null : (
        <ConfirmDialog
          title={`Delete “${pendingDeleteTag.name}”?`}
          body={
            pendingDeleteTag.count === 0
              ? `The tag is not used by any note.`
              : pendingDeleteTag.count === 1
                ? `The tag is removed from 1 note. The note itself is kept.`
                : `The tag is removed from ${pendingDeleteTag.count} notes. The notes themselves are kept.`
          }
          confirmLabel="Delete tag"
          onCancel={() => {
            setPendingDeleteTag(null);
          }}
          onConfirm={() => {
            const target = pendingDeleteTag;
            setPendingDeleteTag(null);
            void onDeleteTag(target.id).catch((error: unknown) => {
              onTagError?.(messageOf(error));
            });
          }}
        />
      )}
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
  collapsed,
  onToggleCollapsed,
  controlsId,
}: {
  icon: ReactNode;
  label: string;
  singular: string;
  onAdd?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  controlsId?: string;
}) {
  const expanded = collapsed !== true;
  return (
    <div className="flex items-center gap-[6px] px-3 pt-3 pb-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase">
      {onToggleCollapsed === undefined ? (
        <span
          data-testid={`section-icon-${label.toLowerCase()}`}
          className="flex text-[var(--text-subtle)]"
        >
          {icon}
        </span>
      ) : (
        <>
          <button
            type="button"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={expanded}
            aria-controls={controlsId}
            data-testid={`section-toggle-${label.toLowerCase()}`}
            onClick={onToggleCollapsed}
            className="relative grid h-5 w-5 flex-none place-items-center rounded bg-transparent text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
          >
            {expanded ? (
              <ChevronDown className="icon i-16" aria-hidden="true" />
            ) : (
              <ChevronRight className="icon i-16" aria-hidden="true" />
            )}
          </button>
          <span
            data-testid={`section-icon-${label.toLowerCase()}`}
            className="flex text-[var(--text-subtle)]"
          >
            {icon}
          </span>
        </>
      )}
      {label}
      {onAdd === undefined ? null : (
        <button
          type="button"
          aria-label={`New ${singular}`}
          title={`New ${singular}`}
          onClick={onAdd}
          className="ml-auto grid h-5 w-5 place-items-center rounded bg-transparent text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--accent)]"
        >
          <Plus className="icon i-16" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

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
  notes: NoteRow[],
  folderNames: Map<string, string>,
  tags: TagWithCount[] | undefined,
  search: SidebarSearch | null,
): { title: string; count: string } {
  if (search !== null) {
    return {
      title: `Results for “${search.query}”`,
      count: countWithTotal(notes.length, search.total, 'result'),
    };
  }
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
      return { title: `Tag${tagNameOf(notes, tags, selection.id)}`, count };
  }
}

function tagNameOf(notes: NoteRow[], tags: TagWithCount[] | undefined, tagId: Uuid): string {
  for (const note of notes) {
    const tag = note.tags.find((candidate) => candidate.id === tagId);
    if (tag !== undefined) return `: ${tag.name}`;
  }
  const listed = tags?.find((candidate) => candidate.id === tagId);
  if (listed !== undefined) return `: ${listed.name}`;
  return '';
}

function countWithTotal(loaded: number, total: number, noun: string): string {
  const label = `${total} ${noun}${total === 1 ? '' : 's'}`;
  return loaded < total ? `${loaded} of ${label}` : label;
}

function emptyFor(
  selection: Selection,
  search: SidebarSearch | null,
  onNewNote: () => void,
  onClearSearch: () => void,
): { title: string; body: string; icon: ReactNode; action?: ReactNode } {
  if (search !== null) {
    return {
      title: `No results for “${search.query}”`,
      body: 'Search covers titles and the full text of every note in this view.',
      icon: <Search className="icon i-20" aria-hidden="true" />,
      action: (
        <GhostAction
          label="Clear search"
          icon={<X className="icon i-16" aria-hidden="true" />}
          onClick={onClearSearch}
        />
      ),
    };
  }
  switch (selection.kind) {
    case 'pinned':
      return {
        title: 'Nothing pinned',
        body: 'Pin a note with Ctrl+D to keep it at the top of the list.',
        icon: <Pin className="icon i-20" aria-hidden="true" />,
        action: <GhostAction label="New note" onClick={onNewNote} />,
      };
    case 'trash':
      return {
        title: 'Trash is empty',
        body: 'Deleted notes stay in the trash until you empty it.',
        icon: <Trash className="icon i-20" aria-hidden="true" />,
      };
    case 'folder':
      return {
        title: 'Nothing here',
        body: 'This folder is empty.',
        icon: <Folder className="icon i-20" aria-hidden="true" />,
        action: <GhostAction label="New note" onClick={onNewNote} />,
      };
    case 'tag':
      return {
        title: 'No notes with this tag',
        body: 'Add the tag from the editor status bar.',
        icon: <Hash className="icon i-20" aria-hidden="true" />,
      };
    case 'all':
      return {
        title: 'Nothing here',
        body: 'No notes in this view.',
        icon: <Inbox className="icon i-20" aria-hidden="true" />,
        action: <GhostAction label="New note" onClick={onNewNote} />,
      };
  }
}

function GhostAction({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)]"
    >
      {icon ?? <Plus className="icon i-16" aria-hidden="true" />}
      {label}
    </button>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'That could not be saved.';
}

const EMPTY_NOTES: NoteRow[] = [];
