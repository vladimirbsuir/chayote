import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH, useSearch } from './useSearch';
import type { NoteSummary, Selection } from '../types/ipc';
import type { SearchHit, SearchInput, SearchPage } from '../types/search';

/* `10-conventions.md` §8 and `01-product.md` §8, which are the two rules this
   hook exists to satisfy. The debounce is what stops the index being queried per
   keystroke, and the kept previous page is what stops the note list flashing
   empty on every one of them — "without a visible loading state" is a rule about
   what the user sees, not about how fast the query is.

   The backend is a promise this file controls rather than the mock adapter,
   because two of these tests are about ordering: what the hook does while a query
   is still in flight, and how many queries a typing burst produces. A backend
   that resolved immediately could not show either.

   Real timers throughout, except in the burst test: the delay is a real 150 ms and
   the rest of the suite waits on it honestly. Fake timers break `waitFor` here,
   because it advances Jest's clock and Vitest's fake timers leave it out of step
   with the promise chain the query resolves on. */

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

/** Retries `assertion` until it passes, with a budget far longer than the
    debounce. It takes an assertion rather than a predicate because `waitFor`
    decides "still waiting" from a thrown error — a callback that merely returns
    `false` resolves on its first call and asserts nothing. */
async function eventually(assertion: () => void): Promise<void> {
  await waitFor(assertion, { timeout: 2_000 });
}

/** Runs `act` and lets the microtask queue drain, so a promise the call resolved
    has reached the cache before the next assertion reads it. */
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

    /* The query never settles into anything searchable, so there is nothing to
       wait for: the assertion is the absence of a call, and the debounce has had
       its full duration by the time the field is lengthened. */
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

    /* The second query is held open. `01-product.md` §8 asks for no visible
       loading state, so what the user must still be looking at is the first
       result set — not an empty list waiting for the second one. */
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