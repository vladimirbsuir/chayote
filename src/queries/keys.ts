import type { NoteFilter } from '../types/ipc';
import type { Uuid } from '../types/note';
import type { SearchInput } from '../types/search';

/* Query keys live here, never inline. 10-conventions.md §7. */

export const qk = {
  notes: (filter: NoteFilter) => ['notes', filter] as const,
  note: (id: Uuid) => ['note', id] as const,
  folders: () => ['folders'] as const,
  tags: () => ['tags'] as const,
  search: (input: SearchInput) => ['search', input] as const,
};
