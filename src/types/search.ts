import type { NoteSummary, Selection } from './ipc';

export type SearchInput = {
  query: string;
  filter: Selection;
  limit: number;
  offset: number;
};

export type SearchHit = Pick<
  NoteSummary,
  'id' | 'title' | 'excerpt' | 'folderId' | 'folderName' | 'isPinned' | 'updatedAt' | 'tags'
> & {
  rank: number;
  snippet: string;
};

export type SearchPage = {
  hits: SearchHit[];
  total: number;
  nextOffset: number | null;
};
