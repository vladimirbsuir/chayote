import { create } from 'zustand';
import type { Selection } from '../types/ipc';
import type { NoteFilter } from '../types/ipc';
import type { Uuid } from '../types/note';

/* The selection model of `05-ui-ux.md` §5: exactly one of all, pinned, folder,
   tag, or trash is active at a time. Selecting a folder is exclusive with
   selecting a tag or filter — there is no multi-select and no "all notes plus
   this folder".

   This store holds only which list is showing. The notes themselves are server
   state owned by TanStack Query (`02-architecture.md` §5), so nothing here is a
   copy of a note list. */

export type SelectionState = {
  selection: Selection;
  /** The note open in the editor, or `null`. Separate from `selection` — a note
      stays open when the selection changes (`05-ui-ux.md` §5). */
  openNoteId: Uuid | null;
};

const INITIAL: SelectionState = {
  selection: { kind: 'all' },
  openNoteId: null,
};

export const useSelectionStore = create<SelectionState>(() => ({ ...INITIAL }));

/** Stable string identity for a selection, used as an effect dependency and as
    the editor's flush key (`04-editor.md` §5.1). Two selections that would
    produce the same `notes_list` call must produce the same string. */
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

/** The `notes_list` filter for a selection. `limit` is left off: the list is
    virtualised over a single page, and `notes_list` caps at the corpus size
    (`03-data-model.md` §8 assumes 10 000 notes). */
export function filterOf(selection: Selection): NoteFilter {
  return selection;
}

/** Human name for the list header (`05-ui-ux.md` §2.2), resolved outside this
    store because it needs the folder and tag tables to have a name for an id. */
export function isSelection(selection: Selection, kind: Selection['kind']): boolean {
  return selection.kind === kind;
}