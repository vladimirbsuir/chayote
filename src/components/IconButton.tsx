import type { ReactNode, Ref } from 'react';

type IconButtonProps = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'desktop' | 'mobile';
  type?: 'button' | 'submit';
  ref?: Ref<HTMLButtonElement>;
  expanded?: boolean;
  hasPopup?: 'menu' | 'listbox' | 'dialog' | 'true' | 'false';
  children: ReactNode;
};

const HIT_AREA: Record<'desktop' | 'mobile', string> = {
  desktop: 'w-8 h-8',
  mobile: 'w-11 h-11',
};

const VARIANT: Record<NonNullable<IconButtonProps['variant']>, string> = {
  default: 'text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]',
  primary: 'bg-[var(--accent)] border-[var(--accent)] text-white',
  ghost: 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border-strong)]',
  danger: 'bg-[var(--surface)] text-[var(--danger)] border-[var(--border-strong)]',
};

export function IconButton({
  label,
  onClick,
  disabled = false,
  pressed,
  variant = 'default',
  size = 'desktop',
  type = 'button',
  ref,
  expanded,
  hasPopup,
  children,
}: IconButtonProps) {
  return (
    <button
      type={type}
      ref={ref}
      aria-label={label}
      title={label}
      aria-haspopup={hasPopup === undefined ? undefined : hasPopup}
      aria-expanded={expanded}
      onClick={onClick}
      disabled={disabled}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className={`grid place-items-center rounded-[var(--r-input)] border border-transparent disabled:cursor-not-allowed disabled:opacity-40 ${HIT_AREA[size]} ${VARIANT[variant]}`}
    >
      {children}
    </button>
  );
}
