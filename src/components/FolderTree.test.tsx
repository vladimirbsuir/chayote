import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FolderTree } from './FolderTree';
import type { FolderNode } from '../types/folder';

/* The tree is one tab stop with a roving tabindex (`05-ui-ux.md` §10). These
   tests are about the DOM contract the pattern requires — one `tabIndex={0}`,
   `aria-level`, `aria-expanded`, and the keys acting on the right row — because
   the traversal itself is covered in `folderRows.test.ts` as pure data. */

const PROJECTS: FolderNode = {
  id: 'a1',
  name: 'Projects',
  parentId: 'a',
  position: 0,
  children: [],
};
const MEETINGS: FolderNode = {
  id: 'a2',
  name: 'Meetings',
  parentId: 'a',
  position: 1,
  children: [],
};
const WORK: FolderNode = {
  id: 'a',
  name: 'Work',
  parentId: null,
  position: 0,
  children: [PROJECTS, MEETINGS],
};
const PERSONAL: FolderNode = {
  id: 'b',
  name: 'Personal',
  parentId: null,
  position: 1,
  children: [],
};
const TREE: FolderNode[] = [WORK, PERSONAL];

/* Rows are addressed by their data attribute rather than by text, because a name
   is not unique in general and the id is what every assertion is about. */
function row(id: string): HTMLElement {
  const found = document.querySelector(`[data-testid="folder-row"][data-folder-id="${id}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no row for folder ${id}`);
  return found;
}

function rowOrNull(id: string): HTMLElement | null {
  const found = document.querySelector(`[data-testid="folder-row"][data-folder-id="${id}"]`);
  return found instanceof HTMLElement ? found : null;
}

function allRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="folder-row"]'));
}

const noWrite = (): Promise<void> => Promise.resolve();
const noMove = (): Promise<void> => Promise.resolve();

function renderTree(overrides: Partial<React.ComponentProps<typeof FolderTree>> = {}): void {
  const props: React.ComponentProps<typeof FolderTree> = {
    nodes: TREE,
    counts: new Map([['a', 3]]),
    selection: { kind: 'all' },
    collapsed: [],
    onSelect: () => {},
    onToggle: () => {},
    onCreate: noWrite,
    onRename: noWrite,
    onDelete: noWrite,
    onMove: noMove,
    creatingRoot: false,
    onCreatingRootChange: () => {},
    ...overrides,
  };
  render(<FolderTree {...props} />);
}

describe('FolderTree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a tree of treeitems with a level per depth', () => {
    renderTree();

    expect(screen.getByRole('tree', { name: 'Folders' })).toBeDefined();
    expect(row('a').getAttribute('aria-level')).toBe('1');
    expect(row('a1').getAttribute('aria-level')).toBe('2');
  });

  it('is a single tab stop, so a nested tree does not fill the tab order', () => {
    renderTree();

    const focusable = allRows().filter((element) => element.getAttribute('tabindex') === '0');

    expect(focusable).toHaveLength(1);
    expect(focusable[0]?.getAttribute('data-folder-id')).toBe('a');
  });

  it('moves the tab stop with ArrowDown so the focused row is always reachable', () => {
    renderTree();

    fireEvent.keyDown(row('a'), { key: 'ArrowDown' });

    expect(row('a1').getAttribute('tabindex')).toBe('0');
    expect(row('a').getAttribute('tabindex')).toBe('-1');
  });

  it('reports expanded state and collapses on ArrowLeft', () => {
    const onToggle = vi.fn();
    renderTree({ onToggle });

    expect(row('a').getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(row('a'), { key: 'ArrowLeft' });

    expect(onToggle).toHaveBeenCalledWith('a');
  });

  it('moves out to the parent on ArrowLeft from a leaf', () => {
    renderTree();

    fireEvent.keyDown(row('a1'), { key: 'ArrowLeft' });

    expect(row('a').getAttribute('tabindex')).toBe('0');
  });

  it('hides a collapsed branch and expands it on ArrowRight', () => {
    const onToggle = vi.fn();
    renderTree({ collapsed: ['a'], onToggle });

    expect(rowOrNull('a1')).toBeNull();
    expect(row('a').getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(row('a'), { key: 'ArrowRight' });
    expect(onToggle).toHaveBeenCalledWith('a');
  });

  it('selects a folder on Enter and on Space', () => {
    const onSelect = vi.fn();
    renderTree({ onSelect });

    fireEvent.keyDown(row('a1'), { key: 'Enter' });
    fireEvent.keyDown(row('a2'), { key: ' ' });

    expect(onSelect).toHaveBeenNthCalledWith(1, { kind: 'folder', id: 'a1' });
    expect(onSelect).toHaveBeenNthCalledWith(2, { kind: 'folder', id: 'a2' });
  });

  it('marks the selected row and marks no other', () => {
    renderTree({ selection: { kind: 'folder', id: 'a1' } });

    expect(row('a1').getAttribute('aria-selected')).toBe('true');
    expect(row('a').getAttribute('aria-selected')).toBe('false');
  });

  it('puts the tab stop on the selected folder so a relaunch lands where the user left off', () => {
    renderTree({ selection: { kind: 'folder', id: 'a2' } });

    expect(row('a2').getAttribute('tabindex')).toBe('0');
  });

  it('keeps the tree focusable when the selected folder has been deleted', () => {
    renderTree({ selection: { kind: 'folder', id: 'gone' } });

    expect(row('a').getAttribute('tabindex')).toBe('0');
  });

  it('moves the tab stop off the row when it is deleted', () => {
    const props = {
      nodes: TREE,
      counts: new Map<string, number>(),
      selection: { kind: 'all' } as const,
      collapsed: [] as string[],
      onSelect: () => {},
      onToggle: () => {},
      onCreate: noWrite,
      onRename: noWrite,
      onDelete: noWrite,
      onMove: noMove,
      creatingRoot: false,
      onCreatingRootChange: () => {},
    };
    const { rerender } = render(<FolderTree {...props} />);

    /* Focus arriving from outside the tree — a click, or a screen reader moving
       the caret — has to move the tab stop too, and there is no handler of ours
       ahead of it. `act` because the roving tabindex is derived from state the
       focus event updates. */
    act(() => {
      row('a1').focus();
    });
    expect(row('a1').getAttribute('tabindex')).toBe('0');

    rerender(<FolderTree {...props} collapsed={['a']} />);

    /* `a1` is no longer rendered, so it cannot hold the tab stop; `a` is the only
       visible candidate. */
    expect(row('a').getAttribute('tabindex')).toBe('0');
  });

  it('selects a folder on click', () => {
    const onSelect = vi.fn();
    renderTree({ onSelect });

    fireEvent.click(row('b'));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'folder', id: 'b' });
  });

  it('swallows the release click after a hold that opened the menu', () => {
    /* The release after a long-press synthesises a click on engines that do,
       which would select the row under its own just-opened menu — measured on
       the phone. The flag eats exactly that one; the next real click selects. */
    const onSelect = vi.fn();
    renderTree({ onSelect });

    fireEvent.contextMenu(row('a'));
    expect(screen.getByTestId('folder-menu')).toBeDefined();
    fireEvent.click(row('a'));

    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(row('a'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'folder', id: 'a' });
  });

  it('leaves an unbound key alone so the event is not swallowed', () => {
    const onSelect = vi.fn();
    renderTree({ onSelect });

    fireEvent.keyDown(row('a'), { key: 'a' });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the twisty out of the tab order, since the arrows do its job', () => {
    renderTree();

    const twisty = screen.getByLabelText('Collapse Work');

    expect(twisty.getAttribute('tabindex')).toBe('-1');
  });

  it('says there are no folders rather than rendering an empty tree', () => {
    renderTree({ nodes: [] });

    expect(screen.getByText('No folders yet')).toBeDefined();
  });

  it('renders rows unselectable so a hold reaches the menu, not a text selection', () => {
    /* `05-ui-ux.md` §6.3: on the device the name selected instead and no menu
       opened. Copying happens in the editor, not in the tree. */
    renderTree();

    expect(allRows().length).toBeGreaterThan(0);
    for (const element of allRows()) {
      expect(element.className).toContain('select-none');
    }
  });

  it('renders the menu itself unselectable so a hold presses, never selects', () => {
    renderTree();

    fireEvent.contextMenu(row('a'));

    expect(screen.getByTestId('folder-menu').className).toContain('select-none');
  });
});
