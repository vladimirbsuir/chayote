import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { foldersApi, notesApi, windowApi } from './lib/ipc';
import { isInsideSubtree } from './components/folderRows';
import { useNow, useNotes } from './hooks/useNotes';
import { useSearch } from './hooks/useSearch';
import { countByFolder, folderNamesById, useFolders } from './hooks/useFolders';
import { useTags } from './hooks/useTags';
import { useTogglePin } from './hooks/useTogglePin';
import { useTrashActions } from './hooks/useTrashActions';
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
import { nextTheme } from './lib/theme';
import { Sidebar } from './components/Sidebar';
import { DesktopLayout, MobileLayout, TabletLayout } from './layout/DesktopLayout';
import { useBreakpoint } from './layout/useBreakpoint';
import { currentView, popView, pushView } from './layout/viewStack';
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
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const collapsedFolders = useSettingsStore((state) => state.collapsedFolders);
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
  const searchSummary = results.active
    ? { query: results.applied, total: results.total }
    : null;

  const { folders } = useFolders();
  const { tags } = useTags();
  const { togglePin, pendingId: pinPendingId } = useTogglePin();
  const { toast: undoToast, show: showUndoToast } = useUndoToast();

  /* `05-ui-ux.md` §6.2: a note that leaves the trash closes the editor, and one that
     comes back re-opens it — closing after a restore would make undo look like it
     acted on the wrong note. */
  const trash = useTrashActions({
    onOpenNoteGone: (goneId) => {
      if (goneId === null || goneId === useSelectionStore.getState().openNoteId) {
        setOpenNote(null);
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
  const now = useNow();

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
    document.documentElement.dataset.theme = theme;
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
      const key = event.key.toLowerCase();

      if (key === 'n') {
        event.preventDefault();
        void createNote();
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (key === '\\') {
        event.preventDefault();
        if (tablet) {
          setDrawerOpen((open) => !open);
        } else {
          useSettingsStore.getState().toggleSidebarCollapsed();
        }
        return;
      }
      /* §7: `Toggle theme` is `Ctrl/Cmd+Shift+L`. Light, dark, system, in that
         order — the same cycle as the top-bar button, because a shortcut that
         did something different from the control beside it would be worse than
         having neither. `Shift+L` alone is left alone: browsers use it for
         nothing, but the modifier is part of the binding either way. */
      if (key === 'l' && event.shiftKey) {
        event.preventDefault();
        useSettingsStore.getState().setTheme(nextTheme(themeSetting));
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
  }, [createNote, deleteOpenNote, tablet, themeSetting]);

  /* Leaving the editor on a small screen pops the view stack (§2.4), which is
     what the Android back button does natively in M7. */
  const closeEditor = useCallback(() => {
    setStack(popView);
  }, []);

  const sidebar = (
    <Sidebar
      selection={selection}
      width={sidebarWidth}
      folders={folders}
      tags={tags}
      notes={listNotes}
      search={searchSummary}
      onClearSearch={() => {
        setQuery('');
      }}
      searchFooter={
        results.nextOffset === null ? null : (
          <ShowMore
            pending={results.isFetchingMore}
            onClick={results.loadMore}
          />
        )
      }
      isPending={isPending}
      now={now}
      folderNames={folderNames}
      folderCounts={folderCounts}
      collapsedFolders={collapsedFolders}
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
              void trash.restore(id);
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
      onCreateTag={NOOP}
      onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder}
      onMoveFolder={moveFolder}
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
          onClose={mobile ? closeEditor : undefined}
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
            useSettingsStore.getState().setTheme(nextTheme(themeSetting));
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
                onToggleSidebar={NOOP}
                onToggleTheme={() => {
                  useSettingsStore.getState().setTheme(nextTheme(themeSetting));
                }}
                theme={theme}
                onOpenOverflow={NOOP}
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
          is looking. Bottom-centred, out of the way of both panes. */}
      {undoToast === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <UndoToast toast={undoToast} />
        </div>
      )}

      {settingsOpen ? (
        <SettingsDialog
          theme={themeSetting}
          effective={theme}
          accent={accent}
          defaultFolderId={defaultFolderId}
          folders={folders ?? []}
          onThemeChange={(next) => {
            useSettingsStore.getState().setTheme(next);
          }}
          onAccentChange={(next) => {
            useSettingsStore.getState().setAccent(next);
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
            void trash.destroy(target);
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
            void trash.emptyTrash();
          }}
        />
      ) : null}
    </div>
  );
}

/* Tag creation, drag-reordering, and pinning are later parts of M4. The `+` in the
    Tags header and the top-bar overflow menu stay wired to this until they are: the
    controls are already in the prototype and in `05-ui-ux.md`, and removing them
    would be a change to the specified appearance rather than to the implementation.
    Each is annotated at its call site with the milestone that lands it. */
const NOOP = (): void => {};

/* One shared empty list rather than a fresh `[]` per render, so the sidebar's
   memoised rows are not handed a new reference on every tick. */
const EMPTY_NOTES: NoteSummary[] = [];

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