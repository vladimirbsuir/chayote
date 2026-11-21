import { X } from 'lucide-react';
import type { UndoToast as UndoToastModel } from './useUndoToast';

export function UndoToast({ toast }: { toast: UndoToastModel }): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      className="pointer-events-auto flex items-center gap-3 rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-[10px] text-[13px] shadow-[var(--shadow-pop)] select-none"
    >
      <span className="truncate text-[var(--text-muted)]">“{toast.title}” moved to trash</span>
      <button
        type="button"
        data-testid="undo-toast-undo"
        onClick={toast.undo}
        className="shrink-0 rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1 text-[13px] font-medium text-[var(--text)]"
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        data-testid="undo-toast-dismiss"
        onClick={toast.dismiss}
        className="shrink-0 text-[var(--text-subtle)] hover:text-[var(--text)]"
      >
        <X className="icon i-16" aria-hidden="true" />
      </button>
    </div>
  );
}