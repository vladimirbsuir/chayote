import type { NoteFilter } from '../types/ipc';
import type { Uuid } from '../types/note';
import type { SearchInput } from '../types/search';

export const qk = {
  notes: (filter: NoteFilter) => ['notes', filter] as const,
  note: (id: Uuid) => ['note', id] as const,
  folders: () => ['folders'] as const,
  tags: () => ['tags'] as const,
  search: (input: SearchInput) => ['search', input] as const,
  syncStatus: () => ['sync-status'] as const,
  syncConflicts: () => ['sync-conflicts'] as const,
  appInfo: () => ['app-info'] as const,
};
