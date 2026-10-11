import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { act, useState } from 'react';
import { FolderTree } from './FolderTree';
import type { FolderNode } from '../types/folder';
import type { Selection } from '../types/ipc';

/* §6.3: "Reordering and re-parenting by drag." The slot arithmetic is pure and lives
   in `folderRows.drag.test.ts`; what is here is the part that needs a DOM — that a
   drag start marks the right row, that `dragover` draws an indicator on the right band
   of the right row, that a refused drop writes nothing, and that a row under a live
   drag does not also select.

   jsdom reports every rect as the full window, so `dragover` is given an explicit
   offset and the row's height is what `dropZoneAt` divides. */

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

/* `isCoarsePointer` reads the live media, so both answers are pinned by stubbing
   `matchMedia` per case. The restore answers a fine pointer — behaviourally the
   default, and nothing else under `src/` reads the media. */
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

/** jsdom's `DragEvent` ignores `clientY` in its init — `fireEvent.dragOver(el, {
    clientY })` produces an event with no `clientY` at all, so the offset arrives as
    `NaN` and every band reads as `inside`. A `MouseEvent` typed `dragover` carries
    the coordinate and reaches the same React handler, so that is what the tests
    dispatch.

    The row's box is stubbed too. `src/test/setup.ts` reports every rect as the full
    viewport so the note-list virtualiser has something to measure, which means a real
    26 px row claims to be 768 px tall here and every offset lands in the top quarter.
    The stub is what makes "the top band" mean the top band. */
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

/** A complete drag: start on one row, hover a band of another, drop. */
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
    /* Dragging `a1`, which is neither a sibling of `b` nor inside it, so every band
       of `b` is a real move and each draws its own indicator. */
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
    /* `b` is already directly after `a`, so "below `a`" is where it is. The
       indicator is suppressed because a line that promises a reorder which does
       nothing is worse than no line at all. */
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
    /* M4's acceptance bar, verbatim: "dragging a folder onto its own descendant is
       refused with an explanation". The backend refuses it too — this asserts that
       nothing is even sent, so the refusal arrives while the pointer is down. */
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

    /* `b` is already directly after `a`. */
    drag('b', 'a', ROW_HEIGHT - 2);
    await settle();

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not change the selection while a drag passes over a row', () => {
    const onSelect = vi.fn();
    render(<DragTree onSelect={onSelect} />);

    fireEvent.dragStart(row('b'));
    dragOverAt('a', ROW_HEIGHT / 2);
    /* A click would select. A drag passing over the row must not, or every
       re-parent would also change which notes the list shows. */
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
    /* The backend's `CYCLE_DETECTED` and `NOT_FOUND` both arrive here. Swallowing
       them would make a drag that did nothing look like a drag that worked. */
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
    /* A drag started from inside an open text input would drag the selected text,
       not the folder. `draggable` goes false for the whole tree while an editor is
       open, which also covers the case of a row being renamed under the pointer. */
    const { rerender } = render(<DragTree />);
    expect(row('a').getAttribute('draggable')).toBe('true');

    rerender(<DragTreeWithEditor />);
    expect(row('a').getAttribute('draggable')).toBe('false');
  });

  it('makes no row draggable while its menu is open', () => {
    /* Otherwise a drag from the row under the menu would begin behind it. */
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
    /* §6.3: re-parenting by drag is mouse-only in v1. On touch a hold on a
       draggable row can start a drag that no `dragend` ever ends — found on a
       phone, where the row stayed dimmed and untappable. With nothing
       draggable there is nothing to get stuck. */
    stubPointer(true);
    render(<DragTree />);

    expect(row('a').getAttribute('draggable')).toBe('false');
    expect(row('b').getAttribute('draggable')).toBe('false');
  });

  it('opening the menu clears a stuck drag, so the row selects again', () => {
    /* The other half of the phone find: a drag that started before the menu's
       re-render withdrew `draggable` stays set with no `dragend` coming — the
       row is dimmed and clicks on it do nothing. Opening the menu ends the
       drag UI, so the row is a row again as soon as the menu closes. */
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

/** The same tree with a root-level create input open, which is the cheapest way to
    put the component in an editing state without driving the whole menu flow. */
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