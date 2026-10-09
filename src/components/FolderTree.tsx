import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { treeKeyAction, visibleFolderRows } from './folderRows';
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
};

export function FolderTree({
  nodes,
  counts,
  selection,
  collapsed,
  onSelect,
  onToggle,
}: FolderTreeProps) {
  const rows = useMemo(() => visibleFolderRows(nodes ?? [], collapsed), [nodes, collapsed]);

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

  if (nodes === undefined || nodes.length === 0) {
    return (
      <div role="tree" aria-label="Folders" className="max-h-[40vh] overflow-y-auto px-2 pb-[10px]">
        <p className="px-[6px] py-1 text-[13px] text-[var(--text-subtle)]">No folders yet</p>
      </div>
    );
  }

  return (
    <div role="tree" aria-label="Folders" className="max-h-[40vh] overflow-y-auto px-2 pb-[10px]">
      <FolderRows
        nodes={nodes}
        depth={0}
        rows={rows}
        counts={counts}
        selection={selection}
        collapsed={collapsed}
        focusedId={focusedId}
        rowRefs={rowRefs}
        onSelect={onSelect}
        onToggle={onToggle}
        onFocusRow={focusRow}
      />
    </div>
  );
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
  onSelect,
  onToggle,
  onFocusRow,
}: {
  nodes: FolderNode[];
  depth: number;
  rows: ReturnType<typeof visibleFolderRows>;
  counts: Map<string, number>;
  selection: Selection;
  collapsed: Uuid[];
  focusedId: Uuid | null;
  rowRefs: React.RefObject<Map<Uuid, HTMLDivElement>>;
  onSelect: (next: Selection) => void;
  onToggle: (id: Uuid) => void;
  onFocusRow: (id: Uuid) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const row = rows.find((candidate) => candidate.node.id === node.id);
        const isCollapsed = collapsed.includes(node.id);
        const hasChildren = node.children.length > 0;
        const active = selection.kind === 'folder' && selection.id === node.id;
        const count = counts.get(node.id) ?? 0;

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
              onKeyDown={(event) => {
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
              className={`flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[var(--r-input)] px-[6px] text-[13px] transition-colors ${
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
            </div>
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
                onSelect={onSelect}
                onToggle={onToggle}
                onFocusRow={onFocusRow}
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