import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FolderTree } from './FolderTree';
import { InlineNameInput } from './InlineNameInput';
import type { FolderNode } from '../types/folder';
import type { Selection } from '../types/ipc';

/* `05-ui-ux.md` §6.3: "Creating a folder is inline: a single text input in place,
   `Enter` commits, `Esc` cancels, empty input cancels. Renaming is the same."
   Deleting a folder with children needs a confirmation that names the count.

   These drive the tree through `StatefulTree` rather than through `renderTree`,
   because the components under test own only *what* is being edited: the open/closed
   decision and the text live one level up, split between `FolderTree` and `Sidebar`.
   A test that passed them as constants would assert only the rendering, and the
   behaviour under test — does an empty input cancel, does a rejected write keep what
   was typed — does not exist without the state.

   The writes resolve on a microtask and the component attaches its `.catch`, so
   every test waits a turn before asserting. `fireEvent` already wraps its dispatch
   in `act`, and the promise settlement is what needs the extra turn. */

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

const noWrite = (): Promise<void> => Promise.resolve();
const noMove = (): Promise<void> => Promise.resolve();

function row(id: string): HTMLElement {
  const found = document.querySelector(`[data-testid="folder-row"][data-folder-id="${id}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no row for folder ${id}`);
  return found;
}

function rowOrNull(id: string): HTMLElement | null {
  const found = document.querySelector(`[data-testid="folder-row"][data-folder-id="${id}"]`);
  return found instanceof HTMLElement ? found : null;
}

function input(): HTMLInputElement {
  const found = screen.getByTestId('folder-name-input');
  if (!(found instanceof HTMLInputElement)) throw new Error('no name input');
  return found;
}

function StatefulTree({
  onCreate = noWrite,
  onRename = noWrite,
  onDelete = noWrite,
  onMove = noMove,
}: {
  onCreate?: (name: string, parentId: string | null) => Promise<void>;
  onRename?: (id: string, name: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onMove?: (id: string, newParentId: string | null, position: number) => Promise<void>;
}): React.ReactElement {
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });

  return (
    <>
      <button
        type="button"
        data-testid="open-root-create"
        onClick={() => {
          setCreatingRoot((open) => !open);
        }}
      >
        New folder
      </button>
      <FolderTree
        nodes={TREE}
        counts={new Map()}
        selection={selection}
        collapsed={[]}
        onSelect={(next) => {
          setSelection(next);
        }}
        onToggle={() => {
          /* Collapsing is a committed behaviour, tested in `FolderTree.test.tsx`.
             This file is about editing, and a toggle would only move rows out from
             under the input the assertion is about. */
        }}
onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={onMove}
        creatingRoot={creatingRoot}
        onCreatingRootChange={setCreatingRoot}
      />
    </>
  );
}

/** Let a resolved or rejected write settle, so the component's own state update
    from `.catch` has rendered before the assertion.

    Inside `act`, and not a bare `await Promise.resolve()`: the restore-on-rejection
    path is a React state update, so without `act` React applies it outside a render
    cycle and the assertions below read the tree as it was before the failure. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function openMenuFor(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: `${name} actions` }));
}

describe('inline folder editing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an inline input from the add button, not a dialog', () => {
    render(<StatefulTree />);

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('open-root-create'));

    expect(input()).toBeDefined();
    /* The point of §6.3: one word should not cost a modal. */
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('focuses the input on open so the user can type immediately', () => {
    render(<StatefulTree />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    expect(document.activeElement).toBe(input());
  });

  it('commits a typed name with Enter', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    fireEvent.change(input(), { target: { value: 'Research' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    expect(onCreate).toHaveBeenCalledWith('Research', null);
    expect(screen.queryByTestId('folder-name-input')).toBeNull();
  });

  it('commits once when Enter and blur fire for the same dismissal', () => {
    /* Found on a phone: the soft keyboard's Enter both commits and drops
       focus, so the blur handler committed a second time — and folder names
       carry no uniqueness constraint, so one Enter made two folders. Driven
       through the input itself rather than the tree: the tree closes the
       editor on the first commit, which would unmount the field before the
       second event and test nothing. */
    const onCommit = vi.fn();
    render(
      <InlineNameInput
        label="New folder name"
        placeholder="Folder name"
        value="Research"
        error={null}
        onChange={() => {}}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );

    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.blur(input());

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('stays retryable after a refused commit, since editing clears the guard', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce({ code: 'VALIDATION', message: 'No good.' })
      .mockResolvedValue(undefined);
    render(<StatefulTree onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    fireEvent.change(input(), { target: { value: 'Research' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();
    fireEvent.change(input(), { target: { value: 'Research 2' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it('trims the name, so a stray space cannot create " Work" beside "Work"', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    fireEvent.change(input(), { target: { value: '  Work  ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    expect(onCreate).toHaveBeenCalledWith('Work', null);
  });

  it('cancels on an empty name rather than sending it', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    /* §6.3: "empty input cancels". */
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('folder-name-input')).toBeNull();
  });

  it('cancels on Escape without writing', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    fireEvent.change(input(), { target: { value: 'Draft' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    await settle();

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('folder-name-input')).toBeNull();
  });

  it('does not let Escape reach the tree and act on the row underneath', async () => {
    const onSelect = vi.fn();
    render(<StatefulTree />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    fireEvent.keyDown(input(), { key: 'Escape' });
    await settle();

    /* The tree binds Escape-adjacent keys on the row; the input has to stop the
       event or closing the editor also moves the selection. */
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('nests a new folder under the row that asked for it', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onCreate={onCreate} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-create'));

    fireEvent.change(input(), { target: { value: 'Sub' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    expect(onCreate).toHaveBeenCalledWith('Sub', 'a');
  });

  it('replaces the row with a rename input holding its current name', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onRename={onRename} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-rename'));

    expect(input().value).toBe('Work');
    /* The old row is gone, not stacked above the input: two controls for one folder
       would mean two entries in the tab order. */
    expect(rowOrNull('a')).toBeNull();

    fireEvent.change(input(), { target: { value: 'Day job' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    expect(onRename).toHaveBeenCalledWith('a', 'Day job');
  });

  it('keeps the input open and shows the reason when a rename is refused', async () => {
    const onRename = vi.fn().mockRejectedValue({ message: 'Give the folder a name.' });
    render(<StatefulTree onRename={onRename} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-rename'));
    fireEvent.change(input(), { target: { value: 'Day job' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    /* §8's "Folder rename conflict | Inline | Keep editing". The typed value has to
       survive, or the user retypes it. */
    expect(input().value).toBe('Day job');
    expect(screen.getByRole('alert').textContent).toBe('Give the folder a name.');
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the error as soon as the user types again', async () => {
    const onRename = vi.fn().mockRejectedValue({ message: 'Give the folder a name.' });
    render(<StatefulTree onRename={onRename} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-rename'));
    fireEvent.change(input(), { target: { value: 'Day job' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();
    expect(screen.getByRole('alert')).toBeDefined();

    fireEvent.change(input(), { target: { value: 'Day job 2' } });

    /* A message that outlasts the attempt it describes is a message about the past. */
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input().getAttribute('aria-invalid')).toBe('false');
  });

  it('restores a refused root create into the input rather than losing it', async () => {
    const onCreate = vi.fn().mockRejectedValue({ message: 'Could not save that.' });
    render(<StatefulTree onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    fireEvent.change(input(), { target: { value: 'Draft' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    expect(input().value).toBe('Draft');
    expect(screen.getByRole('alert').textContent).toBe('Could not save that.');
  });

  it('falls back to a generic message for an error that carries none', async () => {
    const onRename = vi.fn().mockRejectedValue({});
    render(<StatefulTree onRename={onRename} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-rename'));
    fireEvent.change(input(), { target: { value: 'Day job' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    /* `AppError` always has a message, but a throw that is not one must not render
       `undefined` to the user. */
    expect(screen.getByRole('alert').textContent).toBe('That could not be saved.');
  });
});

describe('folder deletion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes a childless folder without asking, since there is nothing to warn about', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onDelete={onDelete} />);

    openMenuFor('Projects');
    fireEvent.click(screen.getByTestId('folder-menu-delete'));
    await settle();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onDelete).toHaveBeenCalledWith('a1');
  });

  it('confirms before deleting a subtree, and names how many folders go with it', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onDelete={onDelete} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-delete'));
    await settle();

    /* §6.3: "Deleting a folder with children requires confirmation naming the
       count." The count is the reason the dialog exists. */
    expect(screen.getByRole('dialog').textContent).toContain('2 folders');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('says notes inside survive rather than implying they are deleted too', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onDelete={onDelete} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-delete'));
    await settle();

    /* `notes.folder_id` is `ON DELETE SET NULL`, so the notes become unfiled. A
       dialog that said "and its notes" would be describing data we keep. */
    expect(screen.getByRole('dialog').textContent).toContain('become unfiled');
  });

  it('deletes only once the confirmation is accepted', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onDelete={onDelete} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-delete'));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await settle();

    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onDelete={onDelete} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deletes with the Delete key and still confirms', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onDelete={onDelete} />);

    /* §7's shortcut goes through the same path as the menu item, so the
       confirmation cannot be present for one and absent for the other. */
    fireEvent.keyDown(row('a'), { key: 'Delete' });
    await settle();

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('folder row menu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on right-click, which is what §2.2 specifies', () => {
    render(<StatefulTree />);

    fireEvent.contextMenu(row('a'));

    expect(screen.getByTestId('folder-menu')).toBeDefined();
  });

  it('renames with F2, the §7 shortcut', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onRename={onRename} />);

    fireEvent.keyDown(row('a'), { key: 'F2' });
    expect(input().value).toBe('Work');

    fireEvent.change(input(), { target: { value: 'Day job' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();

    expect(onRename).toHaveBeenCalledWith('a', 'Day job');
  });

  it('returns focus to the row when the menu closes', () => {
    render(<StatefulTree />);

    openMenuFor('Work');
    expect(screen.getByTestId('folder-menu-rename')).toBeDefined();

    fireEvent.keyDown(screen.getByTestId('folder-menu'), { key: 'Escape' });

    expect(screen.queryByTestId('folder-menu')).toBeNull();
    expect(document.activeElement).toBe(row('a'));
  });

  it('moves between items with the arrow keys and wraps at the ends', () => {
    render(<StatefulTree />);
    openMenuFor('Work');

    fireEvent.keyDown(screen.getByTestId('folder-menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('folder-menu-create'));

    fireEvent.keyDown(screen.getByTestId('folder-menu'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('folder-menu-rename'));

    fireEvent.keyDown(screen.getByTestId('folder-menu'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('folder-menu-delete'));
  });

  it('labels each item as an action on that folder, not a bare verb', () => {
    render(<StatefulTree />);

    openMenuFor('Work');

    /* §10: an icon-only or verb-only control in a list of rows is ambiguous about
       what it acts on. The menu is text for that reason as much as for the icon
       inventory — the folder name belongs in the label. */
    expect(screen.getByRole('menu', { name: 'Work actions' })).toBeDefined();
  });

  it('keeps its own items out of the tab order, since the row opens it', () => {
    render(<StatefulTree />);
    openMenuFor('Work');

    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('closes on a click outside, which is how a popover behaves', () => {
    render(<StatefulTree />);
    openMenuFor('Work');

    fireEvent.click(document.body);

    expect(screen.queryByTestId('folder-menu')).toBeNull();
  });

  it('portals the menu to the body, outside the scrolling tree', () => {
    /* Found on a phone: the menu rendered in the row and the tree's `overflow`
       clipped it to a sliver. A menu under the tree in the DOM cannot be
       clipped by it; `e2e/shell.spec.ts` right-clicks a real row for the same
       path, and `e2e/mobile.spec.ts` asserts the geometry where it matters. */
    render(<StatefulTree />);
    openMenuFor('Work');

    const menu = screen.getByTestId('folder-menu');
    expect(menu.parentElement).toBe(document.body);
    expect(menu.className).toContain('fixed');
  });

  it('opens upward when the row has no room below it', () => {
    render(<StatefulTree />);

    const target = row('a');
    target.getBoundingClientRect = (): DOMRect =>
      ({ top: 630, bottom: 656, left: 8, right: 300, width: 292, height: 26 }) as DOMRect;
    fireEvent.contextMenu(target);

    /* 656 + 120 clears the 768 px jsdom viewport, and 630 clears the menu
       above — so the menu lands above the row rather than clipped below it. */
    expect(screen.getByTestId('folder-menu').style.top).toBe('626px');
  });

  it('clamps the menu into the viewport when neither side fits the estimate', () => {
    render(<StatefulTree />);

    const target = row('a');
    target.getBoundingClientRect = (): DOMRect =>
      ({ top: 700, bottom: 726, left: 8, right: 300, width: 292, height: 26 }) as DOMRect;
    fireEvent.contextMenu(target);

    /* 726 + 120 clears the 768 px jsdom viewport, but so would 696 + 120 — a
       tall row near the fold fits the estimate neither below nor above, and
       the trash-restore flow arrived 13 px clipped past it. The estimate is
       clamped so the box lands inside; overlapping the row is fine. */
    expect(screen.getByTestId('folder-menu').style.top).toBe('640px');
  });

  it('gives the twisty a larger tap target on coarse pointers', () => {
    /* §9's 44 px bar does not fit a 16 px twisty in a 26 px row; the invisible
       hit slop below roughly doubles the target on touch without moving any
       pixel or stealing taps on desktop, where the rule is hover, not touch. */
    render(<StatefulTree />);

    expect(screen.getByLabelText('Collapse Work').className).toContain(
      "pointer-coarse:before:content-['']",
    );
  });
});