import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/* `05-ui-ux.md` §10 gives every dialog three obligations, and all three are about
   focus: opening moves focus in and traps it, `Esc` closes, and closing restores
   focus to whatever opened it.

   This is a hook rather than a `<Dialog>` component because the two dialogs in
   the app do not share a layout — `ConfirmDialog` is a title, a paragraph and two
   buttons; `SettingsDialog` is a header, a body of controls and a footer, and its
   scrim is not a dismiss target. A shared component would have been reshaped
   until it fit both, and the trap would have been reshaped with it. The trap
   itself is the part that must not differ, so it is the part that is shared. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogFocus = {
  panelRef: RefObject<HTMLDivElement | null>;
  /** Spread onto the dialog panel. Handles `Esc` and the `Tab` wrap. */
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

/** `onCancel` is what `Esc` calls. A dialog that must not close on `Esc` — none
    in v1 — would pass a no-op and get the trap without the dismiss. */
export function useDialogFocus(onCancel: () => void): DialogFocus {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  /* Capture the trigger before the dialog renders, because opening a modal moves
     focus and the element that had it is the only way back. */
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

  /* `Esc` while focus is still outside the panel — the trap's `onKeyDown` only
     fires for keystrokes inside it, so an `Escape` pressed in the frame between
     open and focus-in would otherwise do nothing (one CI flake). Bubble-phase,
     so the panel's own handler runs first: if it already claimed the keystroke
     (`preventDefault`), this skips. Targets inside the panel are left to the
     trap, which owns `Tab` and picker-nested `Escape` handling. */
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

      /* A modal has to keep focus inside itself, or `Tab` walks behind it into
         the editor — where the next keystroke would type into a note the user
         thinks is not being edited. Wrapping at both ends is the whole trap: it
         works whatever the tab order inside the panel happens to be, and it does
         not need the panel's contents to be known here. */
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
