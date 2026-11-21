import type { Note, NoteSummary } from '../types/ipc';

export function summaryOf(note: Note): NoteSummary {
  const { id, title, excerpt, folderId, folderName, isPinned, wordCount, updatedAt, tags } = note;
  return { id, title, excerpt, folderId, folderName, isPinned, wordCount, updatedAt, tags };
}