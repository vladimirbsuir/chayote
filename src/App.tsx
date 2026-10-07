import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { FilePlus, Plus } from 'lucide-react';
import { notesApi, windowApi } from './lib/ipc';
import { qk } from './queries/keys';
import { TopBar } from './components/TopBar';
import { EmptyState } from './components/EmptyState';

type Theme = 'light' | 'dark' | 'system';

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

function Shell() {
  const [theme, setTheme] = useState<Theme>('system');
  const [search, setSearch] = useState('');
  const resolved = useResolvedTheme(theme);

  useQuery({ queryKey: qk.notes({ kind: 'all' }), queryFn: () => notesApi.list({ kind: 'all' }) });

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  useEffect(() => {
    void windowApi.ready();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        searchValue={search}
        onSearchChange={setSearch}
        onSearchFocus={() => {
          /* wired in M3 */
        }}
        onNewNote={() => {
          /* wired in M3 */
        }}
        onToggleTheme={() => {
          setTheme(resolved === 'dark' ? 'light' : 'dark');
        }}
        onOpenOverflow={() => {
          /* wired in M3 */
        }}
      />
      <main className="flex-1 overflow-auto p-8">
        <EmptyState
          title="No notes yet"
          body="Your notes are stored on this device and never leave it."
          icon={<FilePlus className="icon i-20" aria-hidden="true" />}
          action={
            <button
              type="button"
              className="mt-1 flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white"
            >
              <Plus className="icon i-16" aria-hidden="true" />
              New note
            </button>
          }
        />
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
