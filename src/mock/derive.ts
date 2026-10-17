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
  /** ADR-023: a title the user typed. Empty, and therefore ignored, unless
      `titleSource` says otherwise — which is how `notes` works in SQLite. */
  title: string;
  titleSource: 'auto' | 'manual';
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

/** The same cap `deriveTitle` applies, shared so a typed title and a derived one
    cannot end up different sizes. `03-data-model.md` §4.1. */
const MAX_TITLE = 120;

export function capTitle(text: string): string {
  /* Code points, not UTF-16 units, so the cap cannot land in the middle of a
     character — the same reason the Rust side caps with `chars().take`. */
  const characters = Array.from(text);
  if (characters.length <= MAX_TITLE) return text;
  const clipped = characters.slice(0, MAX_TITLE).join('');
  const lastSpace = clipped.lastIndexOf(' ');
  return lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
}

export function deriveTitle(doc: JsonDoc): string {
  const raw = firstNonEmptyText(doc);
  if (raw.length === 0) return 'Untitled';
  return capTitle(raw);
}

/** `03-data-model.md` §4.1 as the browser backend implements it: a typed title
    wins, and everything else is derived from the document. Mirrors
    `services/derive.rs`, including the 120-character cap. */
export function titleOf(note: MockNote): string {
  if (note.titleSource === 'manual' && note.title.length > 0) return note.title;
  return deriveTitle(note.doc);
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
    title: titleOf(note),
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
