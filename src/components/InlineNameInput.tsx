import { useEffect, useRef } from 'react';

/* The inline name editor for creating and renaming a folder (`05-ui-ux.md`
   §6.3): "a single text input in place, Enter commits, Esc cancels, empty input
   cancels."

   Not a dialog, and that is the point. A modal interrupts the thing the user is
   doing — principle 1 of `01-product.md` — to ask for one word. The input sits on
   the row it is replacing and disappears on commit.

   Two details that are easy to get wrong:

   - **Empty means cancel, not an error.** §6.3 says so explicitly, and it is the
     right behaviour: a user who opened the editor and thought better of it should
     not have to press `Esc` as well as clear the field.
   - **The input takes focus and selects its contents on mount.** `Enter` commits
     whatever is typed, and selecting the existing name on rename means typing
     replaces it rather than appending to it. */

type InlineNameInputProps = {
  value: string;
  placeholder: string;
  /** `VALIDATION` from the backend, or null. Shown without stealing focus, so the
      user can keep editing rather than restart (§8, "Keep editing"). */
  error?: string | null;
  label: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

export function InlineNameInput({
  value,
  placeholder,
  error = null,
  label,
  onChange,
  onCommit,
  onCancel,
}: InlineNameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, []);

  return (
    <div className="px-[6px] py-[3px]">
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        data-testid="folder-name-input"
        placeholder={placeholder}
        value={value}
        aria-invalid={error !== null}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommit();
            return;
          }
          if (event.key === 'Escape') {
            /* Stop the key reaching the tree, whose `ArrowLeft` and `Enter`
               bindings would otherwise act on the row underneath. */
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        /* Losing focus commits rather than cancels: a user who clicks away has
           still named the thing, and cancelling their work because they reached
           for something else is worse than committing a name they typed. */
        onBlur={() => {
          onCommit();
        }}
        className={`h-[26px] w-full rounded-[var(--r-input)] border bg-[var(--surface)] px-[6px] text-[13px] text-[var(--text)] outline-none ${
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