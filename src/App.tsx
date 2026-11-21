import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  foldersApi,
  installBackHandler,
  notesApi,
  onWindowCloseRequested,
  syncApi,
  tagsApi,
  windowApi,
} from './lib/ipc';
import { isInsideSubtree } from './components/folderRows';
import { useNow, useNotes } from './hooks/useNotes';
import { useSearch } from './hooks/useSearch';
import { countByFolder, folderNamesById, useFolders } from './hooks/useFolders';
import { useTags } from './hooks/useTags';
import { useTogglePin } from './hooks/useTogglePin';
import { useTrashActions } from './hooks/useTrashActions';
import {
  useAutoSync,
  useReupload,
  useResolveConflict,
  useSyncConflicts,
  useSyncNow,
  useSyncStatus,
} from './hooks/useSync';
import {
  useAppInfo,
  useCheckForUpdate,
  useDailyUpdateCheck,
  useInstallUpdate,
} from './hooks/useUpdates';
import type { SettingsTab } from './components/SettingsDialog';
import type { SyncSummary } from './types/sync';
import { UndoToast } from './components/UndoToast';
import { useUndoToast } from './components/useUndoToast';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SettingsDialog } from './components/SettingsDialog';
import {
  openNote as setOpenNote,
  select as setSelection,
  selectionKey,
  useSelectionStore,
} from './stores/selection';
import {
  applyAccent,
  flushSettings,
  flushSettingsAsync,
  hydrateSettings,
  resolveTheme,
  useSettingsStore,
} from './stores/settings';
import { TopBar } from './components/TopBar';
import { nextVisibleTheme } from './lib/theme';
import { isLetterShortcut } from './lib/shortcuts';
import { flushEditorsForSync } from './lib/syncFlush';
import { Sidebar } from './components/Sidebar';
import { DesktopLayout, MobileLayout, TabletLayout } from './layout/DesktopLayout';
import { useBreakpoint } from './layout/useBreakpoint';
import { canPop, currentView, popView, pushView } from './layout/viewStack';
import type { ViewStack } from './layout/viewStack';
import type { Uuid } from './types/note';
import type { NoteSummary } from './types/ipc';

const EditorPane = lazy(() =>
  import('./components/EditorPane').then((module) => ({ default: module.EditorPane })),
);

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => {
      setDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  return dark;
}

function Shell() {
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const breakpoint = useBreakpoint();
  const systemDark = useSystemDark();

  const selection = useSelectionStore((state) => state.selection);
  const openNoteId = useSelectionStore((state) => state.openNoteId);

  const theme = useSettingsStore((state) => resolveTheme(state.theme, systemDark));
  const themeSetting = useSettingsStore((state) => state.theme);
  const accent = useSettingsStore((state) => state.accent);
  const lastCustomHex = useSettingsStore((state) => state.lastCustomHex);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const collapsedFolders = useSettingsStore((state) => state.collapsedFolders);
  const sectionsCollapsed = useSettingsStore((state) => state.sectionsCollapsed);
  const defaultFolderId = useSettingsStore((state) => state.defaultFolderId);

  const [stack, setStack] = useState<ViewStack>({ stack: ['list'] });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const mobile = breakpoint === 'mobile';
  const tablet = breakpoint === 'tablet';

  const { notes, isPending, refetch } = useNotes(selection);
  const results = useSearch(query, selection);

  const listNotes = results.active ? results.hits : (notes ?? EMPTY_NOTES);
  const searchSummary = results.active ? { query: results.applied, total: results.total } : null;

  const { folders } = useFolders();
  const { tags } = useTags();
  const { togglePin, pendingId: pinPendingId } = useTogglePin();
  const { toast: undoToast, show: showUndoToast } = useUndoToast();

  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (actionErrorTimer.current !== null) clearTimeout(actionErrorTimer.current);
    };
  }, []);
  const showActionError = useCallback((message: string): void => {
    if (actionErrorTimer.current !== null) clearTimeout(actionErrorTimer.current);
    setActionError(message);
    actionErrorTimer.current = setTimeout(() => {
      actionErrorTimer.current = null;
      setActionError(null);
    }, 6000);
  }, []);
  const reportActionError = useCallback(
    (error: unknown): void => {
      showActionError(messageOf(error));
    },
    [showActionError],
  );

  const trash = useTrashActions({
    onOpenNoteGone: (goneId) => {
      if (goneId === null || goneId === useSelectionStore.getState().openNoteId) {
        setOpenNote(null);
        if (mobile) setStack(popView);
      }
    },
    onRestored: (id) => {
      setOpenNote(id);
    },
  });

  const softDeleteWithToast = useCallback(
    (id: Uuid): void => {
      const note = listNotes.find((candidate) => candidate.id === id);
      const title = note === undefined || note.title.length === 0 ? 'Untitled' : note.title;
      trash
        .softDelete(id)
        .then(() => {
          showUndoToast(id, title, () => {
            void trash.restore(id).catch(reportActionError);
          });
        })
        .catch(reportActionError);
    },
    [listNotes, reportActionError, showUndoToast, trash],
  );

  const [confirm, setConfirm] = useState<
    | { kind: 'destroy'; id: Uuid; title: string }
    | { kind: 'empty' }
    | { kind: 'reset-settings' }
    | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const now = useNow();

  const { status: syncStatus, isPending: syncStatusPending } = useSyncStatus();
  useAutoSync(syncStatus);
  const { syncNow, isSyncing } = useSyncNow();
  const { resolve: resolveConflict } = useResolveConflict();
  const { reupload, isReuploading } = useReupload();
  const { conflicts: syncConflicts } = useSyncConflicts(settingsOpen && settingsTab === 'sync');
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncLastResult, setSyncLastResult] = useState<SyncSummary | null>(null);
  const [syncLastReupload, setSyncLastReupload] = useState<number | null>(null);

  const { info: appInfo } = useAppInfo();
  const {
    check: checkForUpdate,
    isChecking: isCheckingUpdate,
    update: foundUpdate,
    hasChecked: hasCheckedUpdate,
    error: updateCheckError,
    errorCode: updateCheckErrorCode,
  } = useCheckForUpdate();
  const {
    install: installUpdate,
    isInstalling: isInstallingUpdate,
    installed: isUpdateInstalled,
    downloaded: updateDownloaded,
    total: updateTotal,
    error: updateInstallError,
    errorCode: updateInstallErrorCode,
  } = useInstallUpdate();
  const lastUpdateCheckAt = useSettingsStore((state) => state.lastUpdateCheckAt);
  useDailyUpdateCheck();

  const saveSyncConfig = useCallback(
    async (connectionString: string, enabled: boolean): Promise<void> => {
      setSyncSaving(true);
      try {
        await syncApi.setConfig(connectionString, enabled);
        void queryClient.invalidateQueries({ queryKey: ['sync-status'] });
      } finally {
        setSyncSaving(false);
      }
    },
    [queryClient],
  );

  const runSyncNow = useCallback(async (): Promise<SyncSummary> => {
    const summary = await syncNow();
    setSyncLastResult(summary);
    setSyncLastReupload(null);
    refetch();
    return summary;
  }, [syncNow, refetch]);

  const runReupload = useCallback(async (): Promise<number> => {
    const queued = await reupload();
    setSyncLastReupload(queued);
    return queued;
  }, [reupload]);

  const folderNames = useMemo(() => folderNamesById(folders ?? []), [folders]);
  const folderCounts = useMemo(() => countByFolder(notes ?? []), [notes]);

  const firstLaunch = !isPending && selection.kind === 'all' && (notes?.length ?? 0) === 0;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switch');
    root.dataset.theme = theme;
    const frame = requestAnimationFrame(() => {
      root.classList.remove('theme-switch');
    });
    return () => {
      cancelAnimationFrame(frame);
      root.classList.remove('theme-switch');
    };
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const restored = useRef(false);
  useEffect(() => {
    void windowApi.ready();
    void hydrateSettings().then(() => {
      const settings = useSettingsStore.getState();
      setSelection(settings.lastSelection);
      setOpenNote(settings.lastNoteId);
      restored.current = true;
    });
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    useSettingsStore.getState().setLastNote(openNoteId);
  }, [openNoteId]);

  useEffect(() => {
    if (!restored.current) return;
    useSettingsStore.getState().setLastSelection(selection);
  }, [selection]);

  useEffect(() => {
    const flush = (): void => {
      flushSettings();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    const stopClose = onWindowCloseRequested(async () => {
      await flushEditorsForSync();
      await flushSettingsAsync();
    });
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      stopClose();
    };
  }, []);

  const createNote = useCallback(async (): Promise<void> => {
    const current = useSelectionStore.getState().selection;
    const folderId = current.kind === 'folder' ? current.id : defaultFolderId;

    const note = await notesApi.create(folderId);
    setOpenNote(note.id);
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    if (mobile) setStack(PUSH_EDITOR);
  }, [defaultFolderId, mobile, queryClient]);

  const foldersChanged = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['folders'] });
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['note'] });
  }, [queryClient]);

  const tagsChanged = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['note'] });
  }, [queryClient]);

  const createTag = useCallback(
    async (name: string): Promise<void> => {
      await tagsApi.create(name);
      tagsChanged();
    },
    [tagsChanged],
  );

  const renameTag = useCallback(
    async (id: Uuid, name: string): Promise<void> => {
      await tagsApi.rename(id, name);
      tagsChanged();
    },
    [tagsChanged],
  );

  const deleteTag = useCallback(
    async (id: Uuid): Promise<void> => {
      await tagsApi.remove(id);
      const current = useSelectionStore.getState().selection;
      if (current.kind === 'tag' && current.id === id) {
        setSelection({ kind: 'all' });
      }
      tagsChanged();
    },
    [tagsChanged],
  );

  const createFolder = useCallback(
    async (name: string, parentId: Uuid | null): Promise<void> => {
      await foldersApi.create(name, parentId);
      foldersChanged();
    },
    [foldersChanged],
  );

  const renameFolder = useCallback(
    async (id: Uuid, name: string): Promise<void> => {
      await foldersApi.rename(id, name);
      foldersChanged();
    },
    [foldersChanged],
  );

  const deleteFolder = useCallback(
    async (id: Uuid): Promise<void> => {
      const current = useSelectionStore.getState().selection;
      const loses = current.kind === 'folder' && isInsideSubtree(folders ?? [], id, current.id);
      await foldersApi.remove(id);
      if (loses) setSelection({ kind: 'all' });
      foldersChanged();
    },
    [folders, foldersChanged],
  );

  const moveFolder = useCallback(
    async (id: Uuid, newParentId: Uuid | null, position: number): Promise<void> => {
      await foldersApi.move(id, newParentId, position);
      const current = useSelectionStore.getState().selection;
      if (current.kind === 'folder' && isInsideSubtree(folders ?? [], id, current.id)) {
        setSelection({ kind: 'all' });
      }
      foldersChanged();
    },
    [folders, foldersChanged],
  );

  const deleteOpenNote = useCallback((): void => {
    const { openNoteId: id, selection: current } = useSelectionStore.getState();
    if (id === null || current.kind === 'trash') return;
    softDeleteWithToast(id);
  }, [softDeleteWithToast]);

  const openFromList = useCallback(
    (id: Uuid) => {
      setOpenNote(id);
      if (mobile) setStack(PUSH_EDITOR);
    },
    [mobile],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      const code = event.code;

      if (isLetterShortcut(event, 'n')) {
        event.preventDefault();
        void createNote();
        return;
      }
      if (isLetterShortcut(event, 'f')) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (key === '\\' || code === 'Backslash') {
        event.preventDefault();
        if (tablet) {
          setDrawerOpen((open) => !open);
        } else {
          useSettingsStore.getState().toggleSidebarCollapsed();
        }
        return;
      }
      if (key === 'enter' && (event.ctrlKey || event.metaKey)) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-testid="note-editor"]') !== null) return;
        event.preventDefault();
        document.querySelector<HTMLElement>('[data-testid="note-editor"]')?.focus();
        return;
      }
      if (isLetterShortcut(event, 'l') && event.shiftKey) {
        event.preventDefault();
        useSettingsStore.getState().setTheme(nextVisibleTheme(themeSetting, systemDark));
        return;
      }
      if (key === 'backspace') {
        const target = event.target as HTMLElement | null;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        deleteOpenNote();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [createNote, deleteOpenNote, systemDark, tablet, themeSetting]);

  const overlayOpen = settingsOpen || confirm !== null;
  const overlayOpenRef = useRef(overlayOpen);
  useEffect(() => {
    overlayOpenRef.current = overlayOpen;
  }, [overlayOpen]);

  const confirmRef = useRef(confirm);
  useEffect(() => {
    confirmRef.current = confirm;
  }, [confirm]);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  const stackRef = useRef(stack);
  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);

  const leaveEditor = useCallback(() => {
    setStack(popView);
    if (mobile) setOpenNote(null);
  }, [mobile]);
  const leaveEditorRef = useRef(leaveEditor);
  useEffect(() => {
    leaveEditorRef.current = leaveEditor;
  }, [leaveEditor]);
  useEffect(() =>
    installBackHandler(() => {
      if (confirmRef.current !== null) {
        setConfirm(null);
        return true;
      }
      if (settingsOpenRef.current) {
        setSettingsOpen(false);
        return true;
      }
      if (!canPop(stackRef.current)) return false;
      leaveEditorRef.current();
      return true;
    }),
  );

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented || overlayOpenRef.current) return;
      event.preventDefault();
      setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  const sidebar = (
    <Sidebar
      selection={selection}
      width={mobile ? null : sidebarWidth}
      folders={folders}
      tags={tags}
      notes={listNotes}
      search={searchSummary}
      onClearSearch={() => {
        setQuery('');
      }}
      searchFooter={
        results.nextOffset === null ? null : (
          <ShowMore pending={results.isFetchingMore} onClick={results.loadMore} />
        )
      }
      isPending={isPending}
      now={now}
      folderNames={folderNames}
      folderCounts={folderCounts}
      collapsedFolders={collapsedFolders}
      foldersCollapsed={sectionsCollapsed.folders}
      tagsCollapsed={sectionsCollapsed.tags}
      onToggleFoldersCollapsed={() => {
        useSettingsStore.getState().toggleSectionCollapsed('folders');
      }}
      onToggleTagsCollapsed={() => {
        useSettingsStore.getState().toggleSectionCollapsed('tags');
      }}
      openNoteId={openNoteId}
      firstLaunch={firstLaunch}
      onSelect={(next) => {
        setSelection(next);
      }}
      onOpenNote={openFromList}
      onNewNote={() => {
        void createNote();
      }}
      onTogglePin={(id) => {
        const current = listNotes.find((note) => note.id === id);
        if (current === undefined) return;
        togglePin(id, !current.isPinned);
      }}
      pinPendingId={pinPendingId}
      onDeleteNote={selection.kind === 'trash' ? undefined : softDeleteWithToast}
      onRestoreNote={
        selection.kind === 'trash'
          ? (id) => {
              void trash.restore(id).catch(reportActionError);
            }
          : undefined
      }
      onDestroyNote={
        selection.kind === 'trash'
          ? (id) => {
              const note = listNotes.find((candidate) => candidate.id === id);
              const title = note === undefined || note.title.length === 0 ? 'Untitled' : note.title;
              setConfirm({ kind: 'destroy', id, title });
            }
          : undefined
      }
      onEmptyTrash={() => {
        setConfirm({ kind: 'empty' });
      }}
      onToggleFolder={useSettingsStore.getState().toggleFolderCollapsed}
      onCreateFolder={createFolder}
      onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder}
      onMoveFolder={moveFolder}
      onCreateTag={createTag}
      onRenameTag={renameTag}
      onDeleteTag={deleteTag}
      conflictCount={syncStatus?.conflictCount ?? 0}
      onOpenConflicts={() => {
        setSettingsTab('sync');
        setSettingsOpen(true);
      }}
    />
  );

  const editor = (
    <main aria-label="Editor" className="flex min-h-0 flex-1">
      <Suspense fallback={<div className="min-h-0 flex-1 bg-[var(--surface)]" />}>
        <EditorPane
          noteId={openNoteId}
          selectionKey={selectionKey(selection)}
          onClose={mobile ? leaveEditor : undefined}
          onTrash={
            mobile && openNoteId !== null && selection.kind !== 'trash'
              ? () => {
                  softDeleteWithToast(openNoteId);
                }
              : undefined
          }
        />
      </Suspense>
    </main>
  );

  return (
    <div className="flex h-full flex-col" data-testid="app-shell" data-breakpoint={breakpoint}>
      {mobile ? null : (
        <TopBar
          searchValue={query}
          inputRef={searchRef}
          onSearchChange={setQuery}
          onNewNote={() => {
            void createNote();
          }}
          onToggleTheme={() => {
            useSettingsStore.getState().setTheme(nextVisibleTheme(themeSetting, systemDark));
          }}
          theme={theme}
          onToggleSidebar={() => {
            if (tablet) {
              setDrawerOpen((open) => !open);
              return;
            }
            useSettingsStore.getState().toggleSidebarCollapsed();
          }}
          showSidebarToggle={tablet}
          onOpenOverflow={() => {
            setSettingsOpen(true);
          }}
        />
      )}

      {mobile ? (
        <MobileLayout
          view={currentView(stack)}
          list={
            <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface-raised)]">
              <TopBar
                variant="mobile"
                searchValue={query}
                inputRef={searchRef}
                onSearchChange={setQuery}
                onNewNote={() => {
                  void createNote();
                }}
                onToggleTheme={() => {
                  useSettingsStore.getState().setTheme(nextVisibleTheme(themeSetting, systemDark));
                }}
                theme={theme}
                onOpenOverflow={() => {
                  setSettingsOpen(true);
                }}
              />
              {sidebar}
            </div>
          }
          editor={editor}
        />
      ) : tablet ? (
        <TabletLayout
          sidebar={sidebar}
          editor={editor}
          drawerOpen={drawerOpen}
          onDrawerOpenChange={setDrawerOpen}
        />
      ) : (
        <DesktopLayout
          sidebar={sidebarCollapsed ? null : sidebar}
          editor={editor}
          sidebarWidth={sidebarWidth}
          onResize={useSettingsStore.getState().setSidebarWidth}
        />
      )}

      {undoToast === null ? null : (
        <div
          data-testid="undo-toast-wrap"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+var(--inset-bottom))] z-40 flex justify-center px-4"
        >
          <UndoToast toast={undoToast} />
        </div>
      )}

      {actionError === null ? null : (
        <div
          data-testid="action-error-toast"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+var(--inset-bottom))] z-40 flex justify-center px-4"
        >
          <p
            role="alert"
            className="pointer-events-auto max-w-[420px] rounded-[var(--r-card)] border border-[var(--danger)] bg-[var(--surface)] px-4 py-2 text-center text-[13px] font-medium text-[var(--danger)] shadow-[var(--shadow-pop)]"
          >
            {actionError}
          </p>
        </div>
      )}

      {settingsOpen ? (
        <SettingsDialog
          theme={themeSetting}
          effective={theme}
          accent={accent}
          lastCustomHex={lastCustomHex}
          defaultFolderId={defaultFolderId}
          folders={folders ?? []}
          initialTab={settingsTab}
          sync={{
            status: syncStatus,
            statusPending: syncStatusPending,
            conflicts: syncConflicts,
            syncing: isSyncing,
            saving: syncSaving,
            saveError: null,
            lastResult: syncLastResult,
            reuploading: isReuploading,
            lastReupload: syncLastReupload,
            onSaveConfig: saveSyncConfig,
            onSyncNow: runSyncNow,
            onReupload: runReupload,
            onResolve: async (id, keepLocal) => {
              await flushEditorsForSync();
              return resolveConflict(id, keepLocal);
            },
          }}
          updates={{
            info: appInfo,
            isChecking: isCheckingUpdate,
            update: foundUpdate,
            hasChecked: hasCheckedUpdate,
            checkError: updateCheckError,
            checkErrorCode: updateCheckErrorCode,
            isInstalling: isInstallingUpdate,
            installed: isUpdateInstalled,
            downloaded: updateDownloaded,
            total: updateTotal,
            installError: updateInstallError,
            installErrorCode: updateInstallErrorCode,
            lastCheckedAt: lastUpdateCheckAt,
            onCheck: checkForUpdate,
            onInstall: installUpdate,
          }}
          onThemeChange={(next) => {
            useSettingsStore.getState().setTheme(next);
          }}
          onAccentChange={(next) => {
            const store = useSettingsStore.getState();
            store.setAccent(next);
            if (next !== null && next.kind === 'custom') store.setLastCustomHex(next.hex);
          }}
          onDefaultFolderChange={(next) => {
            useSettingsStore.getState().setDefaultFolderId(next);
          }}
          onClose={() => {
            setSettingsOpen(false);
          }}
          confirmReset={
            <ConfirmDialog
              title="Reset all settings?"
              body="Theme, accent colour, sidebar width and default folder return to their defaults. Your notes are not touched."
              confirmLabel="Reset settings"
              onCancel={() => {
                setConfirm(null);
              }}
              onConfirm={() => {
                setConfirm(null);
                useSettingsStore.getState().reset();
              }}
            />
          }
        />
      ) : null}

      {confirm?.kind === 'destroy' ? (
        <ConfirmDialog
          title={`Delete “${confirm.title}” permanently?`}
          body="This cannot be undone. The note and its text are removed from this device."
          confirmLabel="Delete permanently"
          onCancel={() => {
            setConfirm(null);
          }}
          onConfirm={() => {
            const target = confirm.id;
            setConfirm(null);
            void trash.destroy(target).catch(reportActionError);
          }}
        />
      ) : confirm?.kind === 'empty' ? (
        <ConfirmDialog
          title="Empty the trash?"
          body="Every note in the trash is removed from this device. This cannot be undone."
          confirmLabel="Empty trash"
          onCancel={() => {
            setConfirm(null);
          }}
          onConfirm={() => {
            setConfirm(null);
            void trash.emptyTrash().catch(reportActionError);
          }}
        />
      ) : null}
    </div>
  );
}

const EMPTY_NOTES: NoteSummary[] = [];

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Something went wrong.';
}

function ShowMore({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-none justify-center border-t border-[var(--border)] px-3 py-2">
      <button
        type="button"
        data-testid="show-more-results"
        disabled={pending}
        onClick={onClick}
        className="rounded-[var(--r-input)] border border-[var(--border-strong)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:opacity-50"
      >
        {pending ? 'Loading…' : 'Show more'}
      </button>
    </div>
  );
}

const PUSH_EDITOR = (state: ViewStack): ViewStack => pushView(state, 'editor');

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
