import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStatusBar } from './EditorStatusBar';
import { useSelectionStore } from '../stores/selection';

/* `05-ui-ux.md` §6.3a: the pin control in the editor, next to the title. `Ctrl/Cmd+D`
   is bound on the window in `EditorPane`; this is the discoverable half of a
   shortcut rather than the only way to reach it — the same reasoning as the folder
   rename being both `F2` and a menu item. */

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

    /* §9's row carries the pin alongside what was already there; the pin is the
       third element, not a replacement for the other two. */
    expect(screen.getByTestId('word-count').textContent).toBe('342 words');
    expect(screen.getByTestId('save-state').textContent).toBe('Saved');
  });

  it('singularises the word count at one', () => {
    render(bar({ wordCount: 1 }));

    expect(screen.getByTestId('word-count').textContent).toBe('1 word');
  });

  /* `prototype/index.html` §3's Android editor view draws folder, tags, `342 w` and
     Saved — no title, because the bar above it carries the title, and no pin,
     because §2.4 gives the editor its own bar for actions. M7 measured what the
     desktop row does at 360 px: every element truncated, and `342 words` wrapping
     onto a second line. `05-ui-ux.md` §9's five-element row is the desktop row. */
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

    /* The 44 px claim is deliberately NOT asserted here. jsdom never loads the
       Tailwind layer, so `getBoundingClientRect` would be 0 and the assertion would
       pass or fail on nothing. It lives in `e2e/mobile.spec.ts`, which runs the real
       stylesheet — the same split `10-conventions.md` §10 draws for required test 14. */
  });
});
