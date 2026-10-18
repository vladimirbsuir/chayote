import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { foldersApi, installBackHandler, notesApi, syncApi, tagsApi, windowApi } from './lib/ipc';
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

/* ProseMirror and TipTap together are the bulk of the bundle, and none of it is
   needed for first paint. `02-architecture.md` §8 budgets cold launch to first
   paint at 700 ms, so the editor is split out and fetched after the shell is on
   screen. `import()` in `ipc.ts` already works this way for the Tauri core. */
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

/** M3 wires the shell to the selection model, the note list, and the three
    layouts of `05-ui-ux.md` §2. M4 adds the folder writes. M5 makes the top bar's
    field real. Every control below routes through `lib/ipc.ts`, so nothing here
    touches storage (rule R6). */
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
  /* The raw field text. `useSearch` debounces it and decides whether it is a
     search at all; the shell holds it because `Ctrl/Cmd+F` and `Esc` both act on
     the field itself, and a second owner of the value is how those two end up
     disagreeing with the list. */
  const [query, setQuery] = useState('');

  const mobile = breakpoint === 'mobile';
  const tablet = breakpoint === 'tablet';

  const { notes, isPending, refetch } = useNotes(selection);
  const results = useSearch(query, selection);

  /* `05-ui-ux.md` §6.5: results replace the note list, and the sidebar structure
     above it stays, so a search can still be scoped by clicking a folder or a
     tag while the field holds its text. One branch rather than two lists, so the
     sidebar cannot end up showing a header for one and rows from the other.
     Declared here rather than with the other derived values because the delete
     and pin handlers below resolve a row against it. */
  const listNotes = results.active ? results.hits : (notes ?? EMPTY_NOTES);
  const searchSummary = results.active ? { query: results.applied, total: results.total } : null;

  const { folders } = useFolders();
  const { tags } = useTags();
  const { togglePin, pendingId: pinPendingId } = useTogglePin();
  const { toast: undoToast, show: showUndoToast } = useUndoToast();

  /* Trash failures must never be silent: a refused permanent delete (a note
     that has never synced, a database error) used to close the confirmation
     with no message, leaving the note "stuck" in the trash. The message is
     user-facing copy by contract (R7); it clears after a few seconds. */
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

  /* `05-ui-ux.md` §6.2: a note that leaves the trash closes the editor, and one that
     comes back re-opens it — closing after a restore would make undo look like it
     acted on the wrong note. */
  const trash = useTrashActions({
    onOpenNoteGone: (goneId) => {
      if (goneId === null || goneId === useSelectionStore.getState().openNoteId) {
        setOpenNote(null);
        /* `05-ui-ux.md` §2.4: on mobile the editor is a pushed view, not a side
           pane — closing the note without popping strands the user on the
           desktop "No note open" empty state instead of the list. Found on a
           phone: deleting the open note showed that pane. At the root the pop
           is a no-op, so deleting from the list view is unaffected. */
        if (mobile) setStack(popView);
        if (useSelectionStore.getState().selection.kind === 'folder') {
          setSelection({ kind: 'all' });
        }
      }
    },
    onRestored: (id) => {
      setOpenNote(id);
    },
  });

  /* One entry point for a soft delete, wherever it was triggered from, so the toast's
     text always names the note the user actually deleted and the restore always
     targets the same id. A second copy of this in the key handler is how a toast ends
     up offering to undo the wrong note. */
  const softDeleteWithToast = useCallback(
    (id: Uuid): void => {
      const note = listNotes.find((candidate) => candidate.id === id);
      const title = note === undefined || note.title.length === 0 ? 'Untitled' : note.title;
      trash.softDelete(id);
      showUndoToast(id, title, () => {
        void trash.restore(id);
      });
    },
    [listNotes, showUndoToast, trash],
  );

  /* `05-ui-ux.md` §6.2: permanent delete and empty trash confirm; nothing else here
     does. One piece of state rather than two, because a user cannot have two
     destructive confirmations open at once and two flags would only be a way to get
     that wrong. */
  const [confirm, setConfirm] = useState<
    | { kind: 'destroy'; id: Uuid; title: string }
    | { kind: 'empty' }
    | { kind: 'reset-settings' }
    | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const now = useNow();

  /* Sync owns no UI state of its own: status and conflicts are server state
     like notes, and the dialog tab is the only navigation state. */
  const { status: syncStatus, isPending: syncStatusPending } = useSyncStatus();
  useAutoSync(syncStatus);
  const { syncNow, isSyncing } = useSyncNow();
  const { resolve: resolveConflict } = useResolveConflict();
  const { reupload, isReuploading } = useReupload();
  const { conflicts: syncConflicts } = useSyncConflicts(settingsOpen && settingsTab === 'sync');
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncLastResult, setSyncLastResult] = useState<SyncSummary | null>(null);
  const [syncLastReupload, setSyncLastReupload] = useState<number | null>(null);

  /* The updater is server state too, and the daily tick runs from here rather
     than from the tab — a check that only happened while Settings was open would
     not be a daily check. It surfaces nothing; the tab is where an update
     appears (ADR-024, `05-ui-ux.md` §6.6). */
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
    downloaded: updateDownloaded,
    total: updateTotal,
    error: updateInstallError,
    errorCode: updateInstallErrorCode,
  } = useInstallUpdate();
  const lastUpdateCheckAt = useSettingsStore((state) => state.lastUpdateCheckAt);
  useDailyUpdateCheck();

  /* Failures surface where they happened: SyncPane shows the thrown message
     itself (R7 copy), so this only tracks the spinner. */
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
    /* The re-upload notice names what the *next* sync will do. A completed
       cycle did it, so the line retires — otherwise it sits under a
       "Pending rows: 0" claiming work remains. */
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
  /* The folder chips on the rows are counted from the selection's own notes, not
     from the search results: a search is scoped *by* a folder, so counting the
     matches would replace the scope with its own answer. */
  const folderCounts = useMemo(() => countByFolder(notes ?? []), [notes]);

  /* ADR-014: first launch is an empty database, so "no notes" is only the
     first-launch state when the whole `all` selection is empty. A folder the user
     created and never filled in is a different empty state (§8). */
  const firstLaunch = !isPending && selection.kind === 'all' && (notes?.length ?? 0) === 0;

  /* Theme and accent reach the document as CSS custom properties rather than as
     props: switching either must not re-render the ProseMirror subtree
     (ADR-008). */
  useEffect(() => {
    const root = document.documentElement;
    /* The swap lands atomically: surfaces with `transition-colors` would
       otherwise fade one by one behind a background that already flipped,
       leaving dark cards on a light page for a beat. Transitions are
       suppressed for exactly one frame, then restored. */
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

  /* One startup pass: tell Rust the first paint has happened — `window_ready`
     exists so the window is shown after this rather than flashing white
     (`06-platform.md` §1) — then restore the selection and open note. */
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

  /* `06-platform.md` §6: close and reopen restores the selection and the open
      note. Written through the same 300 ms debounce as every other setting. */
  useEffect(() => {
    if (!restored.current) return;
    useSettingsStore.getState().setLastNote(openNoteId);
  }, [openNoteId]);

  useEffect(() => {
    if (!restored.current) return;
    useSettingsStore.getState().setLastSelection(selection);
  }, [selection]);

  /* An unflushed debounced settings write on close would lose the selection the
     user just made, and a reload is the common case: switch selection, close the
     window, reopen.

     `pagehide` rather than `beforeunload` alone, because `beforeunload` is not
     delivered on every navigation — a mobile task switch or a bfcache entry can
     skip it — while `pagehide` always is, and it is the event the HTML spec pairs
     with unload. `visibilitychange` covers the case where the app is backgrounded
     rather than closed, which is the Android path in `06-platform.md` §4.5. The
     autosave flush is the editor's own concern and lives in `EditorPane`. */
  useEffect(() => {
    const flush = (): void => {
      flushSettings();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const createNote = useCallback(async (): Promise<void> => {
    /* `05-ui-ux.md` §6.1: the current folder selection, else the configured
       default, else unfiled. Nothing is pre-created, so unfiled is the common
       case. */
    const current = useSelectionStore.getState().selection;
    const folderId = current.kind === 'folder' ? current.id : defaultFolderId;

    const note = await notesApi.create(folderId);
    setOpenNote(note.id);
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    refetch();
    if (mobile) setStack(PUSH_EDITOR);
  }, [defaultFolderId, mobile, queryClient, refetch]);

  /* Folder writes invalidate the folder query and the note list together
     (`10-conventions.md` §7): a new or deleted folder changes the tree, and a
     deleted folder unfiles the notes inside it, which moves them out of the
     current folder selection. One invalidation rather than two, because they land
     in the same user action and a user cannot see a half-applied one. */
  const foldersChanged = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['folders'] });
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    refetch();
  }, [queryClient, refetch]);

  /* Tag writes invalidate the tag query and the note list together, for the
     same reason folder writes do (`10-conventions.md` §7): a rename moves the
     name every row carries, and a delete strips chips off notes. One
     invalidation rather than two, because they land in the same user action. */
  const tagsChanged = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    refetch();
  }, [queryClient, refetch]);

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

  /* Deleting the tag that is selected leaves nothing to show, so the selection
     moves to All rather than to a row that no longer exists — the same
     `NOT_FOUND` handling a folder delete gets. */
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

  /* Deleting the folder that is selected leaves nothing to show, so the
     selection moves to All rather than to a row that no longer exists
     (`NOT_FOUND` handling in `10-conventions.md` §6). */
  const deleteFolder = useCallback(
    async (id: Uuid): Promise<void> => {
      await foldersApi.remove(id);
      if (useSelectionStore.getState().selection.kind === 'folder') {
        setSelection({ kind: 'all' });
      }
      foldersChanged();
    },
    [foldersChanged],
  );

  /* A re-parent can move a folder out from under the active selection — dragging a
     selected folder elsewhere leaves the selection naming a folder that no longer
     contains what it did — so it falls back to All, the same as a delete. */
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

  /* §6.2 and §7: `Ctrl/Cmd+Backspace` deletes the open note. Bound on the window so
     it works with focus in the editor or in the list, and `preventDefault` because
     Backspace in a WebView navigates back otherwise — which on Android would pop the
     view stack out from under a note the user is deleting. */
  const deleteOpenNote = useCallback((): void => {
    const id = useSelectionStore.getState().openNoteId;
    if (id === null) return;
    softDeleteWithToast(id);
  }, [softDeleteWithToast]);

  const openFromList = useCallback(
    (id: Uuid) => {
      setOpenNote(id);
      if (mobile) setStack(PUSH_EDITOR);
    },
    [mobile],
  );

  /* `05-ui-ux.md` §7. Window-level, because all three must work wherever focus
     happens to be — in the editor, in the list, or nowhere. `preventDefault` on
     each: Ctrl+N and Ctrl+F otherwise trigger browser defaults that would race
     the app, and Playwright would see two handlers. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      /* Letter shortcuts match by physical key too (`lib/shortcuts`): with a
         Russian layout `event.key` for Ctrl+F is "а", so matching the key
         alone strands every shortcut. Non-printable keys need no second
         test — their codes never change with layout. */
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
      /* §7: `Move focus: sidebar -> editor` is `Ctrl/Cmd+Enter`, and the same key
         inside the editor toggles a task item (§7's other row). ProseMirror's
         own binding runs first but does not stop the event bubbling, so the
         target is what tells the two apart — without this check, every task
         toggle would also steal focus into the editor. */
      if (key === 'enter' && (event.ctrlKey || event.metaKey)) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-testid="note-editor"]') !== null) return;
        event.preventDefault();
        document.querySelector<HTMLElement>('[data-testid="note-editor"]')?.focus();
        return;
      }
      /* §7: `Toggle theme` is `Ctrl/Cmd+Shift+L`. Light, dark, system, in that
         order, skipping a step that would resolve to what is already on
         screen — the same cycle as the top-bar button, because a shortcut that
         did something different from the control beside it would be worse than
         having neither. `Shift+L` alone is left alone: browsers use it for
         nothing, but the modifier is part of the binding either way. */
      if (isLetterShortcut(event, 'l') && event.shiftKey) {
        event.preventDefault();
        useSettingsStore.getState().setTheme(nextVisibleTheme(themeSetting, systemDark));
        return;
      }
      /* §7: `Delete note` is `Ctrl/Cmd+Backspace`. Not plain Backspace — in a WebView
         that navigates back, and in the editor that deletes a character. */
      if (key === 'backspace') {
        event.preventDefault();
        deleteOpenNote();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [createNote, deleteOpenNote, systemDark, tablet, themeSetting]);

  /* §7: `Esc` dismisses the search field (in `TopBar`), a dialog (in
     `useDialogFocus`), and the sidebar — the last one being the tablet drawer.
     Bound at the window and gated on nothing else being open, because `Esc` is
     the *cheapest* way out of every surface in the app and the surfaces nest:
     a dialog opened from the drawer must close the dialog first, and one
     opened from the overflow menu must close that. Testing the two flags is
     what stops a single `Esc` from closing three things at once. */
  /* `Esc` has to close exactly one thing, and the surfaces nest: the search
     field, a dialog, the overflow menu and the tablet drawer all dismiss on it.

     Two guards, because they cover different cases. `defaultPrevented` catches
     the one where a surface *above* this one consumed the same key event — React
     flushes a discrete event's re-render before native propagation reaches
     window, so by the time this listener runs the overlay is already closed and
     any captured state would read as "nothing was open". The ref catches the
     one where an overlay is open but focus is outside it, so nothing consumed
     the key at all.

     Without both, a single `Esc` closes the settings dialog and the drawer
     behind it, and the user who pressed it once to dismiss a dialog finds the
     sidebar has gone too. */
  const overlayOpen = settingsOpen || confirm !== null;
  /* Written in an effect rather than during render: a ref assigned in the render
   body is a write during render, which concurrent React may discard or replay.
   The read side is the important half — it has to be current when the key event
   reaches window, and an effect runs before any user event can. */
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

  /* `06-platform.md` §4.4: back dismisses an open dialog, else pops the view stack,
     and at the root returns false so `MainActivity.kt` hands the press back to the
     platform. The three cases are in that order because a dialog is modal — popping
     the stack behind one would leave it floating over a different view.

     Registered once and reading refs, rather than re-registering per state change:
     the bridge is a window property the activity calls on every press, and swapping
     it mid-press would be a race. `§4.4` explains why this is Kotlin at all. */
  const stackRef = useRef(stack);
  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);

  /* Leaving the editor on a small screen pops the view stack (§2.4) — and closes
     the note with it. On desktop the open note stays open beside the list, so its
     row keeps the marker; on mobile the editor is gone, and a marker on a note
     that is not open anywhere reads as a stuck selection. Found on a phone: the
     row stayed highlighted all the way back on the list.

     One funnel for both exits — the editor's back affordance and the system back
     button below — so the two cannot disagree about what "back" leaves behind.
     The bridge reads it through a ref for the same reason it reads the stack
     through one. */
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
      /* The mobile list view is a full-width column (§2.4), not a sized pane:
         a desktop width here ends the content early with a stray divider. */
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
        refetch();
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
      /* Which actions the list offers is the selection's business, not the caller's:
     a live list offers delete and nothing else, the trash offers restore and
     permanent delete and not delete. Passing all three unconditionally would put a
     "Delete permanently" control on every note the user has not deleted yet — the
     one mistake §6.2 is written to prevent. */
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

  /* `<main>` is the editor region: the sidebar is a complementary landmark and
     the top bar is a banner, so the writing surface is the page's main content
     and a screen reader lands there on skip. */
  const editor = (
    <main aria-label="Editor" className="flex min-h-0 flex-1">
      <Suspense fallback={<div className="min-h-0 flex-1 bg-[var(--surface)]" />}>
        <EditorPane
          noteId={openNoteId}
          selectionKey={selectionKey(selection)}
          onClose={mobile ? leaveEditor : undefined}
          /* Only where there is no note row to carry it: §2.4 gives the mobile editor
             bar its delete action, and on desktop the row menu already owns the verb.
             The trash selection is excluded for §6.2's reason — a live row must not
             offer a second delete, and a trashed one must not be deleted again. */
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
          /* Only the tablet drawer needs a visible control; desktop collapses
             through `Ctrl/Cmd+\` and has no button for it in the prototype. */
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

      {/* The undo toast floats above the whole app rather than living in the
          sidebar: a delete can be triggered from the editor's keyboard shortcut, and
          a toast pinned to the sidebar would then be off-screen from where the user
          is looking. Bottom-centred, out of the way of both panes, and above the
          system navigation bar: a viewport-fixed element ignores `#root`'s inset
          padding, so the inset is added back here (zero on desktop). */}
      {undoToast === null ? null : (
        <div
          data-testid="undo-toast-wrap"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+var(--inset-bottom))] z-40 flex justify-center px-4"
        >
          <UndoToast toast={undoToast} />
        </div>
      )}

      {/* Action failures (trash restore/destroy/empty): red, centred, above the
          navigation bar like the undo toast, dismissing itself. */}
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
            /* Flush-then-resolve, like flush-then-sync: keystrokes still in
              the autosave debounce are committed first, so Use-theirs on the
              open note replaces the user's actual document — and the editor
              remount effect then has a clean state to adopt the remote text
              instead of guarding unsaved typing. */
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
            /* Every custom pick is recorded, so the palette restores it even
               after a preset takes over. */
            if (next !== null && next.kind === 'custom') store.setLastCustomHex(next.hex);
          }}
          onDefaultFolderChange={(next) => {
            useSettingsStore.getState().setDefaultFolderId(next);
          }}
          onClose={() => {
            setSettingsOpen(false);
          }}
          confirmReset={
            /* Rendered as a sibling of the settings dialog, not inside it, so the
               two focus traps are not nested — see the note in SettingsDialog. */
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
          /* §6.2 gives soft delete an undo toast and permanent delete a
             confirmation. This one cannot be undone and there is no count to name,
             so it is a different shape from the folder's — which exists to say how
             many folders go with it. */
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

/* One shared empty list rather than a fresh `[]` per render, so the sidebar's
   memoised rows are not handed a new reference on every tick. */
const EMPTY_NOTES: NoteSummary[] = [];

/* `AppError` arrives as `{ code, message }`; anything else is a bug shaped
   like a string. The message is user-facing copy by contract (R7). */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Something went wrong.';
}

/** Appends the next page of results. A two-character query can match more notes
    than one page holds, and a list that stopped at the page boundary while the
    header counted every match would be claiming to be complete when it is not.
    Outside the scroll container, so it stays reachable without scrolling past
    however many results are loaded. */
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

/* `setStack` passes the current value to a reducer, so the second argument is
   pre-bound once at module scope rather than at every call site. */
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
