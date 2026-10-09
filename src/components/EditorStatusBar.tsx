import { Pin } from 'lucide-react';
import type { SaveState } from '../stores/editor';

type EditorStatusBarProps = {
  title: string;
  wordCount: number;
  saveState: SaveState;
  /** `05-ui-ux.md` §6.3a: the pin control in the editor. The same `Ctrl/Cmd+D` is
      bound on the window in `EditorPane`, so this is the discoverable half of a
      shortcut rather than the only way to reach it. */
  isPinned: boolean;
  onTogglePin: () => void;
};

/* `04-editor.md` §9 — a single 28 px row, nothing else. §5.2 fixes the four
   states and §10 puts the changing one in an `aria-live` region, so a screen
   reader announces "Saved" without the focus moving.

   M2 shipped title, word count, and save state. §9 also lists folder and tags;
   those arrive with M4's data in the same commit as the editors that populate
   them, so this row never shows a control that does nothing. The pin is here
   already because pinning *is* M4 and the data exists. */

const LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  error: "Couldn't save — retrying",
};

const DOT: Record<SaveState, string> = {
  saved: 'bg-[var(--success)]',
  saving: 'bg-[var(--accent)]',
  unsaved: 'bg-[var(--warning)]',
  error: 'bg-[var(--danger)]',
};

export function EditorStatusBar({
  title,
  wordCount,
  saveState,
  isPinned,
  onTogglePin,
}: EditorStatusBarProps) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[12px] text-[var(--text-muted)]">
      <span className="truncate">{title}</span>

      <button
        type="button"
        aria-pressed={isPinned}
        aria-label={isPinned ? 'Unpin note' : 'Pin note'}
        title={isPinned ? 'Unpin (Ctrl+D)' : 'Pin (Ctrl+D)'}
        data-testid="editor-pin-toggle"
        onClick={onTogglePin}
        className={`grid h-[20px] w-[20px] flex-none place-items-center rounded transition-colors ${
          isPinned
            ? 'text-[var(--accent)]'
            : 'text-[var(--text-subtle)] hover:text-[var(--text)]'
        }`}
      >
        <Pin className="icon i-16" aria-hidden="true" />
      </button>

      <div className="ml-auto flex items-center gap-3">
        <span data-testid="word-count">
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
        <span
          aria-live="polite"
          data-testid="save-state"
          data-state={saveState}
          className={
            saveState === 'error'
              ? 'flex items-center gap-[5px] text-[var(--danger)]'
              : 'flex items-center gap-[5px]'
          }
        >
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[saveState]}`} aria-hidden="true" />
          {LABEL[saveState]}
        </span>
      </div>
    </div>
  );
}