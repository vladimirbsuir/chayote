import type { Uuid, JsonDoc } from './note';
import type { FolderNode } from './folder';
import type { TagWithCount } from './tag';
import type { SearchInput, SearchPage } from './search';

/* Domain shapes crossing the IPC boundary. Rust structs carry
   #[serde(rename_all = "camelCase")], so every field is camelCase here.
   `Selection` and `NoteFilter` are `#[serde(flatten)]` on the Rust side, so
   they serialise as `{"kind": "folder", "id": "..."}` rather than nested. */

export type SelectionKind = 'all' | 'pinned' | 'folder' | 'tag' | 'trash';

export type Selection =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'folder'; id: Uuid }
  | { kind: 'tag'; id: Uuid }
  | { kind: 'trash' };

export type NoteFilter = Selection & {
  limit?: number;
  offset?: number;
};

export type NoteSummary = {
  id: Uuid;
  title: string;
  excerpt: string;
  folderId: Uuid | null;
  folderName: string | null;
  isPinned: boolean;
  wordCount: number;
  updatedAt: number;
  tags: Array<{ id: Uuid; name: string }>;
};

export type Note = NoteSummary & {
  doc: JsonDoc;
  createdAt: number;
  deletedAt: number | null;
};

export type SaveNoteInput = {
  id: Uuid;
  doc: JsonDoc;
  folderId: Uuid | null;
  tagIds: Uuid[];
  isPinned: boolean;
};

/* The complete v1 command surface, mirroring 02-architecture.md §7.
   Adding a command requires updating that table and this file together. */

export type AppErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

export type CommandName =
  | 'notes_list'
  | 'notes_get'
  | 'notes_create'
  | 'notes_save'
  | 'notes_move'
  | 'notes_soft_delete'
  | 'notes_restore'
  | 'notes_destroy'
  | 'notes_empty_trash'
  | 'folders_list'
  | 'folders_create'
  | 'folders_rename'
  | 'folders_move'
  | 'folders_delete'
  | 'tags_list'
  | 'tags_create'
  | 'tags_rename'
  | 'tags_delete'
  | 'search_query'
  | 'window_ready';

export type CommandArgs = {
  notes_list: { filter: NoteFilter };
  notes_get: { id: Uuid };
  notes_create: { folderId: Uuid | null };
  notes_save: { input: SaveNoteInput };
  notes_move: { id: Uuid; folderId: Uuid | null };
  notes_soft_delete: { id: Uuid };
  notes_restore: { id: Uuid };
  notes_destroy: { id: Uuid };
  notes_empty_trash: Record<string, never>;
  folders_list: Record<string, never>;
  folders_create: { name: string; parentId: Uuid | null };
  folders_rename: { id: Uuid; name: string };
  folders_move: { id: Uuid; newParentId: Uuid | null; position: number };
  folders_delete: { id: Uuid };
  tags_list: Record<string, never>;
  tags_create: { name: string };
  tags_rename: { id: Uuid; name: string };
  tags_delete: { id: Uuid };
  search_query: { input: SearchInput };
  window_ready: Record<string, never>;
};

export type CommandOutput = {
  notes_list: NoteSummary[];
  notes_get: Note;
  notes_create: Note;
  notes_save: Note;
  notes_move: Note;
  notes_soft_delete: undefined;
  notes_restore: undefined;
  notes_destroy: undefined;
  notes_empty_trash: number;
  folders_list: FolderNode[];
  folders_create: FolderNode;
  folders_rename: FolderNode;
  folders_move: FolderNode;
  folders_delete: undefined;
  tags_list: TagWithCount[];
  tags_create: TagWithCount;
  tags_rename: TagWithCount;
  tags_delete: undefined;
  search_query: SearchPage;
  window_ready: undefined;
};

export type Backend = {
  invoke<C extends CommandName>(command: C, args: CommandArgs[C]): Promise<CommandOutput[C]>;
};
