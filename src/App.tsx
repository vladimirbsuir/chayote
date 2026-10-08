import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { FilePlus, Plus } from 'lucide-react';
import { notesApi, windowApi } from './lib/ipc';
import { loadSettings } from './lib/settings';
import { qk } from './queries/keys';
import { TopBar } from './components/TopBar';
import { EmptyState } from './components/EmptyState';
import type { Theme } from './lib/settings';
import type { Uuid } from './types/note';

/* ProseMirror and TipTap together are the bulk of the bundle, and none of it is
   needed for first paint. `02-architecture.md` §8 budgets cold launch to first
   paint at 700 ms, so the editor is split out and fetched after the shell is on
   screen. `import()` in `ipc.ts` already works this way for the Tauri core. */
const EditorPane = lazy(() =>
  import('./components/EditorPane').then((module) => ({ default: module.EditorPane })),
);

function useResolvedTheme(theme: Theme): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

/* M2 wires the editor into the shell. The sidebar, note list, and selection model
   are M3's; until then this shell is the top bar plus the editor, with the
   first-launch empty state from `05-ui-ux.md` §8 shown when the database has no
   notes at all (ADR-014). */
function Shell() {
  const [theme, setTheme] = useState<Theme>('system');
  const [search, setSearch] = useState('');
  const [noteId, setNoteId] = useState<Uuid | null>(null);
  const [selectionKey, setSelectionKey] = useState('all');
  const resolved = useResolvedTheme(theme);

  const list = useQuery({
    queryKey: qk.notes({ kind: 'all' }),
    queryFn: () => notesApi.list({ kind: 'all' }),
  });

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  useEffect(() => {
    void windowApi.ready();
    void loadSettings().then((settings) => {
      setTheme(settings.theme);
      setNoteId(settings.lastNoteId);
      setSelectionKey(settings.lastSelection.kind);
    });
  }, []);

  const createNote = useCallback(async (): Promise<void> => {
    const note = await notesApi.create(null);
    setNoteId(note.id);
    void list.refetch();
  }, [list]);

  const firstLaunch = list.data !== undefined && list.data.length === 0;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        searchValue={search}
        onSearchChange={setSearch}
        onSearchFocus={() => {
          /* wired in M3 */
        }}
        onNewNote={() => {
          void createNote();
        }}
        onToggleTheme={() => {
          setTheme(resolved === 'dark' ? 'light' : 'dark');
        }}
        onOpenOverflow={() => {
          /* wired in M3 */
        }}
      />
      <main className="flex min-h-0 flex-1">
        {firstLaunch ? (
          <div className="flex flex-1 items-center justify-center bg-[var(--surface)] p-8">
            <EmptyState
              title="No notes yet"
              body="Your notes are stored on this device and never leave it."
              icon={<FilePlus className="icon i-20" aria-hidden="true" />}
              action={
                <button
                  type="button"
                  onClick={() => {
                    void createNote();
                  }}
                  className="mt-1 flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white"
                >
                  <Plus className="icon i-16" aria-hidden="true" />
                  New note
                </button>
              }
            />
          </div>
        ) : (
          <Suspense fallback={<div className="flex-1 bg-[var(--surface)]" />}>
            <EditorPane noteId={noteId} selectionKey={selectionKey} />
          </Suspense>
        )}
      </main>
    </div>
  );
}

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}