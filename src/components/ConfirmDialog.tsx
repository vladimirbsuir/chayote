import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';

/* Destructive confirmation only — permanent delete, empty trash, deleting a
   folder that has children (`05-ui-ux.md` §4). Never for save or navigation:
   those must not stop to ask a question the user did not initiate.

   The three focus obligations of `05-ui-ux.md` §10 live in `useDialogFocus`,
   shared with `SettingsDialog`. Two copies of a focus trap is how one of them
   ends up missing its `Esc`, and §6.3 records the same shape of mistake for the
   folder delete. */

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
  const { panelRef, onKeyDown } = useDialogFocus(onCancel);

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
        /* Dialog copy is chrome, not content: read, never copied. */
        className="w-full max-w-[420px] overflow-hidden rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)] select-none"
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