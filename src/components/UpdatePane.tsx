import { Download, RotateCw } from 'lucide-react';
import type { AppInfo, UpdateSummary } from '../types/update';

export type UpdatePaneProps = {
  info: AppInfo | undefined;
  isChecking: boolean;
  update: UpdateSummary | null;
  hasChecked: boolean;
  checkError: string | null;
  checkErrorCode: string | null;
  isInstalling: boolean;
  installed: boolean;
  downloaded: number;
  total: number | null;
  installError: string | null;
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
  installed,
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
  const percent =
    total !== null && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div className="flex flex-col gap-[18px]" data-testid="update-pane">
      <div>
        <span
          id="settings-version-label"
          className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]"
        >
          Version
        </span>
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
          <RotateCw className="icon i-16" aria-hidden="true" />
          {isChecking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {info !== undefined && !supported ? (
        <p className="text-[12px] text-[var(--text-subtle)]" data-testid="update-unsupported">
          {unsupportedReason(info.os)}
        </p>
      ) : null}

      {checkError !== null ? (
        <p
          className="text-[12px] text-[var(--danger)]"
          role="alert"
          data-testid="update-check-error"
        >
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
          {installError !== null ? (
            <p
              className={`text-[12px] ${
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
              {isInstalling ? 'Installing…' : installLabel(info?.os ?? '')}
            </button>
          </div>
        </div>
      ) : null}

      {isInstalling ? (
        <DownloadProgress downloaded={downloaded} percent={percent} total={total} />
      ) : null}

      {installed && !isInstalling && installError === null ? (
        <p
          className="text-[12px] text-[var(--text-muted)]"
          role="status"
          data-testid="update-installed"
        >
          {installedReason(info?.os ?? '')}
        </p>
      ) : null}

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
        {percent === null ? `Downloading… ${formatBytes(downloaded)}` : `Downloading… ${percent}%`}
      </p>
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
        {total === null
          ? 'The size was not reported.'
          : `${formatBytes(downloaded)} of ${formatBytes(total)}`}
      </p>
    </div>
  );
}

function checkFailure(code: string | null, message: string): string {
  return code === 'NETWORK'
    ? 'Could not check for updates. Check your connection and try again.'
    : message;
}

function installFailure(code: string | null, message: string, os: string): string {
  if (code === 'UPDATE_PERMISSION_REQUIRED') {
    return (
      permissionRequiredReason(os) ??
      'This platform has not been allowed to install the update yet.'
    );
  }
  if (code === 'NETWORK') {
    return 'Could not download the update. Check your connection and try again.';
  }
  return message;
}

function unsupportedReason(os: string): string {
  if (os === 'macOS') {
    return 'macOS builds are not code-signed, so Chayote cannot replace itself. Download a new version from the releases page.';
  }
  return 'Automatic updates are not available on this platform.';
}

function permissionRequiredReason(os: string): string | null {
  return os === 'Android'
    ? 'Android will not let Chayote install updates until you allow it. Tap Install update again after saying yes on the next screen.'
    : null;
}

function installLabel(os: string): string {
  return os === 'Android' ? 'Install update' : 'Install and restart';
}

function installedReason(os: string): string {
  return os === 'Android'
    ? 'Android is installing the update and will close Chayote when it is done; open it again from the home screen. If Android asked first and you said no, tap Install update again.'
    : 'The update is installed. Chayote is restarting.';
}

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
