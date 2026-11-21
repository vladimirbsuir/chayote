import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStatusBar } from './EditorStatusBar';
import { useSelectionStore } from '../stores/selection';

function bar(
  overrides: Partial<React.ComponentProps<typeof EditorStatusBar>> = {},
): React.ReactElement {
  const props: React.ComponentProps<typeof EditorStatusBar> = {
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

  it('renders the row itself unselectable, so a hold never selects its text', () => {
    const { container } = render(bar());

    expect((container.firstChild as HTMLElement).className).toContain('select-none');
  });

  it("shows the note's folder by name", () => {
    render(bar({ folderName: 'Work' }));

    expect(screen.getByTestId('status-folder').textContent).toContain('Work');
  });

  it('says so when a note has no folder, rather than showing an empty slot', () => {
    render(bar({ folderName: null }));

    expect(screen.getByTestId('status-folder').textContent).toBe('No folder');
  });

  it('names the action on the folder slot, not just its value', () => {
    render(bar({ folderName: 'Work' }));

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

    expect(screen.getByTestId('status-folder').tagName).toBe('BUTTON');
    expect(screen.getByTestId('status-tags').tagName).toBe('BUTTON');
  });
});
