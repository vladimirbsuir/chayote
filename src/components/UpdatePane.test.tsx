import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdatePane } from './UpdatePane';
import type { UpdatePaneProps } from './UpdatePane';
import type { AppInfo, UpdateSummary } from '../types/update';

/* The Updates tab's states are the whole of ADR-024's user-visible promise:
   a check the user starts, an answer only after the check ran, an install only
   when something is newer, and a disabled button with a reason on a platform
   that cannot update. Each of those is a screen, and a screen no test can reach
   is a screen that does not exist.

   Plain Testing Library assertions, no `jest-dom` — this project does not take
   that dependency, so `toHaveTextContent` and `toBeDisabled` are spelled out. */

const WINDOWS: AppInfo = { version: '0.1.0', os: 'Windows', updatesSupported: true };
const MACOS: AppInfo = { version: '0.1.0', os: 'macOS', updatesSupported: false };
const ANDROID: AppInfo = { version: '0.1.0', os: 'Android', updatesSupported: false };

const FOUND: UpdateSummary = {
  version: '0.2.0',
  notes: 'Faster search, and the Updates tab.',
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
    downloaded: 0,
    total: null,
    installError: null,
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
    expect(text('update-version')).toContain('Chayote 0.1.0');
    /* Before a check has run the tab knows nothing about updates, so it says
       nothing. "Up to date" here would be a claim about a version it has not
       looked up. */
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
    /* The silent check runs once at launch and records when it looked. It reports
       nothing into the tab, so a tab opened afterwards knows *when* but not
       *what* — and must not turn that into "up to date". */
    render(<UpdatePane {...pane({ hasChecked: false, lastCheckedAt: 1_780_000_000_000 })} />);
    expect(screen.queryByTestId('update-current')).toBeNull();
    expect(screen.queryByTestId('update-available')).toBeNull();
    expect(screen.getByTestId('update-last-checked')).toBeDefined();
  });

  it('offers the install only when a check found something newer', () => {
    render(<UpdatePane {...pane({ update: FOUND, lastCheckedAt: 1_780_000_000_000 })} />);
    expect(text('update-available')).toContain('Version 0.2.0 is available.');
    expect(text('update-available')).toContain(FOUND.notes);
    expect(screen.queryByTestId('update-current')).toBeNull();
    expect(text('update-install')).toContain('Install and restart');
  });

  it('omits the notes block rather than rendering an empty one', () => {
    render(<UpdatePane {...pane({ update: { ...FOUND, notes: '   ' } })} />);
    const available = screen.getByTestId('update-available');
    expect(available.textContent).toContain('Version 0.2.0 is available.');
    /* Two paragraphs would be the headline and an empty one. */
    expect(available.querySelectorAll('p')).toHaveLength(1);
  });

  it('renders notes as text, never as markup from the release manifest', () => {
    const hostile = { ...FOUND, notes: '<img src=x onerror="alert(1)"><b>bold</b>' };
    const { container } = render(<UpdatePane {...pane({ update: hostile })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(text('update-available')).toContain('<img src=x onerror="alert(1)">');
  });

  it('disables the check and says why on a platform that cannot update', () => {
    const onCheck = vi.fn(() => Promise.resolve(null));
    const { rerender } = render(<UpdatePane {...pane({ info: MACOS, onCheck })} />);
    expect(isDisabled('update-check')).toBe(true);
    fireEvent.click(screen.getByTestId('update-check'));
    expect(onCheck).not.toHaveBeenCalled();
    expect(text('update-unsupported')).toContain('macOS');
    expect(text('update-unsupported')).toContain('not code-signed');
    /* The reason replaces the result line rather than sitting beside it. */
    expect(screen.queryByTestId('update-current')).toBeNull();
    rerender(<UpdatePane {...pane({ info: ANDROID, onCheck })} />);
    expect(text('update-unsupported')).toContain('Android');
    expect(text('update-unsupported')).toContain('cannot install updates');
  });

  it('falls back to a general reason on a platform it has no words for', () => {
    const unknown: AppInfo = { version: '0.1.0', os: 'Unknown', updatesSupported: false };
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
    /* The contract's own sentence names the sync server, which an update check
       never touches — so the tab replaces it rather than showing it. */
    expect(screen.getByRole('alert').textContent).not.toContain('sync server');
    /* A failed check says nothing about being current. */
    expect(screen.queryByTestId('update-current')).toBeNull();
  });

  it('passes any other error message through unchanged', () => {
    render(
      <UpdatePane
        {...pane({ checkError: 'There is no update waiting to be installed.', checkErrorCode: 'VALIDATION' })}
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
    /* No progressbar: announcing a range the server never gave would be a bar
       measuring nothing. The bytes travelled are still reported. */
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