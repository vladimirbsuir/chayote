import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Selection } from '../types/ipc';
import type { SearchHit, SearchInput } from '../types/search';
import { searchApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import { debounce } from '../lib/debounce';

/* `10-conventions.md` §8: "Search input is debounced at 150 ms. Never query FTS5
   on every keystroke." `05-ui-ux.md` §6.5: results replace the note list, and a
   query under two characters is not a query at all.

   Two behaviours here are load-bearing rather than incidental.

   The debounce is the difference between searching and not searching: a prefix
   match means every keystroke is a legitimate query, and issuing them all is a
   table scan per character on a corpus the size `03-data-model.md` §8 assumes.

   The previous page is kept while the next one loads. `01-product.md` §8 requires
   results "without a visible loading state", and a list that blanks to nothing and
   refills on every keystroke is the visible loading state, whatever it is called.
   The query is fast enough that the blank is short, which is what makes it look
   like a flicker rather than a load. */

export const SEARCH_DEBOUNCE_MS = 150;

/** `05-ui-ux.md` §6.5: "Query length ≥ 2". Below it the field is not searching,
    and the selection's own list is what the user is looking at. */
export const SEARCH_MIN_LENGTH = 2;

/** One page of hits. `SearchService` clamps `limit` to 500, and the list is
    virtualised, so a page this size costs the same to render as a short one. */
export const SEARCH_PAGE_SIZE = 500;

export type SearchState = {
  /** `true` when the field holds a real query and the list is showing results
      rather than the selection. The shell branches on this, not on the raw text,
      so the list and the field cannot disagree about whether a search is running. */
  active: boolean;
  /** The query these results are for: trimmed, and past the debounce. The list
      header names this rather than the field's text, because naming the newer of
      the two describes something that is not on screen. */
  applied: string;
  hits: SearchHit[];
  /** Every match in the scope, which is not `hits.length` once pages are added. */
  total: number;
  /** `null` once the last page has been fetched. */
  nextOffset: number | null;
  isFetchingMore: boolean;
  loadMore: () => void;
};

/* One shared empty array so an inactive search hands the list the same reference
   the memoised rows already saw, rather than invalidating them on every render. */
const NO_HITS: SearchHit[] = [];

export function useSearch(query: string, selection: Selection): SearchState {
  /* The field holds the raw text; the query holds what actually reached the
     index. A debouncer built once and cancelled on every change is what keeps a
     typing burst at one query rather than one per keystroke. */
  const [settled, setSettled] = useState(query);
  const settle = useMemo(
    () => debounce((value: string) => { setSettled(value); }, SEARCH_DEBOUNCE_MS),
    [],
  );

  useEffect(() => {
    settle(query);
    return () => {
      settle.cancel();
    };
  }, [query, settle]);

  const trimmed = settled.trim();
  const active = trimmed.length >= SEARCH_MIN_LENGTH;

  const input: SearchInput = {
    query: trimmed,
    filter: selection,
    limit: SEARCH_PAGE_SIZE,
    offset: 0,
  };

  const page = useInfiniteQuery({
    /* Keyed on the debounced query and the selection, so a search that has not
       settled yet, or a query under the minimum length, never issues a request —
       and so switching folder or tag re-runs against the new scope rather than
       serving the old one's cache. */
    queryKey: qk.search(input),
    queryFn: ({ pageParam }) => searchApi.query({ ...input, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: active,
    /* The previous result set stands in until the next one lands. */
    placeholderData: (previous) => previous,
  });

  const pages = active ? page.data?.pages : undefined;

  return {
    active,
    applied: trimmed,
    hits: pages === undefined ? NO_HITS : pages.flatMap((entry) => entry.hits),
    total: pages?.[0]?.total ?? 0,
    nextOffset: pages?.at(-1)?.nextOffset ?? null,
    isFetchingMore: page.isFetchingNextPage,
    loadMore: () => {
      void page.fetchNextPage();
    },
  };
}