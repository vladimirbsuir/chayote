import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

/* Destructive confirmation only — permanent delete, empty trash, deleting a
   folder that has children (`05-ui-ux.md` §4). Never for save or navigation:
   those must not stop to ask a question the user did not initiate.

   `05-ui-ux.md` §10 sets three obligations and all three are about focus:
   opening moves focus in and traps it, `Esc` closes, and closing restores focus
   to whatever opened it. The trigger element is captured on open for exactly the
   last one — a dialog that unmounts the thing that opened it has nowhere to
   return to, which is the usual way this goes wrong. */

type ConfirmDialogProps = {
  title: string;
  /** States the consequence and, where there is one, the count. */
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

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

  const accent = tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--warning)]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-sunken)_70%,transparent)] p-6"
      onMouseDown={(event) => {
        /* A click on the scrim dismisses; a click *inside* the panel must not,
           and `mousedown` is the only event that can tell them apart before the
           panel has handled its own. */
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        onKeyDown={onKeyDown}
        className="w-full max-w-[420px] overflow-hidden rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)]"
      >
        {/* No close button: `Esc` and a scrim click both dismiss, and the two
            buttons at the foot are the whole of the decision. The prototype's
            dialog has no close affordance either, and adding a third way out is
            a control that changes nothing. */}
        <div className="flex items-center gap-2 px-5 pt-[18px]">
          <span className={`flex ${accent}`}>
            <AlertCircle className="icon i-20" aria-hidden="true" />
          </span>
          <h2 id="confirm-dialog-title" className="text-[15px] font-semibold">
            {title}
          </h2>
        </div>

        <div className="px-5 py-4">
          <p id="confirm-dialog-body" className="text-[13px] leading-[1.5] text-[var(--text-muted)]">
            {body}
          </p>
          {children}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-raised)] px-5 py-[14px]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className={`rounded-[var(--r-input)] border px-4 py-2 text-[13px] font-medium ${
              tone === 'danger'
                ? 'border-[var(--danger)] bg-[var(--danger)] text-white'
                : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--warning)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}