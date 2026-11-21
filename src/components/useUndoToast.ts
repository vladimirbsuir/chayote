import { useCallback, useEffect, useRef, useState } from 'react';

export const UNDO_WINDOW_MS = 6000;

export type UndoToast = {
  noteId: string;
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

  useEffect(() => clear, [clear]);

  const dismiss = useCallback((): void => {
    clear();
    setToast(null);
  }, [clear]);

  const show = useCallback(
    (noteId: string, title: string, undo: () => void): void => {
      clear();
      setToast({
        noteId,
        title,
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