import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStatusBar } from './EditorStatusBar';
import { useSelectionStore } from '../stores/selection';

/* `05-ui-ux.md` §6.3a: the pin control in the editor, next to the title. `Ctrl/Cmd+D`
   is bound on the window in `EditorPane`; this is the discoverable half of a
   shortcut rather than the only way to reach it — the same reasoning as the folder
   rename being both `F2` and a menu item. */

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
    expect(screen.getAllByRole('button', { name: 'Unpin note' })[0]?.getAttribute('aria-pressed')).toBe(
      'true',
    );
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

    /* §9 lists five elements in one 28 px row; the pin is the third, not a
       replacement for the other two. */
    expect(screen.getByTestId('word-count').textContent).toBe('342 words');
    expect(screen.getByTestId('save-state').textContent).toBe('Saved');
    expect(screen.getByText('Meeting notes')).toBeDefined();
  });

  it('singularises the word count at one', () => {
    render(bar({ wordCount: 1 }));

    expect(screen.getByTestId('word-count').textContent).toBe('1 word');
  });
});