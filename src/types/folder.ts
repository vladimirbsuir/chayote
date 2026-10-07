import type { Uuid } from './note';

export type FolderNode = {
  id: Uuid;
  name: string;
  parentId: Uuid | null;
  position: number;
  children: FolderNode[];
};
