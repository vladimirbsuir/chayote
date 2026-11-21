import { Folder, Hash, Pin } from 'lucide-react';
import type { SaveState } from '../stores/editor';

type EditorStatusBarProps = {
  wordCount: number;
  saveState: SaveState;
  isPinned: boolean;
  onTogglePin: () => void;
  folderName: string | null;
  tagNames: string[];
  onPickFolder: (anchor: HTMLElement) => void;
  onEditTags: (anchor: HTMLElement) => void;
  variant?: 'desktop' | 'mobile';
};

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
      data-testid="editor-status-bar"
      style={mobile ? { bottom: 'var(--inset-bottom)' } : undefined}
      className={`flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] text-[12px] text-[var(--text-muted)] select-none ${
        mobile ? 'fixed inset-x-0 z-30 h-11 gap-2 px-1' : 'h-7 shrink-0 px-3'
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
