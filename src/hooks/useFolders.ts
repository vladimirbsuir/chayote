import { useQuery } from '@tanstack/react-query';
import type { FolderNode } from '../types/folder';
import { foldersApi } from '../lib/ipc';
import { qk } from '../queries/keys';

export function useFolders(): { folders: FolderNode[] | undefined } {
  const query = useQuery({ queryKey: qk.folders(), queryFn: foldersApi.list });
  return { folders: query.data };
}

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