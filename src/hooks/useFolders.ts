import { useQuery } from '@tanstack/react-query';
import type { FolderNode } from '../types/folder';
import { foldersApi } from '../lib/ipc';
import { qk } from '../queries/keys';

/* Folders load once and are cached; they change rarely
   (`10-conventions.md` §8). Both are needed as early as the sidebar, because a
   selection can name a folder. */

export function useFolders(): { folders: FolderNode[] | undefined } {
  const query = useQuery({ queryKey: qk.folders(), queryFn: foldersApi.list });
  return { folders: query.data };
}

/** Flatten a folder tree to `id → name` for the note list's folder chip and the
    list header. Built in the component tree rather than in Rust because the tree
    arrives as a tree (`02-architecture.md` §7) and the mapping is presentation. */
export function folderNamesById(nodes: FolderNode[]): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (list: FolderNode[]): void => {
    for (const node of list) {
      names.set(node.id, node.name);
      walk(node.children);
    }
  };
  walk(nodes);
  return names;
}

/** Number of live notes directly in a folder, excluding the subtree — the same
    scope as `notes_list` for a folder selection (`05-ui-ux.md` §5). */
export function countByFolder(
  notes: ReadonlyArray<{ folderId: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.folderId === null) continue;
    counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1);
  }
  return counts;
}