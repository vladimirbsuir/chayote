import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

type NoteHeaderProps = {
  title: string;
  updatedAt: number | null;
  onChange: (title: string) => void;
  onCommit: () => void;
  onEnter?: () => void;
  variant?: 'desktop' | 'mobile';
};

export function NoteHeader({
  title,
  updatedAt,
  onChange,
  onCommit,
  onEnter,
  variant = 'desktop',
}: NoteHeaderProps): React.ReactElement {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = 'auto';
    if (input.scrollHeight > 0) input.style.height = `${input.scrollHeight}px`;
  }, [title]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (onEnter === undefined) {
      onCommit();
      return;
    }
    onEnter();
  };

  const mobile = variant === 'mobile';

  return (
    <div
      className={`mx-auto w-full max-w-[var(--editor-measure)] flex-none ${
        mobile ? 'mb-4' : 'mb-6'
      }`}
      data-testid="note-header"
    >
      <label className="sr-only" htmlFor="note-title-input">
        Note title
      </label>
      <textarea
        id="note-title-input"
        ref={inputRef}
        data-testid="note-title-input"
        aria-label="Note title"
        rows={1}
        value={title}
        placeholder="Title"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={onCommit}
        className={`block w-full resize-none overflow-y-auto border-0 bg-transparent p-0 font-semibold text-[var(--text)] outline-none select-text placeholder:text-[var(--text-subtle)] ${
          mobile ? 'text-[24px] leading-[1.25]' : 'text-[28px] leading-[1.2]'
        }`}
      />
      {updatedAt === null ? null : (
        <p data-testid="note-updated-at" className="mt-1.5 text-[12px] text-[var(--text-subtle)]">
          {new Date(updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
