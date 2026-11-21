import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Selection } from '../types/ipc';
import type { SearchHit, SearchInput } from '../types/search';
import { searchApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import { debounce } from '../lib/debounce';

export const SEARCH_DEBOUNCE_MS = 150;

export const SEARCH_MIN_LENGTH = 2;

export const SEARCH_PAGE_SIZE = 500;

export type SearchState = {
  active: boolean;
  applied: string;
  hits: SearchHit[];
  total: number;
  nextOffset: number | null;
  isFetchingMore: boolean;
  loadMore: () => void;
};

const NO_HITS: SearchHit[] = [];

export function useSearch(query: string, selection: Selection): SearchState {
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
    queryKey: qk.search(input),
    queryFn: ({ pageParam }) => searchApi.query({ ...input, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: active,
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