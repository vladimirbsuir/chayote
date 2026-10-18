import { Download, RotateCw } from 'lucide-react';
import type { AppInfo, UpdateSummary } from '../types/update';

/* The Updates tab of the settings dialog: the running version, a check the user
   starts, and — when there is something newer — the install (ADR-024).

   Presentational like `SyncPane`, so the whole tab is drivable in a browser
   through the mock and nothing here reaches for the platform.

   Three rules the rest of the dialog already follows and this one inherits:

   - **Every state is a sentence, not a colour.** A dimmed button and a red line
     are not readable by everyone; `05-ui-ux.md` §10 is explicit that an icon or a
     tint is never the only signal, and that goes for "up to date" too.
   - **One action at a time.** Checking and installing are both network round
     trips against the same manifest, and the second one is destructive to the
     running process.
   - **Nothing is claimed that was not measured.** "Up to date" appears only after
     a check that came back empty, never as the resting state — a tab that says
     so before it has asked is lying about a version it does not know. */

export type UpdatePaneProps = {
  /** `undefined` while `app_info` is in flight, which is the only moment the tab
      renders neither the button nor the reason it is missing. */
  info: AppInfo | undefined;
  isChecking: boolean;
  /** The update the last check found, or `null`. Survives a failed check: an
      update that was real a minute ago is still real. */
  update: UpdateSummary | null;
  /** Whether *this tab's* check completed. `lastCheckedAt` cannot answer this:
      the silent daily tick writes it too, and the tab must not report a result
      it never observed. */
  hasChecked: boolean;
  checkError: string | null;
  /** `null` when `checkError` is also null. `NETWORK` is the code the frontend
      reads as "try again later" (`10-conventions.md` §6), and the tab needs it
      for one reason — see `checkFailure`. */
  checkErrorCode: string | null;
  isInstalling: boolean;
  downloaded: number;
  /** `null` when the server did not send a length, which is the only reason the
      progress bar can be indeterminate rather than absent. */
  total: number | null;
  installError: string | null;
  /** The error contract's `code` for `installError`, which is what tells "the
      update failed" apart from "Android wants a grant first" (ADR-025). */
  installErrorCode: string | null;
  lastCheckedAt: number | null;
  onCheck: () => Promise<unknown>;
  onInstall: () => Promise<void>;
};

export function UpdatePane({
  info,
  isChecking,
  update,
  hasChecked,
  checkError,
  checkErrorCode,
  isInstalling,
  downloaded,
  total,
  installError,
  installErrorCode,
  lastCheckedAt,
  onCheck,
  onInstall,
}: UpdatePaneProps) {
  const supported = info?.updatesSupported === true;
  const busy = isChecking || isInstalling;
  const percent = total !== null && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div className="flex flex-col gap-[18px]" data-testid="update-pane">
      <div>
        <span
          id="settings-version-label"
          className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]"
        >
          Version
        </span>
        {/* The one fact this tab always has. `aria-labelledby` rather than a
            `<label>`: it is a value, not a field, and there is nothing to focus. */}
        <p
          className="text-[13px] text-[var(--text)]"
          aria-labelledby="settings-version-label"
          data-testid="update-version"
        >
          {info === undefined ? '—' : `Chayote ${info.version}`}
        </p>
      </div>

      <div>
        <button
          type="button"
          data-testid="update-check"
          disabled={busy || !supported}
          onClick={() => {
            void onCheck();
          }}
          className="flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text)] disabled:opacity-50"
        >
          {/* `rotate-cw` again, for the same reason Sync now uses it: a check is
              a refresh, and the inventory already carries the glyph. */}
          <RotateCw className="icon i-16" aria-hidden="true" />
          {isChecking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {/* The reason a platform cannot update, in place of a control that would
          only fail. `06-platform.md` §3.8 records why for each one. */}
      {info !== undefined && !supported ? (
        <p className="text-[12px] text-[var(--text-subtle)]" data-testid="update-unsupported">
          {unsupportedReason(info.os)}
        </p>
      ) : null}

      {checkError !== null ? (
        <p className="text-[12px] text-[var(--danger)]" role="alert" data-testid="update-check-error">
          {checkFailure(checkErrorCode, checkError)}
        </p>
      ) : null}

      {isChecking ? (
        <p className="text-[12px] text-[var(--text-muted)]" data-testid="update-checking">
          Checking for a newer version…
        </p>
      ) : null}

      {update !== null && !isChecking ? (
        <div className="flex flex-col gap-[10px]" data-testid="update-available">
          <p className="text-[13px] text-[var(--text)]">Version {update.version} is available.</p>
          {/* Release notes as plain text. `latest.json` carries them as
              untrusted text from a remote file, and the app has no Markdown
              renderer — rendering these as HTML would be the paste-sanitizer
              problem (`04-editor.md` §5) in a place nobody thought to check. */}
          {update.notes.trim().length > 0 ? (
            <p className="whitespace-pre-wrap text-[12px] text-[var(--text-muted)]">
              {update.notes}
            </p>
          ) : null}
          {installError !== null ? (
            <p
              className={`text-[12px] ${
                // ADR-025: the outstanding Android install grant is guidance, not a
                // failure. Painting it with --danger would tell the user something is
                // broken when the fix is a screen they have already been sent to, and
                // the bytes below are verified and waiting.
                installErrorCode === 'UPDATE_PERMISSION_REQUIRED'
                  ? 'text-[var(--warning)]'
                  : 'text-[var(--danger)]'
              }`}
              role="alert"
              data-testid="update-install-error"
            >
              {installFailure(installErrorCode, installError, info?.os ?? '')}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              data-testid="update-install"
              disabled={busy}
              onClick={() => {
                void onInstall();
              }}
              className="flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
            >
              <Download className="icon i-16" aria-hidden="true" />
              {isInstalling ? 'Installing…' : 'Install and restart'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Only while the bytes are moving: the bar is the whole reason the tab
          says something during a 15 MB transfer, and it is gone the moment the
          process is on its way out. */}
      {isInstalling ? (
        <DownloadProgress downloaded={downloaded} percent={percent} total={total} />
      ) : null}

      {/* "Up to date" is a result, never a default — see the note at the top of
          this file. `hasChecked` rather than `lastCheckedAt`: the daily tick
          records that timestamp without reporting anything here, and a tab that
          inherited its conclusion would be claiming a result it never saw. */}
      {!isChecking && hasChecked && update === null && checkError === null ? (
        <p className="text-[12px] text-[var(--text-muted)]" data-testid="update-current">
          Chayote is up to date.
        </p>
      ) : null}

      {lastCheckedAt !== null ? (
        <p className="text-[12px] text-[var(--text-subtle)]" data-testid="update-last-checked">
          Last checked {new Date(lastCheckedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

function DownloadProgress({
  downloaded,
  percent,
  total,
}: {
  downloaded: number;
  percent: number | null;
  total: number | null;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="update-progress">
      <p className="text-[12px] text-[var(--text-muted)]">
        {percent === null
          ? `Downloading… ${formatBytes(downloaded)}`
          : `Downloading… ${percent}%`}
      </p>
      {/* No `role="progressbar"` when the length is unknown: a progressbar with no
          range is a lie a screen reader will happily announce. The percentage is
          in the text above, which is where it is actually available. */}
      {percent !== null ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Download progress"
          className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-raised)]"
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      <p className="text-[12px] text-[var(--text-subtle)]">
        {total === null ? 'The size was not reported.' : `${formatBytes(downloaded)} of ${formatBytes(total)}`}
      </p>
    </div>
  );
}

/** What a failed check says.
    `AppError::Network`'s message is "Could not reach the sync server." — true,
    and about a server this tab has never heard of. An update check talks to
    GitHub, so that sentence would be the one confusing thing on the screen, and
    the code is all the tab needs to know it was the network rather than
    anything else. Every other code passes the contract's own message through. */
function checkFailure(code: string | null, message: string): string {
  return code === 'NETWORK'
    ? 'Could not check for updates. Check your connection and try again.'
    : message;
}

/** What a failed install says.
    `UPDATE_PERMISSION_REQUIRED` is the one code that gets a sentence of its own,
    and it is also the one that must not be styled as a failure: nothing has gone
    wrong, the platform is waiting for a grant, and the Install button is still
    the right thing to press. Everything else is the contract's own message. */
function installFailure(code: string | null, message: string, os: string): string {
  if (code === 'UPDATE_PERMISSION_REQUIRED') {
    return (
      permissionRequiredReason(os) ??
      'This platform has not been allowed to install the update yet.'
    );
  }
  return message;
}

/** Why this platform cannot update, in its own words rather than a shrug. Every
    branch is a documented fact (`06-platform.md` §3.8); the fallback exists for a
    platform this build has never heard of, where the honest sentence is the
    general one. Android is not here any more — it updates itself as of ADR-025. */
function unsupportedReason(os: string): string {
  if (os === 'macOS') {
    return 'macOS builds are not code-signed, so Chayote cannot replace itself. Download a new version from the releases page.';
  }
  return 'Automatic updates are not available on this platform.';
}

/** What Android shows once the install has been refused for want of a grant.
    `UPDATE_PERMISSION_REQUIRED` is not a failure: the bytes are verified and
    still on disk, so the next press installs them. Saying "try again" alone
    would leave the user pressing a button that cannot work, because the grant
    lives in system settings and there is no prompt for it. */
function permissionRequiredReason(os: string): string | null {
  return os === 'Android'
    ? 'Android will not let Chayote install updates until you allow it. Tap Install and restart again after saying yes on the next screen.'
    : null;
}

/** Binary units, because that is what a download is measured in. One decimal
    under 10 MB and none above: the extra digit is noise once the number is
    three digits wide. */
function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}