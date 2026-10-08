import type { SaveState } from '../stores/editor';

type EditorStatusBarProps = {
  title: string;
  wordCount: number;
  saveState: SaveState;
};

/* `04-editor.md` §9 — a single 28 px row, nothing else. §5.2 fixes the four
   states and §10 puts the changing one in an `aria-live` region, so a screen
   reader announces "Saved" without the focus moving.

   M2 ships title, word count, and save state. The folder and tag elements §9
   lists need M4's data; they arrive with it rather than as empty slots, so this
   row never shows a control that does nothing. */

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

export function EditorStatusBar({ title, wordCount, saveState }: EditorStatusBarProps) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[12px] text-[var(--text-muted)]">
      <span className="truncate">{title}</span>
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