import type { NoteSummary, Selection } from './ipc';

export type SearchInput = {
  query: string;
  filter: Selection;
  limit: number;
  offset: number;
};

export type SearchHit = NoteSummary & {
  rank: number;
  snippet: string;
};

export type SearchPage = {
  hits: SearchHit[];
  total: number;
  nextOffset: number | null;
};
