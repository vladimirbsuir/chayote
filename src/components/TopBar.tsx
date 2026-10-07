import { FilePlus, Menu, MoreHorizontal, Search, Sun, X } from 'lucide-react';
import { IconButton } from './IconButton';

type TopBarProps = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchFocus: () => void;
  onNewNote: () => void;
  onToggleTheme: () => void;
  onOpenOverflow: () => void;
  variant?: 'desktop' | 'mobile';
};

export function TopBar({
  searchValue,
  onSearchChange,
  onSearchFocus,
  onNewNote,
  onToggleTheme,
  onOpenOverflow,
  variant = 'desktop',
}: TopBarProps) {
  if (variant === 'mobile') {
    return (
      <header className="flex h-[52px] flex-none items-center gap-2 border-b border-[var(--border)] px-2">
        <button
          type="button"
          aria-label="Open sidebar"
          className="grid h-11 w-11 place-items-center rounded-[var(--r-input)] text-[var(--text-muted)]"
        >
          <Menu className="icon i-24" aria-hidden="true" />
        </button>
        <span className="flex-1 text-[15px] font-semibold tracking-[-0.01em]">Chayote</span>
        <IconButton label="New note" onClick={onNewNote} size="mobile">
          <FilePlus className="icon i-24" aria-hidden="true" />
        </IconButton>
      </header>
    );
  }

  return (
    <header className="flex h-[52px] flex-none items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <span className="w-[140px] text-[14px] font-semibold tracking-[-0.01em]">Chayote</span>

      <div className="flex h-8 max-w-[460px] flex-1 items-center gap-2 rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface-raised)] px-[10px] text-[13px] text-[var(--text-subtle)] focus-within:border-[var(--border-strong)]">
        <Search className="icon i-16" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search notes"
          placeholder="Search notes…"
          value={searchValue}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          onFocus={onSearchFocus}
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
          <kbd className="ml-auto rounded border border-[var(--border-strong)] bg-[var(--surface)] px-[5px] py-[2px] text-[10px] font-[var(--mono)] text-[var(--text-subtle)]">
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
