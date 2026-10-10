import { Monitor, Moon, Sun } from 'lucide-react';
import type { Theme } from '../lib/settings';

/* `05-ui-ux.md` §6.6 gives the theme three values and one control; §4 names
   `ThemeToggle` as the Light / Dark / System cycle, and §3.3 puts `sun`, `moon`
   and `monitor` in the inventory for exactly these three. The cycle order and
   the labels live in `lib/theme.ts`, because a button in the top bar, a
   shortcut from anywhere and this control in the dialog all have to agree.

   The top-bar icon shows the theme **in effect**, not the one a press would
   switch to. "System" is not knowable from `theme` alone: it resolves against
   the OS, so the button is given the resolved value for the icon and keeps the
   stored value for the cycle. Without that, a user on System-dark would see a
   sun and no way to tell whether pressing it means light or dark. */

/** The icon for the theme being shown. `effective` is what the user sees, which
    for `system` is whatever the OS asked for. */
export function ThemeIcon({
  effective,
  className,
}: {
  effective: 'light' | 'dark';
  className: string;
}) {
  if (effective === 'dark') return <Moon className={className} aria-hidden="true" />;
  return <Sun className={className} aria-hidden="true" />;
}

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: 'light', label: 'Light', icon: <Sun className="icon i-16" aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="icon i-16" aria-hidden="true" /> },
  { value: 'system', label: 'System', icon: <Monitor className="icon i-16" aria-hidden="true" /> },
];

type ThemeToggleProps = {
  value: Theme;
  onChange: (theme: Theme) => void;
};

/** The settings dialog's control. A segmented control rather than a select or a
    switch, because all three states are worth naming: `system` is a real choice
    and not a synonym for "whatever is on now". `role="radiogroup"` rather than
    `tablist` — the prototype drew tabs, but nothing here moves between panels,
    and a radiogroup is what a set of exclusive choices is. Arrow keys move and
    select, which is the pattern's own behaviour rather than three handlers. */
export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  const move = (step: number): void => {
    const index = OPTIONS.findIndex((option) => option.value === value);
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    if (next !== undefined) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex w-[260px] max-w-full rounded-[var(--r-input)] bg-[var(--surface-sunken)] p-0.5"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
            className={`flex flex-1 items-center justify-center gap-[5px] rounded-[4px] py-1.5 text-[12px] font-medium transition-colors ${
              selected
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'bg-transparent text-[var(--text-muted)]'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}