import { create } from 'zustand';
import type { Selection } from '../types/ipc';
import type { NoteFilter } from '../types/ipc';
import type { Uuid } from '../types/note';

export type SelectionState = {
  selection: Selection;
  openNoteId: Uuid | null;
};

const INITIAL: SelectionState = {
  selection: { kind: 'all' },
  openNoteId: null,
};

export const useSelectionStore = create<SelectionState>(() => ({ ...INITIAL }));

export function selectionKey(selection: Selection): string {
  return selection.kind === 'all' || selection.kind === 'pinned' || selection.kind === 'trash'
    ? selection.kind
    : `${selection.kind}:${selection.id}`;
}

export function selectAll(): void {
  useSelectionStore.setState({ selection: { kind: 'all' } });
}

export function selectPinned(): void {
  useSelectionStore.setState({ selection: { kind: 'pinned' } });
}

export function selectTrash(): void {
  useSelectionStore.setState({ selection: { kind: 'trash' } });
}

export function selectFolder(id: Uuid): void {
  useSelectionStore.setState({ selection: { kind: 'folder', id } });
}

export function selectTag(id: Uuid): void {
  useSelectionStore.setState({ selection: { kind: 'tag', id } });
}

export function select(selection: Selection): void {
  useSelectionStore.setState({ selection });
}

export function openNote(id: Uuid | null): void {
  useSelectionStore.setState({ openNoteId: id });
}

export function filterOf(selection: Selection): NoteFilter {
  return selection;
}

export function isSelection(selection: Selection, kind: Selection['kind']): boolean {
  return selection.kind === kind;
}