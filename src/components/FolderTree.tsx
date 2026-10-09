import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { descendantCount, treeKeyAction, visibleFolderRows } from './folderRows';
import { ConfirmDialog } from './ConfirmDialog';
import { FolderMenuButton, FolderRowMenu } from './FolderRowMenu';
import { InlineNameInput } from './InlineNameInput';
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
  onError,
  creatingRoot,
  onCreatingRootChange,
}: FolderTreeProps) {
  const rows = useMemo(() => visibleFolderRows(nodes ?? [], collapsed), [nodes, collapsed]);
  const [editing, setEditing] = useState<Editing>(null);
  const [menuFor, setMenuFor] = useState<Uuid | null>(null);
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

  const runMenuAction = (action: FolderMenuAction, id: Uuid): void => {
    setMenuFor(null);
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
          menuFor={menuFor}
          onSelect={onSelect}
          onToggle={onToggle}
          onFocusRow={focusRow}
          onEdit={setEditing}
          onClearError={() => {
            setEditError(null);
          }}
          onCommitEditing={commitEditing}
          onEditEditing={closeEditing}
          onMenu={setMenuFor}
          onMenuAction={runMenuAction}
          onShortcut={runMenuAction}
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
  menuFor,
  onSelect,
  onToggle,
  onFocusRow,
  onEdit,
  onClearError,
  onCommitEditing,
  onEditEditing,
  onMenu,
  onMenuAction,
  onShortcut,
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
  menuFor: Uuid | null;
  onSelect: (next: Selection) => void;
  onToggle: (id: Uuid) => void;
  onFocusRow: (id: Uuid) => void;
  onEdit: (editing: Editing) => void;
  onClearError: () => void;
  onCommitEditing: () => void;
  onEditEditing: () => void;
  onMenu: (id: Uuid | null) => void;
  onMenuAction: (action: FolderMenuAction, id: Uuid) => void;
  onShortcut: (action: FolderMenuAction, id: Uuid) => void;
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
              style={{ paddingLeft: 6 + depth * 16 }}
              onFocus={() => {
                setFocusedQuietly(focusedId, node.id, onFocusRow);
              }}
              onClick={() => {
                onFocusRow(node.id);
                onSelect({ kind: 'folder', id: node.id });
              }}
              /* §2.2 and §9: right-click on desktop, long-press on touch, and the
                 row's own button, all reach the same menu. */
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu(node.id);
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
                  onMenu(node.id);
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
              className={`group flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[var(--r-input)] px-[6px] text-[13px] transition-colors ${
                active
                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                  : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <span className="flex w-[14px] flex-none">
                {hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(node.id);
                    }}
                    className="flex text-[var(--text-subtle)] hover:text-[var(--text)]"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="icon i-16" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="icon i-16" aria-hidden="true" />
                    )}
                  </button>
                ) : null}
              </span>
              <Folder className="icon i-16 flex-none opacity-70" aria-hidden="true" />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
              {count > 0 ? (
                <span className="ml-auto pl-1 text-[11px] text-[var(--text-subtle)]">{count}</span>
              ) : null}
              {menuFor === node.id ? (
                <FolderRowMenu
                  folderId={node.id}
                  folderName={node.name}
                  onAction={onMenuAction}
                  onClose={() => {
                    onMenu(null);
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
                    onOpen={() => {
                      onMenu(node.id);
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
                menuFor={menuFor}
                onSelect={onSelect}
                onToggle={onToggle}
                onFocusRow={onFocusRow}
                onEdit={onEdit}
                onClearError={onClearError}
                onCommitEditing={onCommitEditing}
                onEditEditing={onEditEditing}
                onMenu={onMenu}
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