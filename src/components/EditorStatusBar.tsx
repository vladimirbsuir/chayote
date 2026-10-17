import { Folder, Hash, Pin } from 'lucide-react';
import type { SaveState } from '../stores/editor';

type EditorStatusBarProps = {
  wordCount: number;
  saveState: SaveState;
  /** `05-ui-ux.md` §6.3a: the pin control in the editor. The same `Ctrl/Cmd+D` is
      bound on the window in `EditorPane`, so this is the discoverable half of a
      shortcut rather than the only way to reach it.

      Not rendered on mobile — the pin moves to the editor's overflow menu there,
      which is where §2.4 puts a note action that will not fit in the row. */
  isPinned: boolean;
  onTogglePin: () => void;
  /** `04-editor.md` §9: "Folder | Note's folder name, click to change" and "Tags |
      Note's tags, click to add or remove". Both arrive with M4's data rather than as
      empty slots, so the row never shows a control that does nothing.

      The names are the pending values — what the next autosave will write — not
      what the database holds, because a click that appears to do nothing until the
      debounce commits is the same lie the pin had. */
  folderName: string | null;
  tagNames: string[];
  onPickFolder: (anchor: HTMLElement) => void;
  onEditTags: (anchor: HTMLElement) => void;
  /** `05-ui-ux.md` §2.4 and the prototype's Android editor view. */
  variant?: 'desktop' | 'mobile';
};

/* `04-editor.md` §9 — a single 28 px row, nothing else. §5.2 fixes the four
   states and §10 puts the changing one in an `aria-live` region, so a screen
   reader announces "Saved" without the focus moving.

   **The row no longer names the note.** It did from M2 until ADR-023, and the
   title was here on desktop and in the bar above it on mobile — in two places,
   neither of them editable. It is the field in `NoteHeader` now, which is the
   only place in the editor the note's name can be changed, and a title shown
   twice is a title that can disagree with itself.

   **The mobile variant is not a subset chosen by taste — it is what the prototype
   already draws.** `prototype/index.html` §3's Android editor view shows folder,
   tags, `342 w` and Saved, and no title, because the title is in the bar above it,
   and no pin, because §2.4 gives the editor its own bar for actions. Rendering all
   six on a 360 px screen truncated every one of them to a letter or an ellipsis;
   M7 measured it on a device. `05-ui-ux.md` §9's row is the *desktop* row. */

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
  wordCount,
  saveState,
  isPinned,
  onTogglePin,
  folderName,
  tagNames,
  onPickFolder,
  onEditTags,
  variant = 'desktop',
}: EditorStatusBarProps) {
  const mobile = variant === 'mobile';
  return (
    <div
      /* Status text is chrome, not content: folder, tags, word count and save
         state are read, never copied — copying happens in the editor. */
      data-testid="editor-status-bar"
      className={`flex shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] text-[12px] text-[var(--text-muted)] select-none ${
        mobile ? 'h-11 gap-2 px-1' : 'h-7 px-3'
      }`}
    >
      <SlotButton
        testId="status-folder"
        label={folderName ?? 'No folder'}
        emptyLabel="No folder"
        icon={<Folder className="icon i-16" aria-hidden="true" />}
        onClick={onPickFolder}
        mobile={mobile}
      />

      <SlotButton
        testId="status-tags"
        /* The prototype's status bar shows one tag inline and the rest in the
           popover; a note with four tags does not fit in a 28 px row, and truncating
           the name of the one shown would be worse than showing how many there are. */
        label={
          tagNames.length === 0
            ? 'Add tags'
            : tagNames.length === 1
              ? `#${tagNames[0] ?? ''}`
              : `#${tagNames[0] ?? ''} +${tagNames.length - 1}`
        }
        emptyLabel="Add tags"
        icon={<Hash className="icon i-16" aria-hidden="true" />}
        onClick={onEditTags}
        mobile={mobile}
      />

      {mobile ? null : (
        <button
          type="button"
          aria-pressed={isPinned}
          aria-label={isPinned ? 'Unpin note' : 'Pin note'}
          title={isPinned ? 'Unpin (Ctrl+D)' : 'Pin (Ctrl+D)'}
          data-testid="editor-pin-toggle"
          onClick={onTogglePin}
          className={`grid h-[20px] w-[20px] flex-none place-items-center rounded transition-colors ${
            isPinned ? 'text-[var(--accent)]' : 'text-[var(--text-subtle)] hover:text-[var(--text)]'
          }`}
        >
          <Pin className="icon i-16" aria-hidden="true" />
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span data-testid="word-count">
          {/* The prototype writes `342 w` on Android and `342 words` on the desktop.
              At 360 px the full word costs a wrapped second line, which pushed the
              row past its height and clipped the save state. */}
          {mobile ? `${wordCount} w` : `${wordCount} ${wordCount === 1 ? 'word' : 'words'}`}
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

/** One of the two `04-editor.md` §9 slots. A button rather than a `<span>`, because
    §9 says "click to change" and §10 requires every action to be keyboard reachable
    — a slot that looked interactive and was not would be the worse of the two.

    `aria-label` names the action rather than the value, so a screen reader
    announcing "Work, button" does not say what pressing it would do. */
function SlotButton({
  testId,
  label,
  emptyLabel,
  icon,
  onClick,
  mobile = false,
}: {
  testId: string;
  label: string;
  emptyLabel: string;
  icon: React.ReactNode;
  onClick: (anchor: HTMLElement) => void;
  /** `05-ui-ux.md` §9: touch targets are at least 44 x 44 px on Android. The 28 px
      desktop row cannot hold one, so the mobile bar is 44 px tall and the slot fills
      it. M7 found the desktop-sized targets by measuring them on the device. */
  mobile?: boolean;
}): React.ReactElement {
  const empty = label === emptyLabel;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`${empty ? 'Choose' : 'Change'} ${testId === 'status-folder' ? 'folder' : 'tags'}`}
      onClick={(event) => {
        onClick(event.currentTarget);
      }}
      className={`flex min-w-0 items-center gap-[5px] rounded transition-colors hover:bg-[var(--surface-sunken)] ${
        mobile ? 'h-11 max-w-[45%] px-2' : 'px-1'
      } ${empty ? 'text-[var(--text-subtle)]' : ''}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
