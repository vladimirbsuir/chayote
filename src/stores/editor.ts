import { create } from 'zustand';
import type { Uuid } from '../types/note';

/* The autosave state machine of `04-editor.md` §5.2, and nothing else. §7 lists
   what the status bar shows; this store holds the two things that are not the
   editor's own — which note is open, and where the write path has got to. The
   document itself belongs to TipTap (`10-conventions.md` §7) and is never
   stored here.

   The save state carries the note id so that a failure on a note the user has
   already left does not paint the status bar of the note now open. */

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export type EditorState = {
  noteId: Uuid | null;
  saveState: SaveState;
  /** The note the current `saveState` refers to, or `null` for no note. */
  subjectId: Uuid | null;
};

const INITIAL: EditorState = {
  noteId: null,
  saveState: 'saved',
  subjectId: null,
};

export const useEditorStore = create<EditorState>(() => ({ ...INITIAL }));

/** `saveState` as the status bar should show it for the note now open. */
export function selectSaveState(state: EditorState, noteId: Uuid | null): SaveState {
  if (noteId === null || state.subjectId !== noteId) return 'saved';
  return state.saveState;
}

export function openNote(noteId: Uuid | null): void {
  useEditorStore.setState({ noteId, saveState: 'saved', subjectId: noteId });
}

function transition(noteId: Uuid | null, saveState: SaveState): void {
  useEditorStore.setState({ noteId, saveState, subjectId: noteId });
}

export function markUnsaved(noteId: Uuid | null): void {
  const state = useEditorStore.getState();
  if (state.subjectId === noteId && state.saveState === 'unsaved') return;
  transition(noteId, 'unsaved');
}

export function markSaving(noteId: Uuid | null): void {
  transition(noteId, 'saving');
}

export function markSaved(noteId: Uuid | null): void {
  const state = useEditorStore.getState();
  if (state.saveState === 'saving' || state.saveState === 'unsaved') transition(noteId, 'saved');
}

export function markSaveFailed(noteId: Uuid | null): void {
  transition(noteId, 'error');
}