import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdatePane } from './UpdatePane';
import type { UpdatePaneProps } from './UpdatePane';
import type { AppInfo, UpdateSummary } from '../types/update';

const WINDOWS: AppInfo = { version: '0.2.1', os: 'Windows', updatesSupported: true };
const MACOS: AppInfo = { version: '0.2.1', os: 'macOS', updatesSupported: false };
const ANDROID: AppInfo = { version: '0.2.1', os: 'Android', updatesSupported: true };

const FOUND: UpdateSummary = {
  version: '0.3.0',
  date: '2026-10-17T09:00:00Z',
};

function pane(overrides: Partial<UpdatePaneProps> = {}): UpdatePaneProps {
  return {
    info: WINDOWS,
    isChecking: false,
    update: null,
    hasChecked: false,
    checkError: null,
    checkErrorCode: null,
    isInstalling: false,
    installed: false,
    downloaded: 0,
    total: null,
    installError: null,
    installErrorCode: null,
    lastCheckedAt: null,
    onCheck: () => Promise.resolve(null),
    onInstall: () => Promise.resolve(),
    ...overrides,
  };
}

function text(testId: string): string {
  return screen.getByTestId(testId).textContent;
}

function isDisabled(testId: string): boolean {
  return screen.getByTestId<HTMLButtonElement>(testId).disabled;
}

describe('UpdatePane', () => {
  it('shows the running version, and never a claim about anything else', () => {
    render(<UpdatePane {...pane()} />);
    expect(text('update-version')).toContain('Chayote 0.2.1');
    expect(screen.queryByTestId('update-current')).toBeNull();
    expect(screen.queryByTestId('update-available')).toBeNull();
    expect(screen.queryByTestId('update-last-checked')).toBeNull();
  });

  it('checks only when pressed — nothing happens on its own', () => {
    const onCheck = vi.fn(() => Promise.resolve(null));
    render(<UpdatePane {...pane({ onCheck })} />);
    expect(onCheck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('update-check'));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('says up to date only after this tab’s own check came back empty', () => {
    render(<UpdatePane {...pane({ hasChecked: true, lastCheckedAt: 1_780_000_000_000 })} />);
    expect(text('update-current')).toContain('Chayote is up to date.');
    expect(screen.getByTestId('update-last-checked')).toBeDefined();
  });

  it('does not inherit the daily tick’s result, only its timestamp', () => {
    render(<UpdatePane {...pane({ hasChecked: false, lastCheckedAt: 1_780_000_000_000 })} />);
    expect(screen.queryByTestId('update-current')).toBeNull();
    expect(screen.queryByTestId('update-available')).toBeNull();
    expect(screen.getByTestId('update-last-checked')).toBeDefined();
  });

  it('offers the install only when a check found something newer', () => {
    render(<UpdatePane {...pane({ update: FOUND, lastCheckedAt: 1_780_000_000_000 })} />);
    expect(text('update-available')).toContain('Version 0.3.0 is available.');
    expect(screen.queryByTestId('update-current')).toBeNull();
    expect(text('update-install')).toContain('Install and restart');
  });

  it('disables the check and says why on a platform that cannot update', () => {
    const onCheck = vi.fn(() => Promise.resolve(null));
    const { rerender } = render(<UpdatePane {...pane({ info: MACOS, onCheck })} />);
    expect(isDisabled('update-check')).toBe(true);
    fireEvent.click(screen.getByTestId('update-check'));
    expect(onCheck).not.toHaveBeenCalled();
    expect(text('update-unsupported')).toContain('macOS');
    expect(text('update-unsupported')).toContain('not code-signed');
    expect(screen.queryByTestId('update-current')).toBeNull();
    rerender(<UpdatePane {...pane({ info: ANDROID, onCheck })} />);
    expect(isDisabled('update-check')).toBe(false);
    expect(screen.queryByTestId('update-unsupported')).toBeNull();
  });

  it('words Android’s outstanding grant as something to do, not as a failure', () => {
    render(
      <UpdatePane
        {...pane({
          info: ANDROID,
          update: FOUND,
          installError: 'Android has not been allowed to install updates for Chayote yet.',
          installErrorCode: 'UPDATE_PERMISSION_REQUIRED',
        })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('will not let Chayote install updates until you allow it');
    expect(alert.textContent).not.toContain('the sync server');
    expect(isDisabled('update-install')).toBe(false);
    expect(alert.className).toContain('var(--warning)');
    expect(alert.className).not.toContain('var(--danger)');
  });

  it('paints every other install error as a failure', () => {
    render(
      <UpdatePane
        {...pane({
          update: FOUND,
          installError: 'The updater manifest could not be fetched.',
          installErrorCode: 'NETWORK',
        })}
      />,
    );
    expect(screen.getByRole('alert').className).toContain('var(--danger)');
  });

  it('words a dropped download as a connection problem, not a sync one', () => {
    render(
      <UpdatePane
        {...pane({
          update: FOUND,
          installError: 'Could not reach the sync server.',
          installErrorCode: 'NETWORK',
        })}
      />,
    );
    const alert = screen.getByRole('alert').textContent;
    expect(alert).toContain('Could not download the update. Check your connection and try again.');
    expect(alert).not.toContain('sync server');
  });

  it('passes any other install error through unchanged', () => {
    render(
      <UpdatePane
        {...pane({
          update: FOUND,
          installError: 'installer reported aborted',
          installErrorCode: 'INTERNAL',
        })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('installer reported aborted');
  });

  it('does not promise a restart on Android, which does not reopen the app', () => {
    render(<UpdatePane {...pane({ info: ANDROID, update: FOUND })} />);
    expect(text('update-install')).toContain('Install update');
    expect(text('update-install')).not.toContain('restart');
  });

  it('says the install was handed over once Android accepted it', () => {
    render(<UpdatePane {...pane({ info: ANDROID, update: FOUND, installed: true })} />);
    expect(text('update-installed')).toContain('will close Chayote');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(isDisabled('update-install')).toBe(false);
  });

  it('says nothing about a handed-over install while another attempt runs or failed', () => {
    const { rerender } = render(
      <UpdatePane
        {...pane({ info: ANDROID, update: FOUND, installed: true, isInstalling: true })}
      />,
    );
    expect(screen.queryByTestId('update-installed')).toBeNull();
    rerender(
      <UpdatePane
        {...pane({
          info: ANDROID,
          update: FOUND,
          installed: true,
          installError: 'installer reported aborted',
          installErrorCode: 'INTERNAL',
        })}
      />,
    );
    expect(screen.queryByTestId('update-installed')).toBeNull();
  });

  it('falls back to a general reason on a platform it has no words for', () => {
    const unknown: AppInfo = { version: '0.2.1', os: 'Unknown', updatesSupported: false };
    render(<UpdatePane {...pane({ info: unknown })} />);
    expect(text('update-unsupported')).toContain('not available on this platform');
  });

  it('runs one action at a time', () => {
    render(<UpdatePane {...pane({ isChecking: true })} />);
    expect(isDisabled('update-check')).toBe(true);
    expect(text('update-check')).toContain('Checking…');
  });

  it('reports a failed check in the alert role, not as a tint', () => {
    render(
      <UpdatePane
        {...pane({
          checkError: 'Could not reach the sync server.',
          checkErrorCode: 'NETWORK',
          hasChecked: false,
          lastCheckedAt: 1_780_000_000_000,
        })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Check your connection and try again.');
    expect(screen.getByRole('alert').textContent).not.toContain('sync server');
    expect(screen.queryByTestId('update-current')).toBeNull();
  });

  it('passes any other error message through unchanged', () => {
    render(
      <UpdatePane
        {...pane({
          checkError: 'There is no update waiting to be installed.',
          checkErrorCode: 'VALIDATION',
        })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'There is no update waiting to be installed.',
    );
  });

  it('shows a determinate bar while the length is known', () => {
    render(
      <UpdatePane {...pane({ isInstalling: true, downloaded: 6_000_000, total: 15_000_000 })} />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(text('update-progress')).toContain('40%');
    expect(text('update-progress')).toContain('6.0 MB of 15 MB');
  });

  it('drops to bytes when the server reported no length', () => {
    render(<UpdatePane {...pane({ isInstalling: true, downloaded: 2_500_000, total: null })} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(text('update-progress')).toContain('Downloading… 2.5 MB');
    expect(text('update-progress')).toContain('The size was not reported.');
  });

  it('clamps a byte count that overshoots the total rather than showing 140%', () => {
    render(
      <UpdatePane {...pane({ isInstalling: true, downloaded: 16_000_000, total: 15_000_000 })} />,
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('keeps the install button on screen while installing, dimmed rather than gone', () => {
    render(
      <UpdatePane {...pane({ update: FOUND, isInstalling: true, downloaded: 100, total: 200 })} />,
    );
    expect(isDisabled('update-install')).toBe(true);
    expect(text('update-install')).toContain('Installing…');
  });
});
