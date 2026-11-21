import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPane } from './EditorPane';
import { qk } from '../queries/keys';
import { openNote, useEditorStore } from '../stores/editor';
import type { Note } from '../types/ipc';
import type { JsonDoc, Uuid } from '../types/note';

const NOTE_ID = '01980000-0000-7000-8000-0000000000aa' as Uuid;

function docOf(text: string): JsonDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const mocks = vi.hoisted(() => ({
  currentDoc: docOf('old text'),
  getNote: vi.fn(),
}));

vi.mock('../lib/ipc', () => ({
  notesApi: {
    get: (id: Uuid) => mocks.getNote(id) as Promise<Note>,
    save: () => Promise.reject(new Error('unexpected save')),
    setPinned: () => Promise.resolve(undefined),
  },
  tagsApi: {
    list: () => Promise.resolve([]),
    create: () => Promise.reject(new Error('unexpected tag create')),
  },
  foldersApi: {
    list: () => Promise.resolve([]),
  },
}));

function asNote(doc: JsonDoc): Note {
  return {
    id: NOTE_ID,
    title: 'Note',
    excerpt: '',
    folderId: null,
    folderName: null,
    isPinned: false,
    wordCount: 2,
    updatedAt: 1,
    tags: [],
    doc,
    createdAt: 0,
    deletedAt: null,
  };
}

function editorText(): string | null | undefined {
  return document.querySelector('[data-testid="note-editor"]')?.textContent;
}

describe('EditorPane external document change', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.currentDoc = docOf('old text');
    mocks.getNote.mockImplementation(() => Promise.resolve(asNote(mocks.currentDoc)));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    openNote(NOTE_ID);
  });

  afterEach(() => {
    cleanup();
    mocks.getNote.mockReset();
    useEditorStore.setState({ noteId: null, saveState: 'saved', subjectId: null });
  });

  function pane() {
    return render(
      <QueryClientProvider client={queryClient}>
        <EditorPane noteId={NOTE_ID} selectionKey="sel-1" />
      </QueryClientProvider>,
    );
  }

  it('never paints a stale cached document while the fresh read is in flight', async () => {
    queryClient.setQueryData(qk.note(NOTE_ID), asNote(docOf('old text')));
    let release!: (note: Note) => void;
    mocks.getNote.mockImplementation(
      () => new Promise<Note>((resolve) => void (release = resolve)),
    );
    pane();
    await waitFor(() => {
      expect(mocks.getNote).toHaveBeenCalled();
    });
    expect(editorText()).toBeUndefined();

    act(() => {
      release(asNote(docOf('new text')));
    });
    await waitFor(
      () => {
        expect(editorText()).toBe('new text');
      },
      { timeout: 5000 },
    );
  });

  it('adopts a saved document that changed underneath the mounted editor', async () => {
    pane();
    await waitFor(() => {
      expect(editorText()).toBe('old text');
    });

    mocks.currentDoc = docOf('new text');
    await queryClient.invalidateQueries({ queryKey: qk.note(NOTE_ID) });

    await waitFor(
      () => {
        expect(editorText()).toBe('new text');
      },
      { timeout: 5000 },
    );
  });
});
