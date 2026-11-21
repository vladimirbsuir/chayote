import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { FilePlus, Menu, MoreHorizontal, Search, Settings as SettingsIcon, X } from 'lucide-react';
import { IconButton } from './IconButton';
import { ThemeIcon } from './ThemeToggle';

type TopBarProps = {
  variant?: 'desktop' | 'mobile';
  searchValue: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onNewNote: () => void;
  onToggleTheme: () => void;
  theme: 'light' | 'dark';
  onToggleSidebar?: () => void;
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
  theme,
  onToggleSidebar,
  showSidebarToggle = false,
  onOpenOverflow,
}: TopBarProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onSearchChange('');
  };

  if (variant === 'mobile') {
    return (
      <>
        <header className="flex h-[52px] flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2 select-none">
          <IconButton label="Open settings" onClick={onOpenOverflow} size="mobile">
            <SettingsIcon className="icon i-24" aria-hidden="true" />
          </IconButton>
          <span className="flex-1 text-[15px] font-semibold tracking-[-0.01em]">Chayote</span>
          <IconButton label="New note" onClick={onNewNote} size="mobile">
            <FilePlus className="icon i-24" aria-hidden="true" />
          </IconButton>
        </header>
        <div className="relative mx-3 mt-3 flex h-10 flex-none items-center gap-2 rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[14px] text-[var(--text-subtle)] focus-within:z-10 focus-within:border-[var(--border-strong)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]">
          <Search className="icon i-18" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search notes"
            placeholder="Search notes…"
            value={searchValue}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            onKeyDown={onFieldKeyDown}
            className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none select-text placeholder:text-[var(--text-subtle)]"
          />
          {searchValue.length > 0 ? <ClearButton onClear={() => { onSearchChange(''); }} /> : null}
        </div>
      </>
    );
  }

  return (
    <header className="flex h-[52px] flex-none items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 select-none">
      {showSidebarToggle && onToggleSidebar ? (
        <IconButton label="Toggle sidebar" onClick={onToggleSidebar}>
          <Menu className="icon i-20" aria-hidden="true" />
        </IconButton>
      ) : null}

      <span className="w-[120px] text-[14px] font-semibold tracking-[-0.01em]">Chayote</span>

      <div className="flex h-8 max-w-[460px] flex-1 items-center gap-2 rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface-raised)] px-[10px] text-[13px] text-[var(--text-subtle)] focus-within:border-[var(--border-strong)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]">
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
          onKeyDown={onFieldKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none select-text placeholder:text-[var(--text-subtle)]"
        />
        {searchValue.length > 0 ? (
          <ClearButton onClear={() => { onSearchChange(''); }} />
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
      <IconButton label="Change theme" onClick={onToggleTheme}>
        <ThemeIcon effective={theme} className="icon i-20" />
      </IconButton>
      <div className="relative" ref={wrapRef}>
        <IconButton
          ref={triggerRef}
          label="More"
          hasPopup="menu"
          expanded={open}
          onClick={() => {
            setOpen((wasOpen) => !wasOpen);
          }}
        >
          <MoreHorizontal className="icon i-20" aria-hidden="true" />
        </IconButton>
        {open ? (
          <div
            role="menu"
            data-testid="topbar-overflow"
            className="absolute right-0 top-[36px] z-40 w-[200px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-[var(--shadow-pop)] select-none"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="topbar-overflow-settings"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                onOpenOverflow();
              }}
              className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface)]"
            >
              <SettingsIcon className="icon i-16 text-[var(--text-muted)]" aria-hidden="true" />
              Settings
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label="Clear search"
      data-testid="clear-search"
      onClick={onClear}
      className="text-[var(--text-subtle)] hover:text-[var(--text)]"
    >
      <X className="icon i-16" aria-hidden="true" />
    </button>
  );
}
