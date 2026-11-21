import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH, useSearch } from './useSearch';
import type { NoteSummary, Selection } from '../types/ipc';
import type { SearchHit, SearchInput, SearchPage } from '../types/search';

const calls: SearchInput[] = [];
let respond: (input: SearchInput) => Promise<SearchPage>;

vi.mock('../lib/ipc', () => ({
  searchApi: {
    query: (input: SearchInput): Promise<SearchPage> => {
      calls.push(input);
      return respond(input);
    },
  },
}));

const ALL: Selection = { kind: 'all' };

function summary(id: string): NoteSummary {
  return {
    id,
    title: id,
    excerpt: '',
    folderId: null,
    folderName: null,
    isPinned: false,
    wordCount: 0,
    updatedAt: 0,
    tags: [],
  };
}

function hit(id: string): SearchHit {
  return { ...summary(id), rank: -1, snippet: `a <mark>${id}</mark> snippet` };
}

function page(ids: string[], total: number, nextOffset: number | null = null): SearchPage {
  return { hits: ids.map(hit), total, nextOffset };
}

function renderSearch(query: string, selection: Selection = ALL) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
  return renderHook(
    (props: { query: string; selection: Selection }) => useSearch(props.query, props.selection),
    { wrapper, initialProps: { query, selection } },
  );
}

async function eventually(assertion: () => void): Promise<void> {
  await waitFor(assertion, { timeout: 2_000 });
}

async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

function ids(entries: SearchHit[]): string[] {
  return entries.map((entry) => entry.id);
}

beforeEach(() => {
  calls.length = 0;
  respond = () => Promise.resolve(page([], 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSearch', () => {
  it('issues one query for a typing burst, not one per keystroke', async () => {
    vi.useFakeTimers();
    respond = () => Promise.resolve(page(['a'], 1));
    const { rerender } = renderSearch('');

    for (const text of ['r', 'ro', 'roa', 'road']) {
      rerender({ query: text, selection: ALL });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
      });
    }

    expect(calls).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe('road');
  });

  it('does not query below the minimum length, and the list is not in search mode', async () => {
    respond = () => Promise.resolve(page(['a'], 1));
    const short = 'x'.repeat(SEARCH_MIN_LENGTH - 1);
    const { result, rerender } = renderSearch(short);

    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS * 2));
    expect(result.current.active).toBe(false);
    expect(calls).toHaveLength(0);
    expect(result.current.hits).toEqual([]);

    rerender({ query: 'xy', selection: ALL });
    await eventually(() => {
      expect(calls).toHaveLength(1);
    });
    expect(result.current.active).toBe(true);
  });

  it('returns to the selection list when the query drops below the minimum', async () => {
    respond = () => Promise.resolve(page(['a'], 1));
    const { result, rerender } = renderSearch('roadmap');
    await eventually(() => {
      expect(result.current.hits).toHaveLength(1);
    });

    rerender({ query: 'r', selection: ALL });
    await eventually(() => {
      expect(result.current.active).toBe(false);
    });

    expect(result.current.hits).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('keeps the previous results on screen while the next query is in flight', async () => {
    respond = () => Promise.resolve(page(['first'], 1));
    const { result, rerender } = renderSearch('roadmap');
    await eventually(() => {
      expect(ids(result.current.hits)).toEqual(['first']);
    });

    let release = (): void => {};
    respond = () =>
      new Promise<SearchPage>((done) => {
        release = () => {
          done(page(['second'], 1));
        };
      });

    rerender({ query: 'roadmaps', selection: ALL });
    await eventually(() => {
      expect(calls).toHaveLength(2);
    });
    expect(ids(result.current.hits)).toEqual(['first']);

    await settle(() => {
      release();
    });
    await eventually(() => {
      expect(ids(result.current.hits)).toEqual(['second']);
    });
  });

  it('scopes the query to the active selection', async () => {
    respond = () => Promise.resolve(page(['a'], 1));
    const folder: Selection = { kind: 'folder', id: '01980000-0000-7000-8000-000000000009' };
    const { rerender } = renderSearch('roadmap', ALL);
    await eventually(() => {
      expect(calls).toHaveLength(1);
    });

    rerender({ query: 'roadmap', selection: folder });
    await eventually(() => {
      expect(calls).toHaveLength(2);
    });

    expect(calls[0]?.filter).toEqual(ALL);
    expect(calls.at(-1)?.filter).toEqual(folder);
  });

  it('appends the next page and stops offering one at the end of the results', async () => {
    respond = (input) => Promise.resolve(input.offset === 0 ? page(['a'], 3, 500) : page(['b'], 3));
    const { result } = renderSearch('roadmap');
    await eventually(() => {
      expect(result.current.nextOffset).toBe(500);
    });

    await settle(() => {
      result.current.loadMore();
    });
    await eventually(() => {
      expect(result.current.hits).toHaveLength(2);
    });

    expect(calls.at(-1)?.offset).toBe(500);
    expect(result.current.total).toBe(3);
    expect(result.current.nextOffset).toBeNull();
  });
});