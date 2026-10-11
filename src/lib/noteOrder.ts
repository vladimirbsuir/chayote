import type { NoteSummary, SelectionKind } from '../types/ipc';

/* The list ordering the backend applies to every live selection
   (`03-data-model.md` §5, `repo/notes.rs` `DEFAULT_ORDER`): pinned first,
   then most recently updated.

   The editor patches a save response into the cached lists in place
   (`10-conventions.md` §7 — no refetch per save), and patching without
   re-sorting strands the edited note mid-list although its `updated_at` just
   moved it to the top. So the patch re-sorts with this comparator. Search
   pages order by `bm25` relevance and live under a different query-key prefix,
   so they never reach it; trash lists order by `deleted_at`, which a save
   cannot change and summaries do not carry, so they keep patch order. */

export function compareSummaries(a: NoteSummary, b: NoteSummary): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

/** Patches a save response into one cached list and re-sorts it, unless the
    selection's ordering is one a save cannot move. Returns a new array; the
    input is never mutated, so a cache entry handed elsewhere stays intact. */
export function applySaveToList(
  existing: NoteSummary[],
  saved: NoteSummary,
  selectionKind: SelectionKind | undefined,
): NoteSummary[] {
  const patched = existing.map((summary) => (summary.id === saved.id ? { ...summary, ...saved } : summary));
  if (selectionKind === undefined || selectionKind === 'trash') return patched;
  return [...patched].sort(compareSummaries);
}
