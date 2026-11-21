import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  descendantCount,
  dropZoneAt,
  resolveDrop,
  treeKeyAction,
  visibleFolderRows,
} from './folderRows';
import { ConfirmDialog } from './ConfirmDialog';
import { FolderMenuButton, FolderRowMenu } from './FolderRowMenu';
import { InlineNameInput } from './InlineNameInput';
import type { DropZone } from './folderRows';
import type { FolderMenuAction } from './FolderRowMenu';
import type { Selection } from '../types/ipc';
import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

type FolderTreeProps = {
  nodes: FolderNode[] | undefined;
  counts: Map<string, number>;
  selection: Selection;
  collapsed: Uuid[];
  onSelect: (next: Selection) => void;
  onToggle: (id: Uuid) => void;
  onCreate: (name: string, parentId: Uuid | null) => Promise<void>;
  onRename: (id: Uuid, name: string) => Promise<void>;
  onDelete: (id: Uuid) => Promise<void>;
  onMove: (id: Uuid, newParentId: Uuid | null, position: number) => Promise<void>;
  onError?: (message: string) => void;
  creatingRoot: boolean;
  onCreatingRootChange: (open: boolean) => void;
};

type Editing =
  | { kind: 'rename'; id: Uuid; name: string }
  | { kind: 'create'; parentId: Uuid; name: string }
  | null;

type CommitTarget =
  | { kind: 'rename'; id: Uuid; name: string }
  | { kind: 'create'; parentId: Uuid; name: string }
  | { kind: 'createRoot'; name: string };

type DragState = { draggedId: Uuid; targetId: Uuid | null; zone: DropZone | null };

const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 120;

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

  const openMenu = (id: Uuid, anchor: HTMLElement): void => {
    setDrag(null);
    const rect = anchor.getBoundingClientRect();
    const up =
      rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight && rect.top > MENU_ESTIMATED_HEIGHT;
    setMenu({
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
  const closeMenu = (): void => {
    suppressOpenRef.current = false;
    setMenu(null);
  };
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [rootName, setRootName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{
    id: Uuid;
    name: string;
    descendants: number;
  } | null>(null);

  const selectedId = selection.kind === 'folder' ? selection.id : null;
  const [requestedId, setRequestedId] = useState<Uuid | null>(selectedId);

  const focusedId = useMemo(() => {
    if (rows.length === 0) return null;
    if (requestedId !== null && rows.some((row) => row.node.id === requestedId)) return requestedId;
    if (selectedId !== null && rows.some((row) => row.node.id === selectedId)) return selectedId;
    return rows[0]?.node.id ?? null;
  }, [requestedId, rows, selectedId]);

  const rowRefs = useRef(new Map<Uuid, HTMLDivElement>());

  const focusRow = (id: Uuid): void => {
    setRequestedId(id);
    rowRefs.current.get(id)?.focus();
  };

  const closeEditing = (): void => {
    setEditing(null);
    setEditError(null);
    onCreatingRootChange(false);
  };

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

    setEditing(null);
    onCreatingRootChange(false);
    setEditError(null);

    void write.catch((error: unknown) => {
      const message = messageOf(error);
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

  const onDragStart = (id: Uuid): void => {
    setDrag({ draggedId: id, targetId: id, zone: null });
  };

  const onDragOver = (id: Uuid, offsetY: number, rowHeight: number): void => {
    setDrag((current) => {
      if (current === null) return current;
      const zone = dropZoneAt(offsetY, rowHeight);
      if (current.targetId === id && current.zone === zone) return current;
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

  const suppressOpenRef = useRef(false);

  const clickRow = (id: Uuid): void => {
    if (drag !== null) return;
    if (suppressOpenRef.current) {
      suppressOpenRef.current = false;
      return;
    }
    focusRow(id);
    onSelect({ kind: 'folder', id });
  };

  const contextMenuRow = (id: Uuid, anchor: HTMLElement): void => {
    if (menu === null) suppressOpenRef.current = true;
    openMenu(id, anchor);
  };

  const runMenuAction = (action: FolderMenuAction, id: Uuid): void => {
    closeMenu();
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
          onContextMenuRow={contextMenuRow}
          onCloseMenu={closeMenu}
          onMenuAction={runMenuAction}
          onShortcut={runMenuAction}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
      )}

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
  onContextMenuRow,
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
  creatingRoot: boolean;
  onSelect: (next: Selection) => void;
  onClickRow: (id: Uuid) => void;
  onToggle: (id: Uuid) => void;
  onFocusRow: (id: Uuid) => void;
  onEdit: (editing: Editing) => void;
  onClearError: () => void;
  onCommitEditing: () => void;
  onEditEditing: () => void;
  onOpenMenu: (id: Uuid, anchor: HTMLElement) => void;
  onContextMenuRow: (id: Uuid, anchor: HTMLElement) => void;
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
              tabIndex={node.id === focusedId ? 0 : -1}
              data-testid="folder-row"
              data-folder-id={node.id}
              data-dragging={isDragged ? 'true' : undefined}
              style={{ paddingLeft: `calc(0.25rem + ${depth * 16}px)` }}
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
                event.preventDefault();
                event.stopPropagation();
                onDragOver(node.id, event.clientY - rowRect(event).top, rowRect(event).height);
              }}
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
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenuRow(node.id, event.currentTarget);
              }}
              onKeyDown={(event) => {
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
                    onFocusRow(action.id);
                    break;
                  case 'select':
                    onSelect({ kind: 'folder', id: action.id });
                    break;
                }
              }}
              className={`group relative flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[var(--r-input)] pr-[6px] text-[13px] transition-colors select-none ${
                isDragged
                  ? 'opacity-40'
                  : active
                    ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                    : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
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
              <span className="flex w-5 flex-none justify-center">
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
                    className="relative grid h-5 w-5 flex-none place-items-center text-[var(--text-subtle)] hover:text-[var(--text)] pointer-coarse:before:absolute pointer-coarse:before:-inset-x-3 pointer-coarse:before:-inset-y-2 pointer-coarse:before:content-['']"
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
                onContextMenuRow={onContextMenuRow}
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

function setFocusedQuietly(current: Uuid | null, next: Uuid, onFocusRow: (id: Uuid) => void): void {
  if (current !== next) onFocusRow(next);
}

function rowRect(event: React.DragEvent<HTMLDivElement>): DOMRect {
  return event.currentTarget.getBoundingClientRect();
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'That could not be saved.';
}
