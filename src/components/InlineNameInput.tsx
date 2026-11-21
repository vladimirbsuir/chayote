import { useEffect, useRef } from 'react';

type InlineNameInputProps = {
  value: string;
  placeholder: string;
  error?: string | null;
  label: string;
  testId?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

export function InlineNameInput({
  value,
  placeholder,
  error = null,
  label,
  testId = 'folder-name-input',
  onChange,
  onCommit,
  onCancel,
}: InlineNameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const committedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, []);

  const commitOnce = (): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit();
  };

  return (
    <div className="px-[6px] py-[3px]">
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        data-testid={testId}
        placeholder={placeholder}
        value={value}
        aria-invalid={error !== null}
        onChange={(event) => {
          committedRef.current = false;
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitOnce();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => {
          commitOnce();
        }}
        className={`h-[26px] w-full rounded-[var(--r-input)] border bg-[var(--surface)] px-[6px] text-[13px] text-[var(--text)] outline-none select-text ${
          error === null ? 'border-[var(--border-strong)]' : 'border-[var(--danger)]'
        }`}
      />
      {error !== null ? (
        <p role="alert" className="px-[6px] pt-1 text-[11px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}