import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNoteTitle } from './useNoteTitle';
import { qk } from '../queries/keys';
import type { Note, NoteSummary } from '../types/ipc';

/* ADR-023. What matters here is not that the hook calls the command — that is one
   line — but the three things around it, each of which is a way a title can be
   lost or shown in the wrong place:

   - A typing burst is one write, not one per keystroke.
   - A burst in flight when something else needs the title flushed is not dropped.
     This is the half that matters: the field has no autosave controller behind it,
     so nothing else will ever flush it.
   - The response replaces the open note and every cached list, because
     `updated_at` moves with the title and the lists order by it. A patch that left
     the timestamp stale would put the note back where it was. */

const calls: { id: string; title: string }[] = [];

vi.mock('../lib/ipc', () => ({
  notesApi: {
    setTitle: (id: string, title: string): Promise<Note> => {
      calls.push({ id, title });
      return Promise.resolve(note(id, title));
    },
  },
}));

const ID = '01980000-0000-7000-8000-000000000001';

function summary(id: string, title: string, updatedAt: number): NoteSummary {
  return {
    id,
    title,
    excerpt: '',
    folderId: null,
    folderName: null,
    isPinned: false,
    wordCount: 0,
    updatedAt,
    tags: [],
  };
}

function note(id: string, title: string): Note {
  return {
    ...summary(id, title, 4242),
    doc: { type: 'doc', content: [] },
    createdAt: 0,
    deletedAt: null,
  };
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function clientWith(notes: NoteSummary[]): QueryClient {
  const client = new QueryClient();
  client.setQueryData(qk.note(ID), note(ID, 'Before'));
  client.setQueryData(['notes', { kind: 'all' }], notes);
  return client;
}

afterEach(() => {
  calls.length = 0;
  vi.useRealTimers();
});

describe('useNoteTitle', () => {
  it('turns a typing burst into a single write', async () => {
    vi.useFakeTimers();
    const client = clientWith([]);
    const { result } = renderHook(() => useNoteTitle(), { wrapper: wrapper(client) });

    result.current.write(ID, 'P');
    result.current.write(ID, 'Pl');
    result.current.write(ID, 'Plan');
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toEqual([{ id: ID, title: 'Plan' }]);
  });

  it('flushes what a burst left pending rather than dropping it', async () => {
    const client = clientWith([]);
    const { result } = renderHook(() => useNoteTitle(), { wrapper: wrapper(client) });

    result.current.write(ID, 'Half typed');
    /* Far less than the 800 ms debounce. The field loses focus, the note is
       switched, the sync engine drains — anything that means "last chance". */
    result.current.flush();

    await waitFor(() => {
      expect(calls).toEqual([{ id: ID, title: 'Half typed' }]);
    });
  });

  it('does not write when there is nothing pending', () => {
    const client = clientWith([]);
    const { result } = renderHook(() => useNoteTitle(), { wrapper: wrapper(client) });

    result.current.flush();
    expect(calls).toHaveLength(0);
  });

  it('puts the saved title on the open note and on every cached list', async () => {
    const client = clientWith([
      summary(ID, 'Before', 1),
      summary('01980000-0000-7000-8000-000000000002', 'Other', 1),
    ]);
    const { result } = renderHook(() => useNoteTitle(), { wrapper: wrapper(client) });

    result.current.flush();
    result.current.write(ID, 'After');
    result.current.flush();

    await waitFor(() => {
      expect(client.getQueryData<Note>(qk.note(ID))?.title).toBe('After');
    });
    const lists = client.getQueryData<NoteSummary[]>(['notes', { kind: 'all' }]);
    expect(lists?.[0]?.title).toBe('After');
    expect(lists?.[0]?.updatedAt).toBe(4242);
    /* The other note is not touched: a patch that rewrote every row would be a
       second list re-sort nobody asked for. */
    expect(lists?.[1]?.title).toBe('Other');
    expect(lists?.[1]?.updatedAt).toBe(1);
  });

  it('flushes on unmount, so a title typed and closed is not lost', async () => {
    const client = clientWith([]);
    const { result, unmount } = renderHook(() => useNoteTitle(), { wrapper: wrapper(client) });

    result.current.write(ID, 'Written and abandoned');
    unmount();

    await waitFor(() => {
      expect(calls).toEqual([{ id: ID, title: 'Written and abandoned' }]);
    });
  });
});
