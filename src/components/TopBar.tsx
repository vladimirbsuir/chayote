import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { FilePlus, Menu, MoreHorizontal, Search, Settings as SettingsIcon, X } from 'lucide-react';
import { IconButton } from './IconButton';
import { ThemeIcon } from './ThemeToggle';

/* `05-ui-ux.md` §4. Search field, new note, theme toggle, overflow menu;
   variant `mobile` for the Android list view. Metrics are copied from the
   prototype: 52 px tall, 140 px brand, 32 px search field capped at 460 px,
   and the mobile field's own 40 px row at 12 px inset. */

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
  /** The theme in effect, so the button's icon shows what is on screen rather
      than what a press would change it to. */
  theme: 'light' | 'dark';
  /** Only meaningful where the sidebar can be hidden — the tablet drawer.
      `Ctrl/Cmd+\` covers the desktop collapse (§7). Absent on mobile, where the
      list *is* the sidebar and there is nothing to toggle. */
  onToggleSidebar?: () => void;
  /** `true` in the tablet band, where the sidebar is a drawer. */
  showSidebarToggle?: boolean;
  /** Desktop/tablet: opens the overflow menu whose Settings item opens the
      dialog. Mobile: opens the settings dialog directly — the bar has no room
      for an overflow menu, so the gear is the button itself. */
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

  /* The overflow menu is a popover over the bar, so it dismisses the three ways
     a popover does in the rest of the app (`05-ui-ux.md` §6.2, §6.4): `Esc`, a
     click outside, and the trigger again. Listening on the document rather than
     on the bar means a click anywhere in the app closes it, which is what a user
     who has just changed their mind expects.
     Closing restores focus to the trigger, because a menu that leaves focus on
     the body strands a keyboard user — the next `Tab` would restart from the top
     of the page. */
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
  /* §6.5: "Esc clears and restores the previous list". It does not blur — someone
     who dismissed one query to type a different one would lose the caret, and
     moving focus out of the field is a change the key did not ask for. */
  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onSearchChange('');
  };

  if (variant === 'mobile') {
    /* The left slot was a `menu` "Open sidebar" button wired to a no-op: on the
       single-pane list view the sidebar content *is* the view, so there was
       nothing to open and the control only looked tappable. It now opens the
       settings dialog directly — a gear, not a hamburger, since it never opened
       a navigation drawer — which also closes the gap where mobile had no path
       to Settings at all. Theme stays inside the dialog; the bar has no room
       for a second control. */
    return (
      <>
        <header className="flex h-[52px] flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2">
          <IconButton label="Open settings" onClick={onOpenOverflow} size="mobile">
            <SettingsIcon className="icon i-24" aria-hidden="true" />
          </IconButton>
          <span className="flex-1 text-[15px] font-semibold tracking-[-0.01em]">Chayote</span>
          <IconButton label="New note" onClick={onNewNote} size="mobile">
            <FilePlus className="icon i-24" aria-hidden="true" />
          </IconButton>
        </header>
        {/* The prototype's mobile list view carries its own field under the bar
            rather than a field inside it: at 360 px the bar's two controls and
            a usable field do not fit on one row, and §9's reason for not putting
            the desktop bar on this view at all applies to the field with it. */}
        <div className="mx-3 mt-3 flex h-10 flex-none items-center gap-2 rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[14px] text-[var(--text-subtle)] focus-within:border-[var(--border-strong)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]">
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
            className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
          />
          {searchValue.length > 0 ? <ClearButton onClear={() => { onSearchChange(''); }} /> : null}
        </div>
      </>
    );
  }

  return (
    <header className="flex h-[52px] flex-none items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4">
      {/* `05-ui-ux.md` §2.3 puts a toggle in the top bar for the tablet drawer.
          The prototype's desktop bar has no such control, so it is rendered only
          in the tablet band: on desktop the sidebar is always shown, and a button
          whose only effect would be to hide something that must be visible is a
          control that changes nothing. `Ctrl/Cmd+\` (§7) covers desktop. */}
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
          className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
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
      {/* `05-ui-ux.md` §4 gives the top bar an overflow menu and §6.6 puts the
          settings dialog behind the `settings` icon. The trigger is wrapped
          rather than followed by an absolutely-positioned sibling so the menu
          can be dismissed by clicking the trigger again. */}
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
            className="absolute right-0 top-[36px] z-40 w-[200px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-[var(--shadow-pop)]"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="topbar-overflow-settings"
              onClick={() => {
                setOpen(false);
                /* Focus moves to the trigger *before* the settings dialog
                   mounts. `useDialogFocus` captures `document.activeElement` as
                   the element to return to on close, and the menu item — which
                   is what currently has focus — is about to unmount. Returning
                   focus to a removed element is the "nowhere to return to" case
                   its own comment warns about, and the symptom is focus landing
                   on the body, so the next `Tab` restarts at the top of the
                   page. */
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
