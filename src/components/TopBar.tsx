import type { RefObject } from 'react';
import { FilePlus, Menu, MoreHorizontal, Search, Sun, X } from 'lucide-react';
import { IconButton } from './IconButton';

/* `05-ui-ux.md` §4. Search field, new note, theme toggle, overflow menu;
   variant `mobile` for the Android list view. Metrics are copied from the
   prototype: 52 px tall, 140 px brand, 32 px search field capped at 460 px. */

type TopBarProps = {
  variant?: 'desktop' | 'mobile';
  searchValue: string;
  /** The field is owned by the shell, because `Ctrl/Cmd+F` must focus it from
      anywhere in the app (§7) and a shell-held ref is the only way to do that
      without a second owner of the value. */
  inputRef: RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onNewNote: () => void;
  onToggleTheme: () => void;
  /** Only meaningful where the sidebar can be hidden — the tablet drawer.
      `Ctrl/Cmd+\` covers the desktop collapse (§7). */
  onToggleSidebar: () => void;
  /** `true` in the tablet band, where the sidebar is a drawer. */
  showSidebarToggle?: boolean;
  onOpenOverflow: () => void;
};

export function TopBar({
  variant = 'desktop',
  searchValue,
  inputRef,
  onSearchChange,
  onNewNote,
  onToggleTheme,
  onToggleSidebar,
  showSidebarToggle = false,
  onOpenOverflow,
}: TopBarProps) {
  if (variant === 'mobile') {
    return (
      <header className="flex h-[52px] flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2">
        <IconButton label="Open sidebar" onClick={onToggleSidebar} size="mobile">
          <Menu className="icon i-24" aria-hidden="true" />
        </IconButton>
        <span className="flex-1 text-[15px] font-semibold tracking-[-0.01em]">Chayote</span>
        <IconButton label="New note" onClick={onNewNote} size="mobile">
          <FilePlus className="icon i-24" aria-hidden="true" />
        </IconButton>
      </header>
    );
  }

  return (
    <header className="flex h-[52px] flex-none items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4">
      {/* `05-ui-ux.md` §2.3 puts a toggle in the top bar for the tablet drawer.
          The prototype's desktop bar has no such control, so it is rendered only
          in the tablet band: on desktop the sidebar is always shown, and a button
          whose only effect would be to hide something that must be visible is a
          control that changes nothing. `Ctrl/Cmd+\` (§7) covers desktop. */}
      {showSidebarToggle ? (
        <IconButton label="Toggle sidebar" onClick={onToggleSidebar}>
          <Menu className="icon i-20" aria-hidden="true" />
        </IconButton>
      ) : null}

      <span className="w-[120px] text-[14px] font-semibold tracking-[-0.01em]">Chayote</span>

      <div className="flex h-8 max-w-[460px] flex-1 items-center gap-2 rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface-raised)] px-[10px] text-[13px] text-[var(--text-subtle)] focus-within:border-[var(--border-strong)]">
        <Search className="icon i-16" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search notes"
          placeholder="Search notes…"
          value={searchValue}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
        />
        {searchValue.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onSearchChange('');
            }}
            className="text-[var(--text-subtle)] hover:text-[var(--text)]"
          >
            <X className="icon i-16" aria-hidden="true" />
          </button>
        ) : (
          <kbd className="ml-auto rounded border border-[var(--border-strong)] bg-[var(--surface)] px-[5px] py-[2px] text-[10px] text-[var(--text-subtle)]">
            Ctrl F
          </kbd>
        )}
      </div>

      <div className="flex-1" />

      <IconButton label="New note" onClick={onNewNote}>
        <FilePlus className="icon i-20" aria-hidden="true" />
      </IconButton>
      <IconButton label="Toggle theme" onClick={onToggleTheme}>
        <Sun className="icon i-20" aria-hidden="true" />
      </IconButton>
      <IconButton label="More" onClick={onOpenOverflow}>
        <MoreHorizontal className="icon i-20" aria-hidden="true" />
      </IconButton>
    </header>
  );
}