import { render, screen } from '@testing-library/react';
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

describe('EditorStatusBar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('keeps the four states of 04-editor.md §5.2 in an aria-live region', () => {
    render(bar({ saveState: 'unsaved' }));

    const status = screen.getByTestId('save-state');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Unsaved changes');
  });

  it('shows a pin control with the note open', () => {
    render(bar());

    expect(screen.getByTestId('editor-pin-toggle')).toBeDefined();
  });

  it('labels the control by what it will do', () => {
    render(bar({ isPinned: false }));
    expect(screen.getByRole('button', { name: 'Pin note' }).getAttribute('aria-pressed')).toBe(
      'false',
    );

    render(bar({ isPinned: true }));
    expect(
      screen.getAllByRole('button', { name: 'Unpin note' })[0]?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('names the shortcut in the tooltip, since the control is the discovery path for it', () => {
    render(bar({ isPinned: false }));

    expect(screen.getByTestId('editor-pin-toggle').getAttribute('title')).toBe('Pin (Ctrl+D)');
  });

  it('calls back rather than reaching for storage itself', () => {
    const onTogglePin = vi.fn();
    render(bar({ onTogglePin }));

    screen.getByTestId('editor-pin-toggle').click();

    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it('still renders word count and save state beside the pin', () => {
    render(bar());

    expect(screen.getByTestId('word-count').textContent).toBe('342 words');
    expect(screen.getByTestId('save-state').textContent).toBe('Saved');
  });

  it('singularises the word count at one', () => {
    render(bar({ wordCount: 1 }));

    expect(screen.getByTestId('word-count').textContent).toBe('1 word');
  });

  describe('mobile variant', () => {
    it('drops the pin, which moves to the editor overflow menu', () => {
      render(bar({ variant: 'mobile', isPinned: true }));

      expect(screen.queryByTestId('editor-pin-toggle')).toBeNull();
    });

    it('abbreviates the word count, as the prototype draws it', () => {
      render(bar({ variant: 'mobile', wordCount: 342 }));

      expect(screen.getByTestId('word-count').textContent).toBe('342 w');
    });

    it('keeps folder, tags and save state — the row is reduced, not emptied', () => {
      render(bar({ variant: 'mobile', folderName: 'Work', tagNames: ['urgent'] }));

      expect(screen.getByTestId('status-folder').textContent).toContain('Work');
      expect(screen.getByTestId('status-tags').textContent).toBe('#urgent');
      expect(screen.getByTestId('save-state').textContent).toBe('Saved');
    });

  });
});
