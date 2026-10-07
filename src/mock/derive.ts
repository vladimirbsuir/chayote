import type { Uuid, JsonDoc } from '../types/note';
import type { Note, NoteSummary } from '../types/ipc';
import type { FolderNode } from '../types/folder';

export type MockFolder = {
  id: Uuid;
  name: string;
  parentId: Uuid | null;
  position: number;
};

export type MockTag = { id: Uuid; name: string };

export type MockNote = {
  id: Uuid;
  doc: JsonDoc;
  folderId: Uuid | null;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  tagIds: Uuid[];
};

export type MockDatabase = {
  notes: MockNote[];
  folders: MockFolder[];
  tags: MockTag[];
};

export function textOf(node: JsonDoc): string {
  if (typeof node.text === 'string') return node.text;
  if (!node.content) return '';
  return node.content.map(textOf).join('');
}

export function plainTextOf(node: JsonDoc): string {
  const parts: string[] = [];
  const walk = (current: JsonDoc): void => {
    if (typeof current.text === 'string') {
      parts.push(current.text);
      return;
    }
    if (current.type === 'hardBreak') {
      parts.push('\n');
      return;
    }
    current.content?.forEach(walk);
    if (isBlock(current.type) && current.type !== 'doc') parts.push('\n');
  };
  walk(node);
  return parts.join('');
}

const INLINE_ONLY = new Set(['text', 'hardBreak']);

function isBlock(type: string): boolean {
  return !INLINE_ONLY.has(type);
}

export function firstNonEmptyText(doc: JsonDoc): string {
  for (const block of doc.content ?? []) {
    const text = textOf(block).trim();
    if (text.length > 0) return text;
  }
  return '';
}

export function deriveTitle(doc: JsonDoc): string {
  const raw = firstNonEmptyText(doc);
  if (raw.length === 0) return 'Untitled';
  if (raw.length <= 120) return raw;
  const clipped = raw.slice(0, 120);
  const lastSpace = clipped.lastIndexOf(' ');
  return lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
}

export function deriveExcerpt(plain: string): string {
  const collapsed = plain.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 200) return collapsed;
  const clipped = collapsed.slice(0, 200);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped}…`;
}

export function deriveWordCount(plain: string): number {
  const trimmed = plain.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function toTree(folders: MockFolder[]): FolderNode[] {
  const build = (parentId: Uuid | null): FolderNode[] =>
    folders
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        position: folder.position,
        children: build(folder.id),
      }));
  return build(null);
}

export function toSummary(note: MockNote, db: MockDatabase): NoteSummary {
  const plain = plainTextOf(note.doc);
  return {
    id: note.id,
    title: deriveTitle(note.doc),
    excerpt: deriveExcerpt(plain),
    folderId: note.folderId,
    folderName: db.folders.find((folder) => folder.id === note.folderId)?.name ?? null,
    isPinned: note.isPinned,
    wordCount: deriveWordCount(plain),
    updatedAt: note.updatedAt,
    tags: note.tagIds
      .map((tagId) => db.tags.find((tag) => tag.id === tagId))
      .filter((tag): tag is MockTag => tag !== undefined)
      .map((tag) => ({ id: tag.id, name: tag.name })),
  };
}

export function toNote(note: MockNote, db: MockDatabase): Note {
  return {
    ...toSummary(note, db),
    doc: note.doc,
    createdAt: note.createdAt,
    deletedAt: note.deletedAt,
  };
}
