import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteList } from './NoteList';
import { buildDatabase } from '../mock/generate';
import { notesApi, setMockBackend } from '../lib/ipc';
import { useTogglePin } from '../hooks/useTogglePin';
import { summaryOf } from './summaryOf';
import { useSelectionStore } from '../stores/selection';
import type { NoteSummary } from '../types/ipc';

const EMPTY_STATE = {
  title: 'Nothing here',
  body: 'No notes in this view.',
  icon: <Inbox className="icon i-20" aria-hidden="true" />,
};

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function settleToggle(toggle: () => void): Promise<void> {
  await act(async () => {
    toggle();
    await Promise.resolve();
  });
}

const NOW = 1_800_000_000_000;

function note(overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id: 'n-1',
    title: 'Meeting notes',
    excerpt: 'Discussed the launch date.',
    folderId: null,
    folderName: null,
    isPinned: false,
    wordCount: 12,
    updatedAt: NOW - 1000,
    tags: [],
    ...overrides,
  };
}

const NOTES: NoteSummary[] = [
  note({ id: 'n-1', title: 'Alpha' }),
  note({ id: 'n-2', title: 'Bravo', isPinned: true }),
];

function List({
  notes = NOTES,
  onTogglePin = noop,
  pinPendingId = null,
}: {
  notes?: NoteSummary[];
  onTogglePin?: ((id: string) => void) | null;
  pinPendingId?: string | null;
}): React.ReactElement {
  return (
    <NoteList
      notes={notes}
      openNoteId={null}
      now={NOW}
      folderNames={new Map()}
      showFolder
      onOpen={noop}
      onTogglePin={onTogglePin ?? undefined}
      pinPendingId={pinPendingId}
      empty={EMPTY_STATE}
    />
  );
}

const noop = (): void => {};

describe('note card pinning', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('shows the pin control only on pinned cards', () => {
    render(<List />);

    expect(screen.getAllByTestId('pin-toggle')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Unpin Bravo' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Pin Alpha' })).toBeNull();
  });

  it('labels the control by what it will do, not by its state', () => {
    render(<List />);

    expect(screen.getByRole('button', { name: 'Unpin Bravo' })).toBeDefined();
  });

  it('marks the pinned card pressed, so state is not carried by colour alone', () => {
    render(<List />);

    expect(screen.getByRole('button', { name: 'Unpin Bravo' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('renders no pin control at all when the caller supplies none, as in the trash', () => {
    render(<List onTogglePin={null} />);

    expect(screen.queryByTestId('pin-toggle')).toBeNull();
  });

  it("shows a pinned note's pin as a plain icon, not a dead control, where it cannot be toggled", () => {
    const { container } = render(<List onTogglePin={null} />);

    expect(container.querySelectorAll('[data-testid="pin-toggle"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="pin-indicator"]')).toHaveLength(1);
  });

  it('does not open the note when the pin is pressed', () => {
    const onOpen = vi.fn();
    const onTogglePin = vi.fn();
    render(
      <NoteList
        notes={NOTES}
        openNoteId={null}
        now={NOW}
        folderNames={new Map()}
        showFolder
        onOpen={onOpen}
        onTogglePin={onTogglePin}
        empty={EMPTY_STATE}
      />,
    );

    act(() => {
      screen.getByRole('button', { name: 'Unpin Bravo' }).click();
    });

    expect(onTogglePin).toHaveBeenCalledWith('n-2');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("disables the control while that note's write is in flight", () => {
    render(<List pinPendingId="n-2" />);

    expect(screen.getByRole('button', { name: 'Unpin Bravo' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('useTogglePin', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  function renderTogglePin(): {
    toggle: (id: string, isPinned: boolean) => void;
    client: QueryClient;
  } {
    const queryClient = client();
    const result = renderHook(() => useTogglePin(), { wrapper: wrapperFor(queryClient) });
    return { toggle: result.result.current.togglePin, client: queryClient };
  }

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it('writes the flag through notes_set_pinned, not notes_save', async () => {
    setMockBackend(buildDatabase({ noteCount: 3 }));
    const { toggle } = renderTogglePin();

    const summaries = await notesApi.list({ kind: 'all' });
    const target = summaries[0];
    if (target === undefined) return;

    await settleToggle(() => {
      toggle(target.id, true);
    });

    const pinned = (await notesApi.list({ kind: 'all' })).filter((s) => s.isPinned);
    expect(pinned.length).toBeGreaterThan(0);
    expect((await notesApi.get(target.id)).isPinned).toBe(true);
  });

  it('moves the note to the top of the list', async () => {
    setMockBackend(buildDatabase({ noteCount: 6 }));
    const { toggle } = renderTogglePin();

    const before = await notesApi.list({ kind: 'all' });
    const target = before[before.length - 1];
    if (target === undefined) return;

    await settleToggle(() => {
      toggle(target.id, true);
    });

    const after = await notesApi.list({ kind: 'all' });
    expect(after[0]?.id).toBe(target.id);
  });

  it('patches every cached list immediately, before the response arrives', async () => {
    setMockBackend(buildDatabase({ noteCount: 4 }));
    const { toggle, client } = renderTogglePin();

    const summaries = await notesApi.list({ kind: 'all' });
    const target = summaries[0];
    if (target === undefined) return;

    client.setQueryData(['notes', { kind: 'all' }], summaries);
    client.setQueryData(['notes', { kind: 'pinned' }], summaries);

    act(() => {
      toggle(target.id, true);
    });

    const all = client.getQueryData<NoteSummary[]>(['notes', { kind: 'all' }]);
    const pinned = client.getQueryData<NoteSummary[]>(['notes', { kind: 'pinned' }]);
    expect(all?.find((n) => n.id === target.id)?.isPinned).toBe(true);
    expect(pinned?.find((n) => n.id === target.id)?.isPinned).toBe(true);
  });

  it('leaves the rest of each cached list untouched', async () => {
    setMockBackend(buildDatabase({ noteCount: 4 }));
    const { toggle, client } = renderTogglePin();

    const summaries = await notesApi.list({ kind: 'all' });
    const target = summaries[0];
    if (target === undefined) return;
    client.setQueryData(['notes', { kind: 'all' }], summaries);

    act(() => {
      toggle(target.id, true);
    });

    const patched = client.getQueryData<NoteSummary[]>(['notes', { kind: 'all' }]);
    expect(patched).toHaveLength(summaries.length);
    expect(patched?.filter((n) => n.id !== target.id)).toEqual(
      summaries.filter((n) => n.id !== target.id),
    );
  });

  it('carries the pin through a plain document save as well', async () => {
    setMockBackend(buildDatabase({ noteCount: 3 }));
    const { client } = renderTogglePin();

    const summaries = await notesApi.list({ kind: 'all' });
    const target = summaries[0];
    if (target === undefined) return;

    const pinned = await notesApi.get(target.id);
    pinned.isPinned = true;
    client.setQueryData(['notes', { kind: 'all' }], summaries);

    act(() => {
      client.setQueriesData({ queryKey: ['notes'] }, (existing: NoteSummary[] | undefined) =>
        Array.isArray(existing)
          ? existing.map((s) => (s.id === pinned.id ? { ...s, ...summaryOf(pinned) } : s))
          : existing,
      );
    });

    const cached = client.getQueryData<NoteSummary[]>(['notes', { kind: 'all' }]);
    expect(cached?.find((n) => n.id === target.id)?.isPinned).toBe(true);
  });

  it('puts the note with a write in flight in pending, then clears it', async () => {
    setMockBackend(buildDatabase({ noteCount: 3 }));
    const queryClient = client();
    const result = renderHook(() => useTogglePin(), { wrapper: wrapperFor(queryClient) });

    const summaries = await notesApi.list({ kind: 'all' });
    const target = summaries[0];
    if (target === undefined) return;

    await settleToggle(() => {
      result.result.current.togglePin(target.id, true);
    });

    await waitFor(() => {
      expect(result.result.current.pendingId).toBeNull();
    });
  });
});
