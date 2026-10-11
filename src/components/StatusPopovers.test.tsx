import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderPicker, TagEditor } from './StatusPopovers';
import { flattenFolders } from './popoverPlacement';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';

/* `05-ui-ux.md` §6.4: "A tag is created by typing a new name into the tag editor;
   existing names complete. Case-insensitive match, normalised to the first-created
   spelling. Removing a tag from a note never deletes the tag itself."

   §6.4's "case-insensitive match, normalised to the first-created spelling" is
   mostly the backend's job — `tags_create` returns the existing row — so what is
   asserted here is the half the frontend owns: that typing a name which already
   exists toggles rather than asking for a duplicate. */

const FOLDERS: FolderNode[] = [
  {
    id: 'a',
    name: 'Work',
    parentId: null,
    position: 0,
    children: [{ id: 'a1', name: 'Projects', parentId: 'a', position: 0, children: [] }],
  },
  { id: 'b', name: 'Personal', parentId: null, position: 1, children: [] },
];

const TAGS: TagWithCount[] = [
  { id: 't-work', name: 'work', count: 14 },
  { id: 't-ideas', name: 'ideas', count: 3 },
];

function anchor(): HTMLElement {
  const element = document.createElement('button');
  element.textContent = 'status bar';
  document.body.append(element);
  return element;
}

const PLACEMENT = { top: 400, left: 300 };

describe('flattenFolders', () => {
  it('flattens depth-first, carrying the depth for indentation', () => {
    expect(flattenFolders(FOLDERS)).toEqual([
      { id: 'a', name: 'Work', depth: 0 },
      { id: 'a1', name: 'Projects', depth: 1 },
      { id: 'b', name: 'Personal', depth: 0 },
    ]);
  });

  it('returns nothing for an empty tree, which is the first-launch state', () => {
    expect(flattenFolders([])).toEqual([]);
  });
});

describe('FolderPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function renderPicker(overrides: Partial<React.ComponentProps<typeof FolderPicker>> = {}): {
    onPick: ReturnType<typeof vi.fn>;
  } {
    const onPick = vi.fn();
    const props: React.ComponentProps<typeof FolderPicker> = {
      anchor: anchor(),
      placement: PLACEMENT,
      folders: FOLDERS,
      current: 'a',
      onPick,
      onClose: vi.fn(),
      ...overrides,
    };
    render(<FolderPicker {...props} />);
    return { onPick };
  }

  it('offers the whole tree plus a "no folder" option, in document order', () => {
    renderPicker();

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options[0]).toContain('None');
    expect(options).toHaveLength(4);
  });

  it('marks the note\'s current folder, so the choice is visible before it is made', () => {
    renderPicker();

    const selected = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute('data-folder-id')).toBe('a');
  });

  it('reports the folder that was picked', () => {
    const { onPick } = renderPicker();

    fireEvent.click(screen.getAllByRole('option')[3] as HTMLElement);

    expect(onPick).toHaveBeenCalledWith('b');
  });

  it('can clear the folder, because "unfiled" is a real choice', () => {
    const { onPick } = renderPicker({ current: 'a' });

    /* ADR-014: everything starts unfiled, so a note can always go back there. */
    fireEvent.click(screen.getAllByRole('option')[0] as HTMLElement);

    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('moves between options with the arrow keys', () => {
    renderPicker();

    const list = screen.getByTestId('folder-picker-list');
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getAllByRole('option')[0]);
  });

  it('closes on Escape without picking', () => {
    const onClose = vi.fn();
    const onPick = vi.fn();
    renderPicker({ onClose, onPick });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes on a click outside, and stays open on a click inside', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    fireEvent.mouseDown(screen.getByTestId('status-popover'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TagEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function renderEditor(overrides: Partial<React.ComponentProps<typeof TagEditor>> = {}): {
    onToggle: ReturnType<typeof vi.fn>;
    onCreate: ReturnType<typeof vi.fn>;
  } {
    const onToggle = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const props: React.ComponentProps<typeof TagEditor> = {
      anchor: anchor(),
      placement: PLACEMENT,
      tags: TAGS,
      selected: [],
      onToggle,
      onCreate,
      onClose: vi.fn(),
      ...overrides,
    };
    render(<TagEditor {...props} />);
    return { onToggle, onCreate };
  }

  it('lists every tag with a count, and marks the ones the note carries', () => {
    renderEditor({ selected: ['t-work'] });

    expect(screen.getAllByRole('option')).toHaveLength(2);
    const selected = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute('data-tag-id')).toBe('t-work');
  });

  it('renders the popover itself unselectable so a hold picks, never selects', () => {
    renderEditor();

    expect(screen.getByTestId('status-popover').className).toContain('select-none');
  });

  it('keeps the filter input selectable under the unselectable popover', () => {
    renderEditor();

    expect(screen.getByTestId('tag-editor-input').className).toContain('select-text');
  });

  it('declares itself a multi-select listbox, which is what it is', () => {
    renderEditor();

    const list = screen.getByTestId('tag-editor-list');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('toggles a tag off the note without deleting it anywhere', () => {
    const { onToggle, onCreate } = renderEditor({ selected: ['t-work'] });

    fireEvent.click(screen.getAllByRole('option')[0] as HTMLElement);

    /* §6.4: "Removing a tag from a note never deletes the tag itself." The editor has
       no delete affordance at all, which is the simplest way to guarantee it. */
    expect(onToggle).toHaveBeenCalledWith('t-work');
    expect(onCreate).not.toHaveBeenCalled();
    /* The tag is still listed. §6.4: removing a tag from a note never removes the
       tag itself, and a library that lost the entry would make it unaddable again
       without typing it. */
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('filters as you type, so existing names complete', () => {
    renderEditor();

    fireEvent.change(screen.getByTestId('tag-editor-input'), { target: { value: 'wor' } });

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getAllByRole('option')[0]?.textContent).toContain('work');
  });

  it('matches existing names case-insensitively, per §6.4', () => {
    renderEditor();

    fireEvent.change(screen.getByTestId('tag-editor-input'), { target: { value: 'WORK' } });

    expect(screen.getAllByRole('option')[0]?.textContent).toContain('work');
  });

  it('toggles rather than creating when the typed name already exists', () => {
    const { onToggle, onCreate } = renderEditor();

    fireEvent.change(screen.getByTestId('tag-editor-input'), { target: { value: 'Work' } });
    fireEvent.keyDown(screen.getByTestId('tag-editor-input'), { key: 'Enter' });

    /* The backend normalises to the first-created spelling, so asking it to create
       `Work` again would be asking for a second `work`. The exact-match case is a
       request to add the tag, not to duplicate it. */
    expect(onToggle).toHaveBeenCalledWith('t-work');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a tag that does not exist yet', () => {
    const { onToggle, onCreate } = renderEditor();

    fireEvent.change(screen.getByTestId('tag-editor-input'), { target: { value: 'urgent' } });
    fireEvent.keyDown(screen.getByTestId('tag-editor-input'), { key: 'Enter' });

    expect(onCreate).toHaveBeenCalledWith('urgent');
    /* Not toggled here: the backend returns the row, and the shell toggles it with
       the id that comes back. */
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does nothing on Enter with an empty field', () => {
    const { onToggle, onCreate } = renderEditor();

    fireEvent.keyDown(screen.getByTestId('tag-editor-input'), { key: 'Enter' });

    expect(onCreate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('says what Enter will do when nothing matches, rather than showing an empty box', () => {
    renderEditor();

    fireEvent.change(screen.getByTestId('tag-editor-input'), { target: { value: 'urgent' } });

    /* §8's rule that every state explains the cause. */
    expect(screen.getByText(/Press Enter to create/)).toBeDefined();
  });

  it('says there are no tags yet on an empty library', () => {
    renderEditor({ tags: [] });

    expect(screen.getByText('No tags yet')).toBeDefined();
  });

  it('moves between options with the arrow keys', () => {
    renderEditor();

    fireEvent.keyDown(screen.getByTestId('tag-editor-list'), { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getAllByRole('option')[0]);
  });

  it('closes on Escape without changing anything', () => {
    const onClose = vi.fn();
    const { onToggle } = renderEditor({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('carries no document and no counts into the note list', () => {
    renderEditor();

    /* `03-data-model.md` §3.3: a `NoteSummary` carries tags as `{id, name}` and
       nothing else. The editor shows the count because the tag library carries it,
       not because the note does. */
    const option = screen.getAllByRole('option')[0];
    expect(option?.textContent).not.toContain('14');
  });
});