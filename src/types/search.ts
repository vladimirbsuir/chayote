import type { NoteSummary, Selection } from './ipc';

export type SearchInput = {
  query: string;
  filter: Selection;
  limit: number;
  offset: number;
};

/// The Rust side flattens the whole `NoteSummary` in, so every summary field
/// is present on a hit. `wordCount` included: it arrives, and a type that
/// omits it would hide the field from every consumer.
export type SearchHit = NoteSummary & {
  rank: number;
  snippet: string;
};

export type SearchPage = {
  hits: SearchHit[];
  total: number;
  nextOffset: number | null;
};
