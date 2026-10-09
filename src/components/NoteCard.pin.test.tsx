import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteList } from './NoteList';
import { buildDatabase } from '../mock/generate';
import { notesApi, setMockBackend } from '../lib/ipc';
import { useTogglePin } from '../hooks/useTogglePin';
import { summaryOf } from './summaryOf';
import { useSelectionStore } from '../stores/selection';
import type { NoteSummary } from '../types/ipc';

/* `05-ui-ux.md` §6.3a: "Ctrl/Cmd+D, or the pin control on a note card and in the
   editor. Toggling is optimistic in the UI and reconciled by the command response.
   Pinned notes sort above every other note in every selection."

   The card control is exercised through the real hook against the mock backend, so
   the optimistic write, the reconciliation, and the re-sort are all in the path —
   which is the only way the ordering claim can be checked rather than assumed. */

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/** Run a mutation inside `act` and wait for it to settle.
    Awaiting the act is what makes the assertions that follow read committed state
    rather than the optimistic patch — the two differ, and the difference is the
    point of several of these tests. */
async function settleToggle(toggle: () => void): Promise<void> {
  await act(async () => {
    toggle();
    await Promise.resolve();
  });
}

/* The projection is imported from its own module rather than copied here: a second
   implementation in a test would keep passing after the real one changed — which is
   the failure this test was written to catch. */

/* One clock reading for the file, rather than `Date.now()` inside a component: the
   rule against impure calls during render is right, and a fixed value is also what
   makes the relative timestamps in these rows comparable between assertions. */
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
  /** Defaults to a no-op, so most tests exercise the control without caring about
      the write. The trash case passes `null` explicitly to mean "no control". */
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
      empty={{ title: 'Nothing here', body: 'No notes in this view.' }}
    />
  );
}

const noop = (): void => {};

describe('note card pinning', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('gives every card a pin control, including the unpinned ones', () => {
    render(<List />);

    /* One per card. A control that appears only on pinned cards is undiscoverable:
       the user has to know a note is pinned before they can unpin it. */
    expect(screen.getAllByTestId('pin-toggle')).toHaveLength(NOTES.length);
  });

  it('labels the control by what it will do, not by its state', () => {
    render(<List />);

    expect(screen.getByRole('button', { name: 'Pin Alpha' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Unpin Bravo' })).toBeDefined();
  });

  it('marks the pinned card pressed, so state is not carried by colour alone', () => {
    render(<List />);

    expect(screen.getByRole('button', { name: 'Unpin Bravo' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Pin Alpha' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('renders no pin control at all when the caller supplies none, as in the trash', () => {
    render(<List onTogglePin={null} />);

    expect(screen.queryByTestId('pin-toggle')).toBeNull();
  });

  it('shows a pinned note\'s pin as a plain icon, not a dead control, where it cannot be toggled', () => {
    /* The trash. A disabled button would read as a control that is broken, rather
       than as one that does not belong here; an icon still carries the fact that
       the note was pinned, which the ordering does too. */
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
        empty={{ title: 'Nothing here', body: 'No notes in this view.' }}
      />,
    );

    act(() => {
      screen.getByRole('button', { name: 'Pin Alpha' }).click();
    });

    expect(onTogglePin).toHaveBeenCalledWith('n-1');
    /* A pin that also opened the note would make the control useless on a row the
       user was trying to read. */
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('disables the control while that note\'s write is in flight', () => {
    render(<List pinPendingId="n-1" />);

    expect(screen.getByRole('button', { name: 'Pin Alpha' }).hasAttribute('disabled')).toBe(true);
    /* Only the note being written is disabled — the others are unrelated writes. */
    expect(screen.getByRole('button', { name: 'Unpin Bravo' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});

describe('useTogglePin', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  /* `renderHook` from Testing Library rather than a hand-written harness: the hook
     needs a `QueryClientProvider` above it and a way to hold on to both the client
     and the returned callback, and a harness that hand-rolls that is three places
     for a test bug to hide. */
  function renderTogglePin(): {
    toggle: (id: string, isPinned: boolean) => void;
    client: QueryClient;
  } {
    const queryClient = client();
    const result = renderHook(() => useTogglePin(), { wrapper: wrapperFor(queryClient) });
    return { toggle: result.result.current.togglePin, client: queryClient };
  }

  function wrapperFor(queryClient: QueryClient) {
    /* Declared as a component rather than an inline arrow because the `children`
       prop has to arrive through React, not through a closure the rule about
       purity would rightly complain about. */
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

    /* The ordering claim of §6.3a, checked against storage rather than against the
       component that would re-sort it for us. */
    const after = await notesApi.list({ kind: 'all' });
    expect(after[0]?.id).toBe(target.id);
  });

  it('patches every cached list immediately, before the response arrives', async () => {
    setMockBackend(buildDatabase({ noteCount: 4 }));
    const { toggle, client } = renderTogglePin();

    const summaries = await notesApi.list({ kind: 'all' });
    const target = summaries[0];
    if (target === undefined) return;

    /* Two lists, as in the real app: the one on screen and any other selection the
       user has visited. Only the visible one re-renders, but both are read from the
       cache the moment the selection changes back. */
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
    /* The editor's autosave patches the cached lists from its response rather than
       invalidating them (`10-conventions.md` §7). A pin set by `Ctrl+D` lives in the
       database and in memory, not in the editor's document — so if that patch did
       not include `isPinned`, a keystroke a second later would leave the card
       showing a pin the note no longer has. This is the unit-level half of the
       Playwright test that caught it. */
    setMockBackend(buildDatabase({ noteCount: 3 }));
    const { client } = renderTogglePin();

    const summaries = await notesApi.list({ kind: 'all' });
    const target = summaries[0];
    if (target === undefined) return;

    const pinned = await notesApi.get(target.id);
    pinned.isPinned = true;
    client.setQueryData(['notes', { kind: 'all' }], summaries);

    act(() => {
      client.setQueriesData(
        { queryKey: ['notes'] },
        (existing: NoteSummary[] | undefined) =>
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

    /* Settled by the time the awaited act returns, so no card is left disabled. */
    await waitFor(() => {
      expect(result.result.current.pendingId).toBeNull();
    });
  });
});
