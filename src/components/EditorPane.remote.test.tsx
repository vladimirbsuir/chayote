import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPane } from './EditorPane';
import { qk } from '../queries/keys';
import { openNote, useEditorStore } from '../stores/editor';
import type { Note } from '../types/ipc';
import type { JsonDoc, Uuid } from '../types/note';

/* The editor must show what the list already shows, and never the old text
   first. The pane keys the TipTap instance by note id, so a saved document
   that changed underneath it — a sync pull that landed after the note opened
   from a stale cache entry, or a conflict resolution — either never reached
   the screen, or flashed the old text until the refetch landed. Found on a
   phone; the pane now waits for fresh data before the first paint and
   remounts on an external doc change made while clean. */

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
    /* Stale cache entry, fresh read held back: the only paint allowed before
       it lands is the placeholder — never the old text. */
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
    /* Generous timeout: under a full-suite run the TipTap first paint this
       performs can take longer than the 1 s default. */
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

    /* A sync pull (or Use-theirs) writes a new saved document; the refetch
       lands in the same query the list already read. */
    mocks.currentDoc = docOf('new text');
    await queryClient.invalidateQueries({ queryKey: qk.note(NOTE_ID) });

    /* Generous timeout, as above: this remounts TipTap. */
    await waitFor(
      () => {
        expect(editorText()).toBe('new text');
      },
      { timeout: 5000 },
    );
  });
});
