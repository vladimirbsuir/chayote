import type { NoteSummary, SelectionKind } from '../types/ipc';

export function compareSummaries(a: NoteSummary, b: NoteSummary): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

export function applySaveToList(
  existing: NoteSummary[],
  saved: NoteSummary,
  selectionKind: SelectionKind | undefined,
): NoteSummary[] {
  const patched = existing.map((summary) => (summary.id === saved.id ? { ...summary, ...saved } : summary));
  if (selectionKind === undefined || selectionKind === 'trash') return patched;
  return [...patched].sort(compareSummaries);
}
