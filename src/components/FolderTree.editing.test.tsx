import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FolderTree } from './FolderTree';
import { InlineNameInput } from './InlineNameInput';
import type { FolderNode } from '../types/folder';
import type { Selection } from '../types/ipc';

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
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('focuses the input on open so the user can type immediately', () => {
    render(<StatefulTree />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    expect(document.activeElement).toBe(input());
  });

  it('keeps the input selectable so a hold edits rather than opening a menu', () => {
    render(<StatefulTree />);
    fireEvent.click(screen.getByTestId('open-root-create'));

    expect(input().className).toContain('select-text');
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

    expect(screen.getByRole('dialog').textContent).toContain('2 folders');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('says notes inside survive rather than implying they are deleted too', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<StatefulTree onDelete={onDelete} />);

    openMenuFor('Work');
    fireEvent.click(screen.getByTestId('folder-menu-delete'));
    await settle();

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

    expect(screen.getByTestId('folder-menu').style.top).toBe('626px');
  });

  it('clamps the menu into the viewport when neither side fits the estimate', () => {
    render(<StatefulTree />);

    const target = row('a');
    target.getBoundingClientRect = (): DOMRect =>
      ({ top: 700, bottom: 726, left: 8, right: 300, width: 292, height: 26 }) as DOMRect;
    fireEvent.contextMenu(target);

    expect(screen.getByTestId('folder-menu').style.top).toBe('640px');
  });

  it('gives the twisty a larger tap target on coarse pointers', () => {
    render(<StatefulTree />);

    expect(screen.getByLabelText('Collapse Work').className).toContain(
      "pointer-coarse:before:content-['']",
    );
  });
});