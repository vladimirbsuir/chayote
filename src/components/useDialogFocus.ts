import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogFocus = {
  panelRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

export function useDialogFocus(onCancel: () => void): DialogFocus {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  useEffect(() => {
    triggerRef.current = document.activeElement;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, []);

  useEffect(
    () => () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    },
    [],
  );

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      cancelRef.current();
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  return { panelRef, onKeyDown };
}
