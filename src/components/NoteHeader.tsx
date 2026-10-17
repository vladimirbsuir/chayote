import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

/* ADR-023: the note's heading block — the title field and, under it, when the
   note was last changed.

   The title used to be the document's first heading, which put the note's name
   inside its body and made it something you type by accident: a heading is a
   block, it carries `H1`/`H2` semantics into an outline, and it is in the way of
   the text. It is a field now, and it is the only place in the editor where the
   note's own name is edited.

   **It is a textarea, not an input.** A title is capped at 120 characters
   (`03-data-model.md` §4.1), which is three or four lines at this size, and an
   `<input>` scrolls sideways past the first line instead of wrapping — the text
   you are editing runs off the edge of the screen. It grows to fit and stops
   growing past the cap, which is where scrolling belongs.

   `Enter` moves to the body rather than inserting a line break: a title is one
   line of text, and a newline inside one is the kind of thing that has to be
   cleaned up later. `Shift+Enter` is left alone for the same reason the body
   keeps its shortcuts. */

type NoteHeaderProps = {
  title: string;
  /** `updated_at` in ms, or null while the note has no saved state yet — the
      line is omitted rather than showing a placeholder date. */
  updatedAt: number | null;
  onChange: (title: string) => void;
  /** Leaving the field commits what was typed. */
  onCommit: () => void;
  /** `Enter` hands over to the body. Separate from `onCommit` because blur and
      Enter are not the same gesture: one of them means "I am done here" and the
      other means "and now I am writing". */
  onEnter?: () => void;
  /** `05-ui-ux.md` §2.4: the mobile variant is taller and inside the pane's
      padding, the desktop one is flush with the editor column. */
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

  /* Grow to the text, up to the cap. Measured rather than counted in lines
     because a title mixes scripts: "Напишите что-нибудь" and a German noun
     compound do not occupy the same number of lines, and `rows` cannot know
     that. `scrollHeight` is 0 under jsdom, which leaves the height to CSS and
     keeps this out of the unit tests' way. */
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
      /* The same 720 px column as the editor below it (`05-ui-ux.md` §2.5), or the
         title would sit against the pane's left edge while the body was centred
         inside it — a step across the screen that reads as a mistake, not as an
         indent. What separates them is the space above, not a shift sideways. */
      className={`mx-auto w-full max-w-[var(--editor-measure)] flex-none ${
        mobile ? 'px-5 pt-4 pb-1' : 'px-8 pt-9 pb-0'
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
        /* Long titles wrap to the cap and then scroll rather than growing without
           end — four lines of heading is already more than the body it introduces.
           The field is text the user types, so it is selectable even though every
           other piece of editor chrome is not (§9). */
        className={`block w-full resize-none overflow-y-auto border-0 bg-transparent p-0 font-semibold text-[var(--text)] outline-none select-text placeholder:text-[var(--text-subtle)] ${
          mobile ? 'text-[24px] leading-[1.25]' : 'text-[28px] leading-[1.2]'
        }`}
      />
      {updatedAt === null ? null : (
        /* When it was last changed, in the reader's own format: a note written in
           a language and a country does not read well in someone else's. The
           machine's locale is the only honest answer for a local-first app with
           no account and no settings for it. */
        <p
          data-testid="note-updated-at"
          className={`mt-1.5 text-[12px] text-[var(--text-subtle)] ${mobile ? 'mb-1' : 'mb-6'}`}
        >
          {new Date(updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
