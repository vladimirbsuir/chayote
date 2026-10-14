import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SyncPane } from './SyncPane';
import { Sidebar } from './Sidebar';
import { SettingsDialog } from './SettingsDialog';
import type { SyncConflict, SyncStatus } from '../types/sync';
import type { FolderNode } from '../types/folder';

/* Sync tab: connection string, enable switch, manual trigger, status and
   the conflict resolver. The secret is write-only — the UI never reads it
   back — so the field is empty unless the user is typing. */

const UNCONFIGURED: SyncStatus = {
  configured: false,
  enabled: false,
  pendingCount: 0,
  conflictCount: 0,
  lastSyncedAt: null,
  lastAttemptAt: null,
  lastError: null,
};

const CONFIGURED: SyncStatus = {
  configured: true,
  enabled: true,
  pendingCount: 3,
  conflictCount: 0,
  lastSyncedAt: 1_700_000_000_000,
  lastAttemptAt: 1_700_000_000_000,
  lastError: null,
};

const CONFLICT: SyncConflict = {
  id: 'c-1',
  noteId: 'n-1',
  noteTitle: 'Shopping',
  localRev: 4,
  remoteRev: 7,
  remoteTitle: 'Shopping list',
  createdAt: 1_700_000_000_000,
};

function pane(overrides: Partial<React.ComponentProps<typeof SyncPane>> = {}) {
  const onSaveConfig = vi.fn(() => Promise.resolve());
  const onSyncNow = vi.fn(() =>
    Promise.resolve({ pushed: 1, pulled: 2, conflicts: 0, deferred: 0, alreadyRunning: false }),
  );
  const onReupload = vi.fn(() => Promise.resolve(7));
  const onResolve = vi.fn(() => Promise.resolve());
  render(
    <SyncPane
      status={UNCONFIGURED}
      statusPending={false}
      conflicts={[]}
      syncing={false}
      saving={false}
      saveError={null}
      lastResult={null}
      reuploading={false}
      lastReupload={null}
      onSaveConfig={onSaveConfig}
      onSyncNow={onSyncNow}
      onReupload={onReupload}
      onResolve={onResolve}
      {...overrides}
    />,
  );
  return { onSaveConfig, onSyncNow, onReupload, onResolve };
}

describe('SyncPane', () => {
  it('renders the connection field, the switch and both buttons', () => {
    pane();
    expect(screen.getByLabelText('Postgres connection string')).toBeDefined();
    expect(screen.getByText('Enable sync')).toBeDefined();
    expect(screen.getByTestId('sync-save')).toBeDefined();
    expect(screen.getByTestId('sync-now')).toBeDefined();
  });

  it('shows a placeholder when a secret is stored, without revealing it', () => {
    pane({ status: CONFIGURED });
    const field = screen.getByLabelText<HTMLInputElement>('Postgres connection string');
    expect(field.value).toBe('');
    expect(field.placeholder).toContain('Saved');
  });

  it('disables Sync now until sync is configured and enabled', () => {
    pane({ status: UNCONFIGURED });
    expect(screen.getByTestId<HTMLButtonElement>('sync-now').disabled).toBe(true);
    pane({ status: { ...CONFIGURED, enabled: false } });
    const buttons = screen.getAllByTestId('sync-now');
    const last = buttons[buttons.length - 1];
    if (!(last instanceof HTMLButtonElement)) throw new Error('expected a sync button');
    expect(last.disabled).toBe(true);
  });

  it('saves the typed string with the switch and reports status afterwards', async () => {
    const { onSaveConfig } = pane({ status: { ...CONFIGURED, enabled: false } });
    fireEvent.change(screen.getByLabelText('Postgres connection string'), {
      target: { value: 'postgresql://x' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('sync-save'));
    await waitFor(() => {
      expect(onSaveConfig).toHaveBeenCalledWith('postgresql://x', true);
    });
    expect(screen.getByTestId('sync-status').textContent).toContain('Pending rows: 3');
  });

  it('shows a rejected save message without closing the tab', async () => {
    const onSaveConfig = vi.fn(() =>
      Promise.reject(new Error('That does not look like a Postgres connection string.')),
    );
    pane({ status: UNCONFIGURED, onSaveConfig });
    fireEvent.click(screen.getByTestId('sync-save'));
    await waitFor(() => {
      expect(screen.getByTestId('sync-error').textContent).toContain('Postgres connection string');
    });
    expect(onSaveConfig).toHaveBeenCalledWith('', false);
  });

  it('runs a manual sync and reports what it did', async () => {
    const { onSyncNow } = pane({ status: CONFIGURED });
    fireEvent.click(screen.getByTestId('sync-now'));
    await waitFor(() => {
      expect(onSyncNow).toHaveBeenCalled();
    });
  });

  it('lists conflicts with a choice per note', async () => {
    const { onResolve } = pane({ status: CONFIGURED, conflicts: [CONFLICT] });
    expect(screen.getByTestId('sync-conflict').textContent).toContain('Shopping');
    fireEvent.click(screen.getByText('Keep mine'));
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('c-1', true);
    });
    fireEvent.click(screen.getByText('Use theirs'));
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('c-1', false);
    });
  });

  it('renders no conflict section when there are none', () => {
    pane({ status: CONFIGURED, conflicts: [] });
    expect(screen.queryByTestId('sync-conflict')).toBeNull();
  });

  it('names deferred changes for the open note without blocking', () => {
    pane({
      status: CONFIGURED,
      lastResult: { pushed: 1, pulled: 0, conflicts: 0, deferred: 1, alreadyRunning: false },
    });
    expect(screen.getByTestId('sync-status').textContent).toContain('1 deferred for the open note');
  });

  it('re-uploads on demand and names what was queued', async () => {
    const { onReupload } = pane({ status: CONFIGURED });
    fireEvent.click(screen.getByTestId('sync-reupload'));
    await waitFor(() => {
      expect(onReupload).toHaveBeenCalled();
    });
  });

  it('reports the last re-upload count where the user can read it', () => {
    pane({ status: CONFIGURED, lastReupload: 7 });
    expect(screen.getByTestId('sync-reupload-status').textContent).toContain('7 rows queued');
  });

  it('disables re-upload until a string is stored', () => {
    pane({ status: UNCONFIGURED });
    expect(screen.getByTestId<HTMLButtonElement>('sync-reupload').disabled).toBe(true);
  });
});

const FOLDERS: FolderNode[] = [];

function dialog(tab: 'general' | 'sync') {
  render(
    <SettingsDialog
      theme="light"
      effective="light"
      accent={null}
      lastCustomHex="#2f6fed"
      defaultFolderId={null}
      folders={FOLDERS}
      onThemeChange={() => {}}
      onAccentChange={() => {}}
      onDefaultFolderChange={() => {}}
      onClose={() => {}}
      confirmReset={null}
      initialTab={tab}
      sync={{
        status: UNCONFIGURED,
        statusPending: false,
        conflicts: [],
        syncing: false,
        saving: false,
        saveError: null,
        lastResult: null,
        reuploading: false,
        lastReupload: null,
        onSaveConfig: () => Promise.resolve(),
        onSyncNow: () =>
          Promise.resolve({ pushed: 0, pulled: 0, conflicts: 0, deferred: 0, alreadyRunning: false }),
        onReupload: () => Promise.resolve(0),
        onResolve: () => Promise.resolve(),
      }}
    />,
  );
}

describe('SettingsDialog tabs', () => {
  it('opens on general by default, with the sync pane absent', () => {
    dialog('general');
    expect(screen.getByRole('tab', { name: 'general' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('sync-pane')).toBeNull();
  });

  it('switches to the sync tab on click', () => {
    dialog('general');
    fireEvent.click(screen.getByRole('tab', { name: 'sync' }));
    expect(screen.getByTestId('sync-pane')).toBeDefined();
    expect(screen.getByRole('tab', { name: 'sync' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens on sync directly when asked, for the conflict badge', () => {
    dialog('sync');
    expect(screen.getByTestId('sync-pane')).toBeDefined();
  });
});

describe('sidebar conflict badge', () => {
  const noWrite = (): Promise<void> => Promise.resolve();

  function badge(count: number | undefined, onOpenConflicts: () => void) {
    render(
      <Sidebar
        selection={{ kind: 'all' }}
        width={320}
        folders={[]}
        tags={[]}
        notes={[]}
        search={null}
        onClearSearch={() => {}}
        isPending={false}
        now={Date.now()}
        folderNames={new Map()}
        folderCounts={new Map()}
        collapsedFolders={[]}
        openNoteId={null}
        firstLaunch={false}
        onSelect={() => {}}
        onOpenNote={() => {}}
        onNewNote={() => {}}
        onToggleFolder={() => {}}
        onCreateFolder={noWrite}
        onRenameFolder={noWrite}
        onDeleteFolder={noWrite}
        onMoveFolder={noWrite}
        onCreateTag={noWrite}
        onRenameTag={noWrite}
        onDeleteTag={noWrite}
        conflictCount={count}
        onOpenConflicts={onOpenConflicts}
      />,
    );
  }

  it('is absent without conflicts and announces the count with them', () => {
    badge(0, () => {});
    expect(screen.queryByTestId('sync-conflict-badge')).toBeNull();
  });

  it('opens the sync tab on click, without touching the list', () => {
    const onOpenConflicts = vi.fn();
    badge(2, onOpenConflicts);
    const found = screen.getByTestId('sync-conflict-badge');
    expect(found.textContent).toContain('2 notes');
    fireEvent.click(found);
    expect(onOpenConflicts).toHaveBeenCalled();
  });
});
