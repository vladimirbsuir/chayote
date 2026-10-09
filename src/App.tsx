import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { notesApi, windowApi } from './lib/ipc';
import { useNow, useNotes } from './hooks/useNotes';
import { countByFolder, folderNamesById, useFolders } from './hooks/useFolders';
import { useTags } from './hooks/useTags';
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
import { Sidebar } from './components/Sidebar';
import { DesktopLayout, MobileLayout, TabletLayout } from './layout/DesktopLayout';
import { useBreakpoint } from './layout/useBreakpoint';
import { currentView, popView, pushView } from './layout/viewStack';
import type { ViewStack } from './layout/viewStack';
import type { Uuid } from './types/note';

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
    layouts of `05-ui-ux.md` §2. Every control below routes through `lib/ipc.ts`,
    so nothing here touches storage (rule R6). */
function Shell() {
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const breakpoint = useBreakpoint();
  const systemDark = useSystemDark();

  const selection = useSelectionStore((state) => state.selection);
  const openNoteId = useSelectionStore((state) => state.openNoteId);

  const theme = useSettingsStore((state) => resolveTheme(state.theme, systemDark));
  const accent = useSettingsStore((state) => state.accent);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const collapsedFolders = useSettingsStore((state) => state.collapsedFolders);
  const defaultFolderId = useSettingsStore((state) => state.defaultFolderId);

  const [stack, setStack] = useState<ViewStack>({ stack: ['list'] });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const mobile = breakpoint === 'mobile';
  const tablet = breakpoint === 'tablet';

  const { notes, isPending, refetch } = useNotes(selection);
  const { folders } = useFolders();
  const { tags } = useTags();
  const now = useNow();

  const folderNames = useMemo(() => folderNamesById(folders ?? []), [folders]);
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
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [createNote, tablet]);

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
      notes={notes}
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
      onToggleFolder={useSettingsStore.getState().toggleFolderCollapsed}
      onCreateFolder={NOOP}
      onCreateTag={NOOP}
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
          searchValue={search}
          inputRef={searchRef}
          onSearchChange={setSearch}
          onNewNote={() => {
            void createNote();
          }}
          onToggleTheme={() => {
            useSettingsStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark');
          }}
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
          onOpenOverflow={NOOP}
        />
      )}

      {mobile ? (
        <MobileLayout
          view={currentView(stack)}
          list={
            <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface-raised)]">
              <TopBar
                variant="mobile"
                searchValue={search}
                inputRef={searchRef}
                onSearchChange={setSearch}
                onNewNote={() => {
                  void createNote();
                }}
                onToggleSidebar={NOOP}
                onToggleTheme={() => {
                  useSettingsStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark');
                }}
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
    </div>
  );
}

/* Folder and tag creation, rename, drag-reordering, and pinning are M4. The
   section headers keep their add affordances so the structure is discoverable,
   but they do nothing until then — a dead control is worse than a missing one,
   so the two section headers are the only affordances M3 renders. */
const NOOP = (): void => {};

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