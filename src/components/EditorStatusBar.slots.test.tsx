import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStatusBar } from './EditorStatusBar';
import { useSelectionStore } from '../stores/selection';

/* `04-editor.md` §9: the status bar is five elements in one 28 px row — title, folder,
   tags, word count, save state — and the folder and tags slots are "click to change".

   These tests cover the slots themselves. The editors behind them are in
   `StatusPopovers.test.tsx`, and the path from a click through to the database is in
   `e2e/shell.spec.ts`; what is left is the row, which has two ways of being wrong
   that neither of those would catch: a slot that looks interactive and is not, and a
   slot that names its value but not its action. */

function bar(overrides: Partial<React.ComponentProps<typeof EditorStatusBar>> = {}): React.ReactElement {
  const props: React.ComponentProps<typeof EditorStatusBar> = {
    title: 'Meeting notes',
    wordCount: 342,
    saveState: 'saved',
    isPinned: false,
    onTogglePin: () => {},
    folderName: null,
    tagNames: [],
    onPickFolder: () => {},
    onEditTags: () => {},
    ...overrides,
  };
  return <EditorStatusBar {...props} />;
}

describe('EditorStatusBar folder and tag slots', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('shows the note\'s folder by name', () => {
    render(bar({ folderName: 'Work' }));

    expect(screen.getByTestId('status-folder').textContent).toContain('Work');
  });

  it('says so when a note has no folder, rather than showing an empty slot', () => {
    render(bar({ folderName: null }));

    /* ADR-014: everything starts unfiled, so this is the state a new note is in and
       it has to read as a choice rather than as missing data. */
    expect(screen.getByTestId('status-folder').textContent).toBe('No folder');
  });

  it('names the action on the folder slot, not just its value', () => {
    render(bar({ folderName: 'Work' }));

    /* "Work, button" does not say what pressing it does. */
    expect(screen.getByTestId('status-folder').getAttribute('aria-label')).toBe('Change folder');
  });

  it('offers the same slot when there is nothing to change yet', () => {
    render(bar({ folderName: null }));

    expect(screen.getByTestId('status-folder').getAttribute('aria-label')).toBe('Choose folder');
  });

  it('shows one tag inline', () => {
    render(bar({ tagNames: ['work'] }));

    expect(screen.getByTestId('status-tags').textContent).toBe('#work');
  });

  it('shows the first tag and a count of the rest', () => {
    render(bar({ tagNames: ['work', 'ideas', 'urgent'] }));

    /* A note with four tags does not fit in a 28 px row, and truncating the name of
       the one shown would be worse than saying how many there are. */
    expect(screen.getByTestId('status-tags').textContent).toBe('#work +2');
  });

  it('invites a tag on a note that has none', () => {
    render(bar({ tagNames: [] }));

    expect(screen.getByTestId('status-tags').textContent).toBe('Add tags');
    expect(screen.getByTestId('status-tags').getAttribute('aria-label')).toBe('Choose tags');
  });

  it('hands the slot element to the callback, because the popover anchors to it', () => {
    const onPickFolder = vi.fn();
    render(bar({ folderName: 'Work', onPickFolder }));

    fireEvent.click(screen.getByTestId('status-folder'));

    /* Measured at the click, not looked up later: a popover placed against a stored
       rectangle would drift as soon as the window moved. */
    expect(onPickFolder).toHaveBeenCalledTimes(1);
    expect(onPickFolder.mock.calls[0]?.[0]).toBe(screen.getByTestId('status-folder'));
  });

  it('hands the tag slot its own element', () => {
    const onEditTags = vi.fn();
    render(bar({ tagNames: ['work'], onEditTags }));

    fireEvent.click(screen.getByTestId('status-tags'));

    expect(onEditTags.mock.calls[0]?.[0]).toBe(screen.getByTestId('status-tags'));
  });

  it('reaches both slots from the keyboard', () => {
    render(bar({ folderName: 'Work', tagNames: ['work'] }));

    /* §10: every action keyboard reachable. A slot that looked interactive and was not
       would be the worse failure than having no slot at all. */
    expect(screen.getByTestId('status-folder').tagName).toBe('BUTTON');
    expect(screen.getByTestId('status-tags').tagName).toBe('BUTTON');
  });
});