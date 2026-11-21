import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { act, useState } from 'react';
import { FolderTree } from './FolderTree';
import type { FolderNode } from '../types/folder';
import type { Selection } from '../types/ipc';

const ROW_HEIGHT = 26;
const PROJECTS: FolderNode = {
  id: 'a1',
  name: 'Projects',
  parentId: 'a',
  position: 0,
  children: [],
};
const WORK: FolderNode = {
  id: 'a',
  name: 'Work',
  parentId: null,
  position: 0,
  children: [PROJECTS],
};
const PERSONAL: FolderNode = {
  id: 'b',
  name: 'Personal',
  parentId: null,
  position: 1,
  children: [],
};
const TREE: FolderNode[] = [WORK, PERSONAL];

const noWrite = (): Promise<void> => Promise.resolve();
const noop = (): void => {};

afterEach(() => {
  stubPointer(false);
});

function stubPointer(coarse: boolean): void {
  window.matchMedia = (query: string) => ({
    matches: coarse && query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

function row(id: string): HTMLElement {
  const found = document.querySelector(`[data-testid="folder-row"][data-folder-id="${id}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no row for folder ${id}`);
  return found;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function DragTree({
  onMove = noWrite,
  onSelect = noop,
  onError,
}: {
  onMove?: (id: string, newParentId: string | null, position: number) => Promise<void>;
  onSelect?: (next: Selection) => void;
  onError?: (message: string) => void;
}): React.ReactElement {
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  return (
    <FolderTree
      nodes={TREE}
      counts={new Map()}
      selection={selection}
      collapsed={[]}
      onSelect={(next) => {
        setSelection(next);
        onSelect(next);
      }}
      onToggle={noop}
      onCreate={noWrite}
      onRename={noWrite}
      onDelete={noWrite}
      onMove={onMove}
      onError={onError}
      creatingRoot={false}
      onCreatingRootChange={noop}
    />
  );
}

function dragOverAt(id: string, offsetY: number): void {
  const target = row(id);
  const top = 100;
  target.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 320,
    bottom: top + ROW_HEIGHT,
    width: 320,
    height: ROW_HEIGHT,
    toJSON: () => ({}),
  });

  fireEvent(
    target,
    new MouseEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: top + offsetY,
      clientX: 10,
    }),
  );
}

function drag(from: string, to: string, offsetY: number): void {
  fireEvent.dragStart(row(from));
  dragOverAt(to, offsetY);
  fireEvent.drop(row(to));
}

describe('folder drag', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the dragged row while it is in the air', () => {
    render(<DragTree />);

    fireEvent.dragStart(row('a'));

    expect(row('a').getAttribute('data-dragging')).toBe('true');
    expect(row('b').getAttribute('data-dragging')).toBeNull();
  });

  it('clears the marker when the drag ends without a drop', () => {
    render(<DragTree />);

    fireEvent.dragStart(row('a'));
    fireEvent.dragEnd(row('a'));

    expect(row('a').getAttribute('data-dragging')).toBeNull();
  });

  it('re-parents by dropping onto the middle of a row', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DragTree onMove={onMove} />);

    drag('b', 'a', ROW_HEIGHT / 2);
    await settle();

    expect(onMove).toHaveBeenCalledWith('b', 'a', 1);
  });

  it('reorders above a row when dropped in its top band', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DragTree onMove={onMove} />);

    drag('b', 'a', 2);
    await settle();

    expect(onMove).toHaveBeenCalledWith('b', null, 0);
  });

  it('reorders below a row when dropped in its bottom band', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DragTree onMove={onMove} />);

    drag('a', 'b', ROW_HEIGHT - 2);
    await settle();

    expect(onMove).toHaveBeenCalledWith('a', null, 1);
  });

  it('shows the drop indicator on the band the pointer is over', () => {
    render(<DragTree />);
    fireEvent.dragStart(row('a1'));

    dragOverAt('b', 2);
    expect(screen.getByTestId('drop-line-before')).toBeDefined();
    expect(screen.queryByTestId('drop-line-after')).toBeNull();

    dragOverAt('b', ROW_HEIGHT / 2);
    expect(screen.getByTestId('drop-inside')).toBeDefined();
    expect(screen.queryByTestId('drop-line-before')).toBeNull();

    dragOverAt('b', ROW_HEIGHT - 2);
    expect(screen.getByTestId('drop-line-after')).toBeDefined();
    expect(screen.queryByTestId('drop-inside')).toBeNull();
  });

  it('draws no indicator when the band would not move anything', () => {
    render(<DragTree />);
    fireEvent.dragStart(row('b'));

    dragOverAt('a', ROW_HEIGHT - 2);

    expect(screen.queryByTestId('drop-line-after')).toBeNull();
  });

  it('draws the indicator on the target row, not the dragged one', () => {
    render(<DragTree />);
    fireEvent.dragStart(row('b'));
    dragOverAt('a', 2);

    const target = row('a');
    expect(target.querySelector('[data-testid="drop-line-before"]')).not.toBeNull();
    expect(row('b').querySelector('[data-testid="drop-line-before"]')).toBeNull();
  });

  it('refuses to drop a folder into its own descendant and writes nothing', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DragTree onMove={onMove} />);

    drag('a', 'a1', ROW_HEIGHT / 2);
    await settle();

    expect(onMove).not.toHaveBeenCalled();
  });

  it('shows no indicator over a folder that cannot accept the drop', () => {
    render(<DragTree />);
    fireEvent.dragStart(row('a'));

    dragOverAt('a1', ROW_HEIGHT / 2);

    expect(screen.queryByTestId('drop-inside')).toBeNull();
    expect(screen.queryByTestId('drop-line-before')).toBeNull();
  });

  it('refuses to drop a folder onto itself', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DragTree onMove={onMove} />);

    drag('a', 'a', ROW_HEIGHT / 2);
    await settle();

    expect(onMove).not.toHaveBeenCalled();
  });

  it('writes nothing when the drop lands where the folder already is', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DragTree onMove={onMove} />);

    drag('b', 'a', ROW_HEIGHT - 2);
    await settle();

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not change the selection while a drag passes over a row', () => {
    const onSelect = vi.fn();
    render(<DragTree onSelect={onSelect} />);

    fireEvent.dragStart(row('b'));
    dragOverAt('a', ROW_HEIGHT / 2);
    fireEvent.click(row('a'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects again once the drag is over', () => {
    const onSelect = vi.fn();
    render(<DragTree onSelect={onSelect} />);

    fireEvent.dragStart(row('b'));
    fireEvent.dragEnd(row('b'));
    fireEvent.click(row('a'));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'folder', id: 'a' });
  });

  it('surfaces a refused move instead of failing silently', async () => {
    const onError = vi.fn();
    render(
      <DragTree
        onMove={() => Promise.reject(new Error('A folder cannot be moved inside itself.'))}
        onError={onError}
      />,
    );

    drag('b', 'a', ROW_HEIGHT / 2);
    await settle();

    expect(onError).toHaveBeenCalledWith('A folder cannot be moved inside itself.');
  });

  it('makes a row draggable, since a folder with no affordance cannot be dragged', () => {
    render(<DragTree />);

    expect(row('a').getAttribute('draggable')).toBe('true');
  });

  it('makes no row draggable while one is being renamed', () => {
    const { rerender } = render(<DragTree />);
    expect(row('a').getAttribute('draggable')).toBe('true');

    rerender(<DragTreeWithEditor />);
    expect(row('a').getAttribute('draggable')).toBe('false');
  });

  it('makes no row draggable while its menu is open', () => {
    render(<DragTree />);

    fireEvent.click(screen.getByRole('button', { name: 'Work actions' }));

    expect(row('b').getAttribute('draggable')).toBe('false');
  });

  it('keeps rows draggable with a fine pointer, the mouse path', () => {
    stubPointer(false);
    render(<DragTree />);

    expect(row('a').getAttribute('draggable')).toBe('true');
  });

  it('makes no row draggable on a coarse pointer, where drag is not a path', () => {
    stubPointer(true);
    render(<DragTree />);

    expect(row('a').getAttribute('draggable')).toBe('false');
    expect(row('b').getAttribute('draggable')).toBe('false');
  });

  it('opening the menu clears a stuck drag, so the row selects again', () => {
    const onSelect = vi.fn();
    render(<DragTree onSelect={onSelect} />);

    fireEvent.dragStart(row('a'));
    fireEvent.click(row('a'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(row('a').getAttribute('data-dragging')).toBe('true');

    fireEvent.contextMenu(row('a'));
    expect(row('a').getAttribute('data-dragging')).toBeNull();

    fireEvent.keyDown(screen.getByTestId('folder-menu'), { key: 'Escape' });
    fireEvent.click(row('a'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'folder', id: 'a' });
  });
});

function DragTreeWithEditor(): React.ReactElement {
  const [creatingRoot, setCreatingRoot] = useState(true);
  const [selection] = useState<Selection>({ kind: 'all' });
  return (
    <FolderTree
      nodes={TREE}
      counts={new Map()}
      selection={selection}
      collapsed={[]}
      onSelect={noop}
      onToggle={noop}
      onCreate={noWrite}
      onRename={noWrite}
      onDelete={noWrite}
      onMove={noWrite}
      creatingRoot={creatingRoot}
      onCreatingRootChange={(open) => {
        setCreatingRoot(open);
      }}
    />
  );
}