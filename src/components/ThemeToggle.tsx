import { Monitor, Moon, Sun } from 'lucide-react';
import type { Theme } from '../lib/settings';

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