export type Debounced<A extends unknown[]> = {
  (...args: A): void;
  flush: () => void;
  cancel: () => void;
};

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