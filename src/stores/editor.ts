import { create } from 'zustand';
import type { Uuid } from '../types/note';

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export type EditorState = {
  noteId: Uuid | null;
  saveState: SaveState;
  subjectId: Uuid | null;
};

const INITIAL: EditorState = {
  noteId: null,
  saveState: 'saved',
  subjectId: null,
};

export const useEditorStore = create<EditorState>(() => ({ ...INITIAL }));

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