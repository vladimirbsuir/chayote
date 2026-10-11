import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { descendantCount, dropZoneAt, resolveDrop, treeKeyAction, visibleFolderRows } from './folderRows';
import { ConfirmDialog } from './ConfirmDialog';
import { FolderMenuButton, FolderRowMenu } from './FolderRowMenu';
import { InlineNameInput } from './InlineNameInput';
import type { DropZone } from './folderRows';
import type { FolderMenuAction } from './FolderRowMenu';
import type { Selection } from '../types/ipc';
import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

/* The folder tree: recursive, collapsible, keyboard navigable
   (`05-ui-ux.md` §10), and draggable to re-parent and reorder (§6.3).

   Two decisions are load-bearing:

   **Roving tabindex.** Every row is a `treeitem`, so a depth-10 tree would put
   ten-plus stops in the tab order and a keyboard user would tab through the whole
   structure to reach the note list. The tree is one tab stop; arrows move within
   it. This is the WAI-ARIA tree pattern and it is what §10 asks for.

   **A flat row list underneath a recursive render.** The DOM stays nested, which
   is what `role="tree"` requires, but navigation reads from the flattened list in
   `folderRows.ts`. Recursion and keyboard navigation are different problems and
   solving them in one function makes both harder to test. */

type FolderTreeProps = {
  nodes: FolderNode[] | undefined;
  counts: Map<string, number>;
  selection: Selection;
  collapsed: Uuid[];
  onSelect: (next: Selection) => void;
  onToggle: (id: Uuid) => void;
  /** §6.3: creating a folder is an inline text input in place. The parent is
      `null` for a root folder, or the focused folder to nest inside it. */
  onCreate: (name: string, parentId: Uuid | null) => Promise<void>;
  onRename: (id: Uuid, name: string) => Promise<void>;
  onDelete: (id: Uuid) => Promise<void>;
  /** §6.3: drag to re-parent and reorder. `position` is sibling-local and the
      backend densifies it (`03-data-model.md` §3.2), so this only supplies the
      parent and the slot index. */
  onMove: (id: Uuid, newParentId: Uuid | null, position: number) => Promise<void>;
  /** Rejected names come back as `VALIDATION` and stay in the input with the
      message beside it (§8, "Keep editing"), rather than closing the editor. */
  onError?: (message: string) => void;
  /** Whether the root-level create input is open. Held by the sidebar, because
      the `+` that opens it lives in the section header above the tree. */
  creatingRoot: boolean;
  onCreatingRootChange: (open: boolean) => void;
};

/** What a *row* is currently editing: a rename, or a new child of that row. One
    slot rather than a per-row flag, because there can only be one inline editor
    at a time — a second one would be a second focus target competing for the same
    keystroke.

    The root-level create input is deliberately *not* in here. Its trigger is the
    `+` in the section header, which lives above the tree in `Sidebar`, so its
    open state is owned there and arrives as `creatingRoot`. Two owners for one
    editor is how an input ends up open in two places, or open with nobody able to
    close it. */
type Editing =
  | { kind: 'rename'; id: Uuid; name: string }
  | { kind: 'create'; parentId: Uuid; name: string }
  | null;

/** Everything `commit` can write. `createRoot` is separate from `create` with a
    null parent because the two restore differently on rejection: a row editor is a
    slot in `editing`, while the root input's text is its own state because its open
    flag belongs to the sidebar. Folding them together would force one of the two
    restore paths to be wrong. */
type CommitTarget =
  | { kind: 'rename'; id: Uuid; name: string }
  | { kind: 'create'; parentId: Uuid; name: string }
  | { kind: 'createRoot'; name: string };

/** Where a drag currently is. `zone` is which band of the target row the pointer is
    over — `before`/`after` reorder among siblings, `inside` makes the row the new
    parent. A `null` zone means the pointer is over a row that cannot accept this
    folder, which is what draws the "not allowed" cursor instead of a drop line. */
type DragState = { draggedId: Uuid; targetId: Uuid | null; zone: DropZone | null };

const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 120;

/* §6.3: re-parenting by drag is mouse-only in v1. A function of the live media
   rather than a constant, because tests pin both answers by stubbing
   `matchMedia` per case. */
function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function FolderTree({
  nodes,
  counts,
  selection,
  collapsed,
  onSelect,
  onToggle,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onError,
  creatingRoot,
  onCreatingRootChange,
}: FolderTreeProps) {
  const rows = useMemo(() => visibleFolderRows(nodes ?? [], collapsed), [nodes, collapsed]);
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<{ id: Uuid; placement: { top: number; left: number } } | null>(
    null,
  );

  /* Measured here, in the handler that opens the menu — the `NoteCard` contract.
     The tree scrolls inside an `overflow` container, so a menu opening downward
     past the container's edge is clipped; flip upward when there is no room
     below, against the viewport rather than the row. */
  const openMenu = (id: Uuid, anchor: HTMLElement): void => {
    /* Opening a menu ends any drag UI: a drag in progress owns the pointer, and a
       menu opening over it means the gesture became something else — on touch, a
       hold that started a drag before the menu's re-render withdrew `draggable`.
       Without this the row stays dimmed and untappable with no `dragend` ever
       coming to clear it. */
    setDrag(null);
    const rect = anchor.getBoundingClientRect();
    const up =
      rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight &&
      rect.top > MENU_ESTIMATED_HEIGHT;
    setMenu({
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
  const closeMenu = (): void => {
    setMenu(null);
  };
  /* Which row is being dragged, which row is under the pointer, and which of the
     three bands of it. Held here rather than read from the event on drop, because
     `dragover` fires many times and the drop event carries only the dragged id. */
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /* The root create input's text, held here even though its open state lives in
     `Sidebar`, because the input itself is rendered here and a value that lived
     with its flag would have to be lifted for no other reason. */
  const [rootName, setRootName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{
    id: Uuid;
    name: string;
    descendants: number;
  } | null>(null);

  /* The focused row is the tree's single tab stop, and it is *derived* rather
     than stored: a requested row that has been deleted, or hidden by collapsing
     an ancestor, is not in the list and cannot hold the tab stop. Falling back to
     the selected row and then to the first keeps focus inside the tree instead of
     dropping it to the document body, where `ArrowDown` would stop working.

     Deriving it during render rather than correcting it in an effect matters:
     an effect that repairs state after a render where the wrong row held
     `tabIndex={0}` would show the tab stop on two rows for one frame. */
  const selectedId = selection.kind === 'folder' ? selection.id : null;
  const [requestedId, setRequestedId] = useState<Uuid | null>(selectedId);

  const focusedId = useMemo(() => {
    if (rows.length === 0) return null;
    if (requestedId !== null && rows.some((row) => row.node.id === requestedId)) return requestedId;
    if (selectedId !== null && rows.some((row) => row.node.id === selectedId)) return selectedId;
    return rows[0]?.node.id ?? null;
  }, [requestedId, rows, selectedId]);

  const rowRefs = useRef(new Map<Uuid, HTMLDivElement>());

  /* Move the tab stop *and* the DOM focus. Both, because the two can diverge: a
     key press decides the next row and must focus it, while a focus that arrives
     from a click or from assistive technology has already happened and only needs
     the tab stop to follow it. */
  const focusRow = (id: Uuid): void => {
    setRequestedId(id);
    rowRefs.current.get(id)?.focus();
  };

  /* §6.3: empty input cancels, so both the create and the rename editor close on
     a blank name without a round trip. The backend would refuse it with
     `VALIDATION` either; checking here is what makes `Esc` and "cleared the field
     and pressed Enter" behave identically, which is what §6.3 promises. */
  const closeEditing = (): void => {
    setEditing(null);
    setEditError(null);
    onCreatingRootChange(false);
  };

  /* One commit path for all three editors. Each has its own name and its own
     target, but they share the empty-cancels rule and the restore-on-rejection
     behaviour, and three copies of that logic is three chances to have one of them
     quietly diverge — which is how an `Esc` starts working in one place and not
     another. */
  const commit = (target: CommitTarget): void => {
    const name = target.name.trim();
    if (name.length === 0) {
      closeEditing();
      return;
    }

    const write =
      target.kind === 'rename'
        ? onRename(target.id, name)
        : onCreate(name, target.kind === 'createRoot' ? null : target.parentId);

    /* Cleared before the call so a rejected write can put it back. A rejected
       rename restores the row editor; a rejected root create restores the
       sidebar-owned one. */
    setEditing(null);
    onCreatingRootChange(false);
    setEditError(null);

    void write.catch((error: unknown) => {
      const message = messageOf(error);
      /* Put the editor back exactly where the user left it, so a rejected write
         costs them nothing but the reason it failed. The root input's text lives
         apart from the row editors', so it is the one case that restores a value
         rather than a slot — which is why it has its own discriminant instead of
         being a `create` with a null parent. */
      if (target.kind === 'createRoot') {
        setRootName(target.name);
        onCreatingRootChange(true);
      } else {
        setEditing(target);
      }
      setEditError(message);
    });
  };

  const commitEditing = (): void => {
    if (editing !== null) commit(editing);
  };

  /* §6.3: "Deleting a folder with children requires confirmation naming the
     count." A childless folder is one click and no dialog — the confirmation
     exists to warn about a subtree, and warning about nothing is the dialog
     habit principle 1 warns against. */
  const requestDelete = (id: Uuid): void => {
    const node = rows.find((row) => row.node.id === id)?.node;
    if (node === undefined) return;
    const descendants = descendantCount(nodes ?? [], id);
    if (descendants === 0) {
      void onDelete(id).catch((error: unknown) => {
        onError?.(messageOf(error));
      });
      return;
    }
    setPendingDelete({ id, name: node.name, descendants });
  };

  /* §6.3 drag. Three handlers rather than one, because the browser's drag model
     gives each event different information: `dragstart` names the folder,
     `dragover` fires continuously with a pointer position and must preventDefault
     on every one of them for the drop to be allowed at all, and `drop` carries only
     the dragged id. Holding the intermediate state here is what lets `drop` know
     which row and which band it is over.

     A refused drop — onto itself, into its own descendant, or a no-op reorder —
     resolves to `null` in `folderRows.ts` and simply does nothing. Refusing before
     the write is the point: the user learns why while the pointer is still down,
     rather than after a round trip answers `CYCLE_DETECTED`. */
  const onDragStart = (id: Uuid): void => {
    setDrag({ draggedId: id, targetId: id, zone: null });
  };

  const onDragOver = (id: Uuid, offsetY: number, rowHeight: number): void => {
    setDrag((current) => {
      if (current === null) return current;
      const zone = dropZoneAt(offsetY, rowHeight);
      if (current.targetId === id && current.zone === zone) return current;
      /* A target that cannot accept the folder shows the "no" cursor, which is the
         only feedback available before the drop. */
      const accepted = resolveDrop(rows, current.draggedId, id, zone) !== null;
      return { ...current, targetId: id, zone: accepted ? zone : null };
    });
  };

  const onDrop = (): void => {
    const current = drag;
    setDrag(null);
    if (current === null || current.targetId === null || current.zone === null) return;

    const move = resolveDrop(rows, current.draggedId, current.targetId, current.zone);
    if (move === null) return;

    void onMove(current.draggedId, move.newParentId, move.position).catch((error: unknown) => {
      onError?.(messageOf(error));
    });
  };

  const onDragEnd = (): void => {
    setDrag(null);
  };

  /* A drag in progress owns the pointer, so a row under it must not also select.
     §5 says selecting a folder is exclusive with everything else, and a re-parent
     that also changed the selection would be a second, unrequested change. */
  const clickRow = (id: Uuid): void => {
    if (drag !== null) return;
    focusRow(id);
    onSelect({ kind: 'folder', id });
  };

  const runMenuAction = (action: FolderMenuAction, id: Uuid): void => {
    setMenu(null);
    switch (action) {
      case 'rename': {
        const node = rows.find((row) => row.node.id === id)?.node;
        if (node === undefined) return;
        setEditing({ kind: 'rename', id, name: node.name });
        setEditError(null);
        break;
      }
      case 'create':
        setEditing({ kind: 'create', parentId: id, name: '' });
        setEditError(null);
        break;
      case 'delete':
        requestDelete(id);
        break;
    }
  };

  const tree = (
    <div role="tree" aria-label="Folders" className="max-h-[40vh] overflow-y-auto px-2 pb-[10px]">
      {nodes === undefined || nodes.length === 0 ? (
        <p className="px-[6px] py-1 text-[13px] text-[var(--text-subtle)]">No folders yet</p>
      ) : (
        <FolderRows
          nodes={nodes}
          depth={0}
          rows={rows}
          counts={counts}
          selection={selection}
          collapsed={collapsed}
          focusedId={focusedId}
          rowRefs={rowRefs}
          editing={editing}
          editError={editError}
          menu={menu}
          drag={drag}
          creatingRoot={creatingRoot}
          onSelect={onSelect}
          onClickRow={clickRow}
          onToggle={onToggle}
          onFocusRow={focusRow}
          onEdit={setEditing}
          onClearError={() => {
            setEditError(null);
          }}
          onCommitEditing={commitEditing}
          onEditEditing={closeEditing}
          onOpenMenu={openMenu}
          onCloseMenu={closeMenu}
          onMenuAction={runMenuAction}
          onShortcut={runMenuAction}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
      )}

      {/* The root-level create input sits after the tree rather than inside it: a
          new root folder is a sibling of everything, and `+` in the section header
          means "a folder at the top level" (`05-ui-ux.md` §6.3). */}
      {creatingRoot ? (
        <InlineNameInput
          label="New folder name"
          placeholder="Folder name"
          value={rootName}
          error={editError}
          onChange={(name) => {
            setRootName(name);
            setEditError(null);
          }}
          onCommit={() => {
            commit({ kind: 'createRoot', name: rootName });
          }}
          onCancel={() => {
            setRootName('');
            closeEditing();
          }}
        />
      ) : null}
    </div>
  );

  if (pendingDelete !== null) {
    const target = pendingDelete;
    return (
      <>
        {tree}
        <ConfirmDialog
          title={`Delete “${target.name}”?`}
          body={
            target.descendants === 1
              ? `It contains 1 folder, which will be deleted with it. Notes inside are kept and become unfiled.`
              : `It contains ${target.descendants} folders, which will be deleted with it. Notes inside are kept and become unfiled.`
          }
          confirmLabel="Delete folder"
          onCancel={() => {
            setPendingDelete(null);
          }}
          onConfirm={() => {
            setPendingDelete(null);
            void onDelete(target.id).catch((error: unknown) => {
              onError?.(messageOf(error));
            });
          }}
        />
      </>
    );
  }

  return tree;
}

function FolderRows({
  nodes,
  depth,
  rows,
  counts,
  selection,
  collapsed,
  focusedId,
  rowRefs,
  editing,
  editError,
  menu,
  drag,
  creatingRoot,
  onSelect,
  onClickRow,
  onToggle,
  onFocusRow,
  onEdit,
  onClearError,
  onCommitEditing,
  onEditEditing,
  onOpenMenu,
  onCloseMenu,
  onMenuAction,
  onShortcut,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  nodes: FolderNode[];
  depth: number;
  rows: ReturnType<typeof visibleFolderRows>;
  counts: Map<string, number>;
  selection: Selection;
  collapsed: Uuid[];
  focusedId: Uuid | null;
  rowRefs: React.RefObject<Map<Uuid, HTMLDivElement>>;
  editing: Editing;
  editError: string | null;
  menu: { id: Uuid; placement: { top: number; left: number } } | null;
  drag: DragState | null;
  /** The root create input is open, which suspends dragging for the whole tree. */
  creatingRoot: boolean;
  onSelect: (next: Selection) => void;
  /** Click, which is a selection *and* a focus move — and which a drag in progress
      must suppress, so it is separate from `onSelect` used by `Enter`. */
  onClickRow: (id: Uuid) => void;
  onToggle: (id: Uuid) => void;
  onFocusRow: (id: Uuid) => void;
  onEdit: (editing: Editing) => void;
  onClearError: () => void;
  onCommitEditing: () => void;
  onEditEditing: () => void;
  onOpenMenu: (id: Uuid, anchor: HTMLElement) => void;
  onCloseMenu: () => void;
  onMenuAction: (action: FolderMenuAction, id: Uuid) => void;
  onShortcut: (action: FolderMenuAction, id: Uuid) => void;
  onDragStart: (id: Uuid) => void;
  onDragOver: (id: Uuid, offsetY: number, rowHeight: number) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const row = rows.find((candidate) => candidate.node.id === node.id);
        const isCollapsed = collapsed.includes(node.id);
        const hasChildren = node.children.length > 0;
        const active = selection.kind === 'folder' && selection.id === node.id;
        const count = counts.get(node.id) ?? 0;
        const renaming = editing?.kind === 'rename' && editing.id === node.id;
        const creatingInside = editing?.kind === 'create' && editing.parentId === node.id;
        const isDragged = drag?.draggedId === node.id;
        const isTarget = drag !== null && drag.targetId === node.id;
        const dropHere = isTarget ? drag.zone : null;

        /* A row being renamed is not a row any more: it is an input. Rendering
           both would leave the old name in the tree and a second control in the
           tab order. */
        if (renaming) {
          return (
            <div key={node.id} role="none" style={{ paddingLeft: depth * 16 }}>
              <InlineNameInput
                label={`Rename ${node.name}`}
                placeholder="Folder name"
                value={editing.name}
                error={editError}
                onChange={(name) => {
                  onEdit({ kind: 'rename', id: node.id, name });
                  onClearError();
                }}
                onCommit={onCommitEditing}
                onCancel={onEditEditing}
              />
            </div>
          );
        }

        return (
          <div key={node.id} role="none">
            <div
              ref={(element) => {
                if (element === null) {
                  rowRefs.current.delete(node.id);
                } else {
                  rowRefs.current.set(node.id, element);
                }
              }}
              role="treeitem"
              aria-selected={active}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              aria-level={depth + 1}
              aria-setsize={row?.setSize ?? 1}
              aria-posinset={row?.posInSet ?? 1}
              /* Roving tabindex: the tree is one stop in the tab order and arrows
                 move within it. */
              tabIndex={node.id === focusedId ? 0 : -1}
              data-testid="folder-row"
              data-folder-id={node.id}
              data-dragging={isDragged ? 'true' : undefined}
              /* No `aria-dropeffect`: it is deprecated in ARIA 1.1 and, more to the
                 point, drag-and-drop has neither a keyboard equivalent in the DOM
                 at all nor a touch path — re-parenting is mouse-only in v1, and
                 rows are not draggable on a coarse pointer at all. (A hold on a
                 draggable row can start a touch drag on this WebView after all,
                 with no `dragend` to end it — which is exactly why the gate is
                 here rather than trusting the gesture to never start.) The
                 keyboard route to a specific position is a documented gap
                 (`05-ui-ux.md` §6.3) rather than a fake ARIA attribute, and touch
                 re-parenting waits on the same v1.1 "move to…" item. */
              /* The row hangs under its section header: the twisty sits where the
                 header's chevron sits and the glyph where the header's glyph
                 sits, at any root size. The header's side is rem-based (`px-3`
                 plus a `w-5` chevron), so a pixel indent cannot meet it once the
                 font scales — the base indent is rem with only the per-level
                 nesting kept in pixels, which is the offset §6.3 promises to
                 keep. */
              style={{ paddingLeft: `calc(0.25rem + ${depth * 16}px)` }}
              /* `draggable` only while nothing else is going on. A row being renamed
                 is an input, and dragging a menu open over the tree would otherwise
                 start a drag from whatever is underneath it. Never on a coarse
                 pointer: drag is mouse-only in v1, and on touch a hold on a
                 draggable row can start a drag that no `dragend` ever ends — the
                 row is left dimmed and untappable, found on a phone. */
              draggable={
                editing === null &&
                menu === null &&
                drag === null &&
                !creatingRoot &&
                !isCoarsePointer()
              }
              onDragStart={() => {
                onDragStart(node.id);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                /* preventDefault on every `dragover` is what marks the row as a
                   valid drop target; without it the browser refuses the drop and
                   `drop` never fires at all. */
                event.preventDefault();
                event.stopPropagation();
                onDragOver(node.id, event.clientY - rowRect(event).top, rowRect(event).height);
              }}
              /* `dragleave` fires when the pointer crosses a child too, so the
                 count below is what makes leaving the row distinguishable from
                 moving within it. */
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDrop();
              }}
              onFocus={() => {
                setFocusedQuietly(focusedId, node.id, onFocusRow);
              }}
              onClick={() => {
                onClickRow(node.id);
              }}
              /* §2.2 and §9: right-click on desktop, long-press on touch, and the
                 row's own button, all reach the same menu. */
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenMenu(node.id, event.currentTarget);
              }}
              onKeyDown={(event) => {
                /* §7: F2 renames, Delete removes. Both go through the same handler
                   the menu items do, so the keyboard and the mouse cannot drift
                   apart — a second implementation of "delete a folder" is how the
                   confirmation ends up counting descendants in one path only. */
                if (event.key === 'F2') {
                  event.preventDefault();
                  onShortcut('rename', node.id);
                  return;
                }
                if (event.key === 'Delete') {
                  event.preventDefault();
                  onShortcut('delete', node.id);
                  return;
                }
                /* ContextMenu is the "application key" on a Windows keyboard and
                   the standard way to ask for the menu of the focused item. */
                if (event.key === 'ContextMenu') {
                  event.preventDefault();
                  onOpenMenu(node.id, event.currentTarget);
                  return;
                }

                const action = treeKeyAction(rows, node.id, event.key);
                if (action === null) return;
                event.preventDefault();
                switch (action.kind) {
                  case 'move':
                    onFocusRow(action.id);
                    break;
                  case 'expand':
                  case 'collapse':
                    onToggle(action.id);
                    /* The rows are the same after a toggle, so focus survives it
                       without a second lookup. */
                    onFocusRow(action.id);
                    break;
                  case 'select':
                    onSelect({ kind: 'folder', id: action.id });
                    break;
                }
              }}
              className={`group relative flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[var(--r-input)] pr-[6px] text-[13px] transition-colors ${
                isDragged
                  ? 'opacity-40'
                  : active
                    ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                    : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              {/* The drop indicator: a 2 px accent rule pinned to the top or bottom
                  edge, or a soft accent fill for "into". A rule on the wrong edge
                  would read as re-ordering when the intent was re-parenting, which is
                  the whole distinction the three bands exist to make. */}
              {dropHere === 'before' ? (
                <span
                  data-testid="drop-line-before"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-[6px] -top-px h-[2px] rounded-full bg-[var(--accent)]"
                />
              ) : null}
              {dropHere === 'after' ? (
                <span
                  data-testid="drop-line-after"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-[6px] -bottom-px h-[2px] rounded-full bg-[var(--accent)]"
                />
              ) : null}
              {dropHere === 'inside' ? (
                <span
                  data-testid="drop-inside"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[var(--r-input)] bg-[var(--accent-soft)]"
                />
              ) : null}
              {/* The twisty slot is the header chevron's width (`w-5` either way),
                  so the two arrows share a column and the glyphs below share
                  theirs — the column contract in the row's `paddingLeft`. */}
              <span className="flex w-5 flex-none">
                {hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
                    data-testid="folder-twisty"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(node.id);
                    }}
                    /* Collapsing works from touch today — the twisty is a real
                       button — but 16 px is a miss waiting to happen against §9's
                       44 px touch bar. The row is 26 px tall and the name owns the
                       rest of it, so a full-size target would steal taps from its
                       neighbours; the invisible hit slop below roughly doubles the
                       target on coarse pointers without moving any pixel. A 44 px
                       target genuinely does not fit here — recorded in the M8
                       tracker rather than faked with an overlap that misattributes
                       taps to the rows above and below. */
                    className="relative flex text-[var(--text-subtle)] hover:text-[var(--text)] pointer-coarse:before:absolute pointer-coarse:before:-inset-x-3 pointer-coarse:before:-inset-y-2 pointer-coarse:before:content-['']"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="icon i-16" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="icon i-16" aria-hidden="true" />
                    )}
                  </button>
                ) : null}
              </span>
              <Folder
                data-testid="folder-icon"
                className="icon i-16 flex-none opacity-70"
                aria-hidden="true"
              />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
              {count > 0 ? (
                <span className="ml-auto pl-1 text-[11px] text-[var(--text-subtle)]">{count}</span>
              ) : null}
              {menu !== null && menu.id === node.id ? (
                <FolderRowMenu
                  folderId={node.id}
                  folderName={node.name}
                  placement={menu.placement}
                  onAction={onMenuAction}
                  onClose={() => {
                    onCloseMenu();
                  }}
                />
              ) : (
                /* `pointer-fine:group-hover:flex`, in that order: `hidden` first so
                   the button is absent by default, then the two variants that turn
                   it on. §9 says hover styling exists at `pointer: fine` and
                   nowhere else — and the reverse order would make it permanently
                   visible on a desktop, which is three controls on every row rather
                   than one on the row under the cursor. On touch the menu opens by
                   long-press instead. */
                <span className="ml-auto hidden flex-none pointer-fine:group-hover:flex">
                  <FolderMenuButton
                    folderName={node.name}
                    onOpen={(button) => {
                      onOpenMenu(node.id, button);
                    }}
                  />
                </span>
              )}
            </div>
            {creatingInside && !isCollapsed ? (
              <div role="none" style={{ paddingLeft: 6 + (depth + 1) * 16 }}>
                <InlineNameInput
                  label={`New folder inside ${node.name}`}
                  placeholder="Folder name"
                  value={editing.name}
                  error={editError}
                  onChange={(name) => {
                    onEdit({ kind: 'create', parentId: node.id, name });
                    onClearError();
                  }}
                  onCommit={onCommitEditing}
                  onCancel={onEditEditing}
                />
              </div>
            ) : null}
            {hasChildren && !isCollapsed ? (
              <FolderRows
                nodes={node.children}
                depth={depth + 1}
                rows={rows}
                counts={counts}
                selection={selection}
                collapsed={collapsed}
                focusedId={focusedId}
                rowRefs={rowRefs}
                editing={editing}
                editError={editError}
                menu={menu}
                drag={drag}
                creatingRoot={creatingRoot}
                onSelect={onSelect}
                onClickRow={onClickRow}
                onToggle={onToggle}
                onFocusRow={onFocusRow}
                onEdit={onEdit}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
                onClearError={onClearError}
                onCommitEditing={onCommitEditing}
                onEditEditing={onEditEditing}
                onOpenMenu={onOpenMenu}
                onCloseMenu={onCloseMenu}
                onMenuAction={onMenuAction}
                onShortcut={onShortcut}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/* Focus arriving on a row that does not hold the tab stop — a mouse click, or a
   screen reader moving the caret — has to move the tab stop with it, and there is
   no key handler to do it. Guarded so the common case, where the focused row
   already is the tab stop, does not re-focus an element that has focus: calling
   `.focus()` inside a focus handler is a re-entrant call for no benefit. */
function setFocusedQuietly(current: Uuid | null, next: Uuid, onFocusRow: (id: Uuid) => void): void {
  if (current !== next) onFocusRow(next);
}

/** The row's own box, read once per `dragover`.
    `getBoundingClientRect` on a row during a drag is the one layout read the handler
    cannot avoid — the zone is a fraction of the row's height — and it is cheap
    because it is one element, not a reflow of the tree. */
function rowRect(event: React.DragEvent<HTMLDivElement>): DOMRect {
  return event.currentTarget.getBoundingClientRect();
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