import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, RotateCw } from 'lucide-react';
import type { SyncConflict, SyncStatus, SyncSummary } from '../types/sync';

/* The Sync tab of the settings dialog: connection string, enable switch,
   manual trigger, status, and the conflict resolver. Every field here, like
   the rest of the dialog, applies through commands rather than a submit —
   except the connection string itself, which is secret text the user may
   still be editing, so it saves on an explicit Save. */

type SyncPaneProps = {
  status: SyncStatus | undefined;
  statusPending: boolean;
  conflicts: SyncConflict[] | undefined;
  syncing: boolean;
  saving: boolean;
  saveError: string | null;
  lastResult: SyncSummary | null;
  reuploading: boolean;
  lastReupload: number | null;
  onSaveConfig: (connectionString: string, enabled: boolean) => Promise<void>;
  onSyncNow: () => Promise<SyncSummary>;
  onReupload: () => Promise<number>;
  onResolve: (id: string, keepLocal: boolean) => Promise<void>;
};

export function SyncPane({
  status,
  statusPending,
  conflicts,
  syncing,
  saving,
  saveError,
  lastResult,
  reuploading,
  lastReupload,
  onSaveConfig,
  onSyncNow,
  onReupload,
  onResolve,
}: SyncPaneProps) {
  const [draft, setDraft] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  /* Status lines and the re-upload recovery live collapsed: the tab stays
     short enough for a phone screen, and the error (if any) stays visible
     outside. Content stays mounted while collapsed so status polls keep
     working and tests keep reading it. */
  const [detailsOpen, setDetailsOpen] = useState(false);

  /* The secret is write-only: the status says *whether* one is stored, never
     the value. An empty field therefore means "keep the stored string" and
     only the switch is saved — the Rust side treats empty as no-change. */
  const configured = status !== undefined && status.configured;
  const switchOn = enabled ?? (status !== undefined && status.enabled);

  const errorText = actionError ?? saveError ?? status?.lastError ?? null;

  const save = async (): Promise<void> => {
    setActionError(null);
    try {
      await onSaveConfig(draft, switchOn);
      setDraft('');
      setEnabled(null);
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  const syncNow = async (): Promise<void> => {
    setActionError(null);
    try {
      await onSyncNow();
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  const reupload = async (): Promise<void> => {
    setActionError(null);
    try {
      await onReupload();
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  const resolve = async (id: string, keepLocal: boolean): Promise<void> => {
    setActionError(null);
    setResolvingId(id);
    try {
      await onResolve(id, keepLocal);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-[18px]" data-testid="sync-pane">
      <div>
        <label
          htmlFor="sync-connection"
          className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]"
        >
          Connection string
        </label>
        <div className="flex items-center gap-2">
          <input
            id="sync-connection"
            type={revealed ? 'text' : 'password'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={configured ? 'Saved — type to replace' : 'postgresql://…'}
            aria-label="Postgres connection string"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            className="min-w-0 flex-1 rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-2 font-mono text-[12px] text-[var(--text)]"
          />
          <button
            type="button"
            onClick={() => {
              setRevealed((value) => !value);
            }}
            aria-pressed={revealed}
            className="flex-none rounded-[var(--r-input)] border border-[var(--border-strong)] px-3 py-2 text-[13px] font-medium text-[var(--text-muted)]"
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--text-subtle)]">
          Any Postgres server works. The string stays on this device.
        </p>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-[var(--text)]">
        <input
          type="checkbox"
          checked={switchOn}
          onChange={(event) => {
            setEnabled(event.target.checked);
          }}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Enable sync
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="sync-save"
          disabled={saving}
          onClick={() => {
            void save();
          }}
          className="flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {/* Static label while saving: swapping the text resizes the button
              and the whole tab twitches. Progress shows as dimmed; failures
              show in red below. */}
          Save
        </button>
        <button
          type="button"
          data-testid="sync-now"
          disabled={syncing || !configured || !switchOn}
          onClick={() => {
            void syncNow();
          }}
          className="flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text)] disabled:opacity-50"
        >
          <RotateCw className="icon i-16" aria-hidden="true" />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {errorText !== null ? (
        <p className="text-[12px] text-[var(--danger)]" role="alert" data-testid="sync-error">
          {errorText}
        </p>
      ) : null}

      <div className="border-t border-[var(--border)] pt-2">
        <button
          type="button"
          data-testid="sync-details-toggle"
          aria-expanded={detailsOpen}
          aria-controls="sync-details"
          onClick={() => {
            setDetailsOpen((value) => !value);
          }}
          className="flex min-h-11 w-full items-center gap-1 text-left text-[12px] font-medium text-[var(--text-muted)]"
        >
          <ChevronDown
            className={`icon i-16 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          Status & advanced
        </button>
        <div
          id="sync-details"
          data-testid="sync-details"
          className={detailsOpen ? 'flex flex-col gap-[18px] pt-2' : 'hidden'}
        >
          <div
            aria-live="polite"
            className="text-[12px] text-[var(--text-subtle)]"
            data-testid="sync-status"
          >
            {statusPending ? (
              'Loading sync status…'
            ) : status === undefined ? (
              'Sync status unavailable.'
            ) : (
              <SyncStatusLines status={status} lastResult={lastResult} />
            )}
          </div>

          {/* Recovery, not routine: after a server wipe the device holds clean
              rows against stale watermarks, and a sync would push nothing and
              pull nothing. This re-queues the whole library so the next sync
              uploads it again. Idempotent — running it twice changes nothing
              the second time. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="sync-reupload"
                disabled={reuploading || !configured}
                onClick={() => {
                  void reupload();
                }}
                className="flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text)] disabled:opacity-50"
              >
                Re-upload everything
              </button>
            </div>
            <p className="text-[12px] text-[var(--text-subtle)]">
              Pushes everything again. Only needed after wiping the server.
            </p>
            {lastReupload !== null ? (
              <p
                className="text-[12px] text-[var(--text-muted)]"
                data-testid="sync-reupload-status"
              >
                {lastReupload} {lastReupload === 1 ? 'row' : 'rows'} queued — press Sync now to
                upload.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <ConflictsBlock
        conflicts={conflicts ?? []}
        resolvingId={resolvingId}
        onResolve={(id, keepLocal) => {
          void resolve(id, keepLocal);
        }}
      />
    </div>
  );
}

function SyncStatusLines({
  status,
  lastResult,
}: {
  status: SyncStatus;
  lastResult: SyncSummary | null;
}): React.ReactNode {
  const last =
    status.lastSyncedAt === null ? 'never' : new Date(status.lastSyncedAt).toLocaleString();
  const attempt =
    status.lastAttemptAt === null ? null : new Date(status.lastAttemptAt).toLocaleString();
  return (
    <ul className="flex flex-col gap-1">
      <li>
        {status.configured ? 'Configured' : 'Not configured'}
        {' · '}
        {status.enabled ? 'enabled' : 'disabled'}
      </li>
      <li>Last synced: {last}</li>
      {attempt !== null && status.lastAttemptAt !== status.lastSyncedAt ? (
        <li>Last attempt: {attempt}</li>
      ) : null}
      <li>Pending rows: {status.pendingCount}</li>
      {lastResult !== null && !lastResult.alreadyRunning ? (
        <li className="text-[var(--text-muted)]">
          Pushed {lastResult.pushed} · pulled {lastResult.pulled}
          {lastResult.deferred > 0
            ? ` · ${lastResult.deferred} deferred for the open note — it syncs next time`
            : null}
        </li>
      ) : null}
      {lastResult?.alreadyRunning === true ? <li>A sync is already running.</li> : null}
    </ul>
  );
}

function ConflictsBlock({
  conflicts,
  resolvingId,
  onResolve,
}: {
  conflicts: SyncConflict[];
  resolvingId: string | null;
  onResolve: (id: string, keepLocal: boolean) => void;
}): React.ReactNode {
  /* The list lives behind a button in a scrollable pop-up rather than inline:
     with many conflicts the inline cards pushed the settings dialog past the
     screen edge on both phone and desktop. The heading stays visible so the
     badge count is never hidden. */
  const [open, setOpen] = useState(false);
  if (conflicts.length === 0) return null;
  return (
    <div>
      <span className="mb-2 flex items-center gap-1 text-[12px] font-medium text-[var(--text-muted)]">
        <AlertCircle className="icon i-16" aria-hidden="true" />
        Conflicts ({conflicts.length})
      </span>
      <p className="mb-2 text-[12px] text-[var(--text-subtle)]">
        The same note changed on two devices. Your version is live; the other one is parked here
        until you choose.
      </p>
      <button
        type="button"
        data-testid="sync-resolve-open"
        onClick={() => {
          setOpen(true);
        }}
        className="rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text)]"
      >
        Resolve conflicts
      </button>
      {open ? (
        <ConflictsDialog
          conflicts={conflicts}
          resolvingId={resolvingId}
          onResolve={onResolve}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/* A pop-up over the settings dialog: the card caps its height and scrolls the
   list inside, so any number of conflicts fits on a phone screen. `fixed`
   positions against the viewport, so the settings panel's `overflow` never
   clips it even though it renders inside that panel (which keeps the settings
   focus trap wrapping the whole tree). */
function ConflictsDialog({
  conflicts,
  resolvingId,
  onResolve,
  onClose,
}: {
  conflicts: SyncConflict[];
  resolvingId: string | null;
  onResolve: (id: string, keepLocal: boolean) => void;
  onClose: () => void;
}): React.ReactNode {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 pb-[max(1.5rem,var(--inset-bottom))]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Resolve conflicts"
        data-testid="sync-conflicts-dialog"
        onKeyDown={(event) => {
          /* Esc closes this pop-up only: without stopping propagation the
             settings panel's own Esc handler would close settings behind it. */
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        className="flex max-h-[70dvh] w-full max-w-[380px] flex-col overflow-hidden rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)]"
      >
        <div className="flex flex-none items-center gap-2 px-4 pt-4">
          <span className="flex text-[var(--text-muted)]">
            <AlertCircle className="icon i-16" aria-hidden="true" />
          </span>
          <h3 className="flex-1 text-[13px] font-semibold text-[var(--text)]">
            Resolve conflicts ({conflicts.length})
          </h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close conflict resolver"
            onClick={onClose}
            className="rounded-[var(--r-input)] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-muted)]"
          >
            Close
          </button>
        </div>
        <ul className="flex flex-col gap-2 overflow-y-auto px-4 py-3">
          {conflicts.map((conflict) => {
            const title = conflict.noteTitle.length > 0 ? conflict.noteTitle : 'Untitled';
            const remote = conflict.remoteTitle.length > 0 ? conflict.remoteTitle : 'Untitled';
            const busy = resolvingId === conflict.id;
            return (
              <li
                key={conflict.id}
                data-testid="sync-conflict"
                className="rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface-raised)] p-3"
              >
                <p className="text-[13px] font-medium text-[var(--text)]">{title}</p>
                <p className="mt-0.5 text-[12px] text-[var(--text-subtle)]">
                  Other version: {remote}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onResolve(conflict.id, true);
                    }}
                    className="rounded-[var(--r-input)] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--text)] disabled:opacity-50"
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onResolve(conflict.id, false);
                    }}
                    className="rounded-[var(--r-input)] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--text)] disabled:opacity-50"
                  >
                    Use theirs
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* `AppError` arrives as `{ code, message }`; anything else is a bug shaped
   like a string. The message is user-facing copy by contract (R7). */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Something went wrong.';
}
