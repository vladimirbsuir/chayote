import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
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

/* The sidebar: three stacked regions, not three columns (`05-ui-ux.md` §2.1).
   Filters, then structure, then the list, separated by hairlines, with exactly
   one region interactive at a time. Folders cap at 40 % of the pane and tags at
   25 % (§2.2), so a long folder tree can never squeeze the note list out of
   existence.

   This component owns no selection state. It reads the selection store and
   writes to it, which keeps the model in one place (§5). */

/** The list region's mode. `null` is the selection's own notes; an object is a
    running search, and §6.5 puts the structure above the list so a search can
    still be scoped — only the third region changes. */
export type SidebarSearch = {
  /** The query the visible results actually correspond to. Not the raw field
      text: while a keystroke is still inside the 150 ms debounce the field says
      "roadmaps" and the results are for "road", and a header naming the newer
      one would be describing something that is not on screen. */
  query: string;
  /** Every match in the scope, which exceeds the loaded pages once a search is
      long enough to need a second page. */
  total: number;
};

/** The tag menu's own metrics, from the prototype's popover: 168 px is the
    narrowest that fits a two-word item at 13 px with room to spare, and 120 px
    is its height with two items. Used only to decide which way it opens. */
const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 120;

type SidebarProps = {
  selection: Selection;
  /** Desktop/tablet pane width in px. Null in the mobile list view, where the
      sidebar is the whole column (`05-ui-ux.md` §2.4) rather than a sized pane
      with a divider — a fixed width there leaves a dead strip and a stray
      border at the viewport edge. */
  width: number | null;
  folders: FolderNode[] | undefined;
  tags: TagWithCount[] | undefined;
  notes: NoteRow[] | undefined;
  /** Non-null while the field holds a real query (§6.5). */
  search: SidebarSearch | null;
  onClearSearch: () => void;
  /** The control that appends the next page, present only when there is one. */
  searchFooter?: ReactNode;
  isPending: boolean;
  now: number;
  folderNames: Map<string, string>;
  folderCounts: Map<string, number>;
  collapsedFolders: Uuid[];
  /** Whether the whole Folders / Tags list is collapsed. Optional so callers
      that do not persist section state — tests — still get a working toggle
      from the uncontrolled fallback below. */
  foldersCollapsed?: boolean;
  tagsCollapsed?: boolean;
  onToggleFoldersCollapsed?: () => void;
  onToggleTagsCollapsed?: () => void;
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
  /** §6.2: delete, and — in the trash — restore and permanent delete. Absent in the
      trash's own list header for `onEmptyTrash` when there is nothing to empty. */
  onDeleteNote?: (id: Uuid) => void;
  onRestoreNote?: (id: Uuid) => void;
  onDestroyNote?: (id: Uuid) => void;
  onEmptyTrash?: () => void;
  onToggleFolder: (id: Uuid) => void;
  /** §6.3: creating a folder is an inline input in the tree, committed with `Enter`.
      Returns a promise so the input can stay open on a rejected write, rather than
      closing and losing what was typed. */
  onCreateFolder: (name: string, parentId: Uuid | null) => Promise<void>;
  onRenameFolder: (id: Uuid, name: string) => Promise<void>;
  onDeleteFolder: (id: Uuid) => Promise<void>;
  /** §6.3: drag to re-parent and reorder. `position` is sibling-local and the
      backend densifies it (`03-data-model.md` §3.2). */
  onMoveFolder: (id: Uuid, newParentId: Uuid | null, position: number) => Promise<void>;
  /** Shown where a folder write failed. `AppError.message` is user-facing copy
      by contract (`10-conventions.md` §6). */
  onFolderError?: (message: string) => void;
  /** ADR-021: tags are created from the sidebar `+` as well as from a note's tag
      editor. Each returns a promise so the input can stay open on a rejected
      write, rather than closing and losing what was typed. */
  onCreateTag: (name: string) => Promise<void>;
  onRenameTag: (id: Uuid, name: string) => Promise<void>;
  onDeleteTag: (id: Uuid) => Promise<void>;
  /** Shown where a tag write failed. Same contract as `onFolderError`. */
  onTagError?: (message: string) => void;
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
}: SidebarProps) {
  const header = useMemo(
    () => headerFor(selection, notes ?? EMPTY_NOTES, folderNames, tags, search),
    [selection, notes, folderNames, tags, search],
  );

  /* Whether the root-level folder create input is open. It lives here because the
     `+` that opens it is in the section header above the tree, and the input
     itself is rendered by `FolderTree` — the two halves of one control, each owned
     by the component that actually draws it. */
  const [creatingRoot, setCreatingRoot] = useState(false);

  /* The uncontrolled fallback for the section toggles below: the app passes the
     persisted values and their toggles, and anything that does not — tests —
     gets local state instead, so the headers are collapsible either way. */
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

  /* The tag create input and the single row being renamed. One rename at a time —
     a second editor would compete for the same keystroke — while the create
     input is separate because its trigger lives in the section header. Opening
     one closes the other. */
  const [creatingTag, setCreatingTag] = useState(false);
  const [tagName, setTagName] = useState('');
  const [renamingTag, setRenamingTag] = useState<{ id: Uuid; name: string } | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  /* One open tag menu for the whole list, held here rather than in the rows:
     per-row state lets two holds open two menus at once — the defect
     `NoteList` and `FolderTree` hold their single menu for. */
  const [tagMenu, setTagMenu] = useState<{
    id: Uuid;
    placement: { top: number; left: number };
  } | null>(null);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<{
    id: Uuid;
    name: string;
    count: number;
  } | null>(null);

  /* Measured on the phone: the release after a hold synthesises a click on
     engines that do, which would select the row under its own just-opened
     menu. The flag eats exactly that one — the same guard the note cards
     carry, for the same gesture. Set only on a fresh open from `contextmenu`:
     a press that closes an open menu synthesises nothing after it. */
  const suppressTagOpenRef = useRef(false);

  /* Measured in the handler that opens it and handed to the menu as a plain
     value — the row-menu contract all three menus share. Always sets, never
     toggles: a second press on another row replaces. */
  const openTagMenu = (id: Uuid, anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect();
    const up =
      rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight &&
      rect.top > MENU_ESTIMATED_HEIGHT;
    setTagMenu({
      id,
      placement: {
        /* Clamped so the estimate always lands inside the viewport — the same
           13 px clip the note rows hit in the trash-restore flow: moving the
           top above the row does not move the box's bottom edge with it. */
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

  /* §6.4: creating a tag is an inline input, committed with `Enter` — the same
     shape as the folder one, including empty-cancels and keep-editing on a
     rejected write. The input stays open throughout the write: clearing it
     upfront is what would lose the text on a `VALIDATION` refusal. */
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

  /* §2.1: the three regions are separated by hairlines, and the note list is the
     one that takes the remaining space. Structure caps at 40 % + 25 % (§2.2) via
     the sections' own max-heights, so a deep folder tree cannot squeeze the list
     out — but the list also has to be allowed to *shrink* below its content when
     the window is short, which needs `min-h-0` on the flex child. */
  return (
    <aside
      aria-label="Sidebar"
      data-testid="sidebar"
      style={width === null ? undefined : { width }}
      /* Chrome text is not selectable anywhere in the sidebar: on touch a hold
         is a row gesture (open, menu) or a field edit, never a text selection —
         and a hold over selectable text becomes a selection gesture with no
         `contextmenu` at all. Text inputs opt back in explicitly with
         `select-text`, so an input nested here keeps its selection toolbar. */
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
          /* §6.3: creating a folder is an inline input, not a dialog. `+` opens
             it and `Enter` commits, which is why this is a request rather than a
             write — the input has to exist before there is anything to write.
             From a collapsed section it expands first, so the input it opens is
             actually on screen. */
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
          /* ADR-021: tags are created here as well as in a note's tag editor.
             `+` opens an inline input and `Enter` commits — the same shape as
             the folder one. From a collapsed section it expands first, so the
             input it opens is actually on screen. */
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
              /* A row being renamed is not a row any more: it is an input, the
                 same swap the folder rows make, so the old name is not left in
                 the list beside a second control in the tab order. */
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
                    /* §7: `ContextMenu` opens the focused row's menu — the
                       application key on a Windows keyboard, and the standard
                       way to ask for a menu. */
                    if (event.key === 'ContextMenu') {
                      event.preventDefault();
                      openTagMenu(tag.id, event.currentTarget);
                    }
                  }}
                  /* §2.2 and §9: right-click on desktop, long-press on touch,
                     and the row's own button, all reach the same menu. The row
                     is not selectable: on a text-rich row a hold becomes a
                     text selection and no `contextmenu` fires at all — measured
                     on the note cards, where a hold grabbed a header two rows
                     up. Copying happens in the editor, not in the list. */
                  onContextMenu={(event) => {
                    event.preventDefault();
                    /* Only a fresh open can precede a release click: when a
                       menu is already up the press replaces it, and no click
                       follows that. */
                    if (tagMenu === null) suppressTagOpenRef.current = true;
                    openTagMenu(tag.id, event.currentTarget);
                  }}
                  className={`group relative flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[var(--r-input)] py-0 pr-2 pl-1 text-[13px] transition-colors select-none ${
                    active
                      ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                      : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                  }`}
                >
                  {/* The header chevron's width as a spacer, mirroring the folder
                      rows: the tag glyph hangs under the section glyph the way a
                      folder glyph hangs under its header's, at any root size. */}
                  <span aria-hidden="true" className="w-5 flex-none" />
                  <Hash
                    data-testid="tag-icon"
                    className="icon i-16 flex-none opacity-70"
                    aria-hidden="true"
                  />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{tag.name}</span>
                  <span className="ml-auto pl-1 text-[11px] text-[var(--text-subtle)]">{tag.count}</span>
                  {tagMenu !== null && tagMenu.id === tag.id ? (
                    <TagRowMenu
                      tagId={tag.id}
                      tagName={tag.name}
                      placement={tagMenu.placement}
                      onAction={runTagMenuAction}
                      onClose={closeTagMenu}
                    />
                  ) : (
                    /* `pointer-fine:group-hover:flex`, in that order: `hidden`
                       first so the button is absent by default, then the two
                       variants that turn it on. §9 says hover styling exists at
                       `pointer: fine` and nowhere else. On touch the menu opens
                       by long-press instead. */
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
          {/* The create input sits after the list, where the root folder input
              sits after the tree: a new tag joins the top level (§6.4). */}
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

      {/* `select-none`: on touch a hold anywhere near the rows must reach the
          row's `contextmenu`, not the platform's text selection — measured on
          the device, where a hold over a card grabbed the "Empty trash" header
          two rows up and no menu ever opened. Copying happens in the editor. */}
      <section className="flex min-h-0 flex-1 flex-col border-t border-[var(--border)] select-none">
        <header className="flex items-baseline justify-between border-b border-[var(--border)] px-3 py-[10px] text-[12px] font-medium text-[var(--text)]">
          <span className="truncate" data-testid="list-header">
            {header.title}
          </span>
          <div className="flex shrink-0 items-center gap-2 pl-2">
            {/* §10: "Search results announce the count via aria-live='polite'".
                It is always a live region rather than one mounted for a search,
                because a region that is added to the page already holding the
                value has nothing to announce — the count would go silent exactly
                when a screen reader user needs it. A selection switch changes it
                too, and that is the same kind of fact. */}
            <span
              aria-live="polite"
              className="font-normal text-[var(--text-subtle)]"
              data-testid="list-count"
            >
              {header.count}
            </span>
            {/* §6.2: emptying the trash is destructive and irreversible, so it is
                here rather than on a card, and only when there is something to
                empty. */}
            {selection.kind === 'trash' && onEmptyTrash !== undefined && (notes?.length ?? 0) > 0 ? (
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

        {/* ADR-014's first-launch state is a state of the *selection*, so a
            search with no hits is not one. Reaching it with the field full would
            claim the device holds no notes, which is the opposite of what the
            user just saw. */}
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
  /** Absent where there is nothing to add in place — the Tags section, where a
      fresh tag would be invisible until a note carries it. */
  onAdd?: () => void;
  /** Whether the whole section's list is collapsed. With the toggle below this
      hides many top-level folders or tags at once; the per-folder twisties
      inside the tree are the finer control. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** The list the toggle controls, for `aria-controls`. */
  controlsId?: string;
}) {
  const expanded = collapsed !== true;
  return (
    <div className="flex items-center gap-[6px] px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
      {onToggleCollapsed === undefined ? (
        <span data-testid={`section-icon-${label.toLowerCase()}`} className="flex text-[var(--text-subtle)]">
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
            /* The twisty's reasoning applies here too: 16 px against §9's 44 px
               touch bar, so the same invisible coarse-pointer hit slop roughly
               doubles the target without moving any pixel. */
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
  notes: NoteRow[],
  folderNames: Map<string, string>,
  tags: TagWithCount[] | undefined,
  search: SidebarSearch | null,
): { title: string; count: string } {
  if (search !== null) {
    /* §6.5: relevance order, not the pinned/updated order of the normal list.
       A header that said "Work" would be claiming a scope that is not in force
       — the scope is whatever the sidebar's structure region says, and the
       search says only which of those notes matched. */
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
      /* The first note in the list usually carries the tag row; a selected tag
         with no notes at all (ADR-021) is named from the sidebar's own list,
         and only a tag in neither falls back to a generic title. */
      return { title: `Tag${tagNameOf(notes, tags, selection.id)}`, count };
  }
}

function tagNameOf(notes: NoteRow[], tags: TagWithCount[] | undefined, tagId: Uuid): string {
  for (const note of notes) {
    const tag = note.tags.find((candidate) => candidate.id === tagId);
    if (tag !== undefined) return `: ${tag.name}`;
  }
  /* ADR-021: a selected tag can have no notes at all, in which case no row
     carries its name and the sidebar's own list is what names it. */
  const listed = tags?.find((candidate) => candidate.id === tagId);
  if (listed !== undefined) return `: ${listed.name}`;
  return '';
}

/** `3 results`, or `500 of 4,123 results` while more pages remain. The count is
    the honest one: a header reporting the loaded rows on its own would tell a
    user searching for a common word that they had found everything. */
function countWithTotal(loaded: number, total: number, noun: string): string {
  const label = `${total} ${noun}${total === 1 ? '' : 's'}`;
  return loaded < total ? `${loaded} of ${label}` : label;
}

/* Every empty state explains the cause, not just the fact (§8). The copy differs
   per selection because "nothing here" and "nothing pinned" are different
   situations and one generic message would explain neither. */
function emptyFor(
  selection: Selection,
  search: SidebarSearch | null,
  onNewNote: () => void,
  onClearSearch: () => void,
): { title: string; body: string; icon: ReactNode; action?: ReactNode } {
  if (search !== null) {
    /* §8, and the prototype's fourth state: `search` from the §3.3 inventory, the
       query in quotes so the user can see which one found nothing, and a cause
       that tells them what the search does cover rather than only what it did
       not find. */
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

/** `AppError` reaches the frontend as `{ code, message }` over IPC and as a
    `MockBackendError` with the same two fields (`10-conventions.md` §6). The
    message is user-facing copy by contract, so it is safe to show inline; an
    unrecognised throw gets the generic text rather than `undefined`. */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'That could not be saved.';
}

/* One shared empty list rather than a fresh `[]` per render, so passing it to a
   memoised child does not invalidate the memo on every parent render. */
const EMPTY_NOTES: NoteRow[] = [];
