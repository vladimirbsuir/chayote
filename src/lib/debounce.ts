export type Debounced<A extends unknown[]> = {
  (...args: A): void;
  /** Run the pending call now, if there is one. */
  flush: () => void;
  /** Drop the pending call. Nothing is lost if `flush` already ran. */
  cancel: () => void;
};

/**
 * A trailing-edge debounce that can be flushed and cancelled.
 *
 * `04-editor.md` §5.1 requires the autosave to fire 800 ms after the last
 * keystroke, and to fire *immediately* on a note switch, a blur, a window close,
 * or app background. Those four are the reason `flush` exists: without it, a
 * pending save would be lost exactly when the app is about to disappear.
 *
 * Only the most recent arguments are kept, which is what makes a typing burst
 * one call rather than one per keystroke.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: A | null = null;

  const invoke = (): void => {
    const args = queued;
    timer = null;
    queued = null;
    if (args !== null) fn(...args);
  };

  const debounced = (...args: A): void => {
    queued = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, delayMs);
  };

  debounced.flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    invoke();
  };

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queued = null;
  };

  return debounced;
}