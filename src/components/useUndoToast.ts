import { useCallback, useEffect, useRef, useState } from 'react';

/* The undo toast of `05-ui-ux.md` §6.2: "Delete moves the note to trash with an
   undo toast for 6 seconds offering 'Undo'. The soft delete is already persisted;
   undo simply restores."

   Kept apart from the component so the fast-refresh rule holds — a module that both
   exports a hook and a component makes every change to one of them reload the
   editor — and because the timer is the interesting part and deserves to be testable
   without a DOM.

   Three details that are the difference between a toast that works and one that does
   not:

   - **The six seconds are counted from the delete, not from a re-render**, and a new
     delete replaces the timer rather than adding a second one. Two toasts at once
     means two timers racing to restore whichever note each was pointed at.

   - **Undo and expiry both go through one `dismiss`**, so a timer cannot survive the
     toast it belongs to and restore a note the user has stopped thinking about.

   - **Nothing moves focus.** The user is typing when this appears and must keep being
     able to; a toast that stole focus would break the keystroke in progress. */

export const UNDO_WINDOW_MS = 6000;

export type UndoToast = {
  noteId: string;
  /** The note's name at the moment it was deleted, so the toast reads sensibly even
      after the list has re-sorted and the row is gone. */
  title: string;
  undo: () => void;
  dismiss: () => void;
};

export function useUndoToast(): {
  toast: UndoToast | null;
  show: (noteId: string, title: string, undo: () => void) => void;
  dismiss: () => void;
} {
  const [toast, setToast] = useState<Omit<UndoToast, 'dismiss'> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /* The timer is dropped on unmount. A toast that outlived the shell would call
     `setToast` on nothing and, worse, hold the user's note id after they closed the
     window. */
  useEffect(() => clear, [clear]);

  const dismiss = useCallback((): void => {
    clear();
    setToast(null);
  }, [clear]);

  const show = useCallback(
    (noteId: string, title: string, undo: () => void): void => {
      /* Replaces whatever was there: the previous timer and its toast, rather than a
         second one stacked on top. */
      clear();
      setToast({
        noteId,
        title,
        /* Wrapped rather than passed through, so Undo and the six seconds reach the
           same `dismiss`. Passing the raw callback would leave the timer running
           against a toast that undo had already taken off the screen — and the next
           delete would then clear a timer belonging to the previous one. */
        undo: () => {
          dismiss();
          undo();
        },
      });
      timer.current = setTimeout(() => {
        timer.current = null;
        setToast(null);
      }, UNDO_WINDOW_MS);
    },
    [clear, dismiss],
  );

  return { toast: toast === null ? null : { ...toast, dismiss }, show, dismiss };
}