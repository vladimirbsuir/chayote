import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Pin, Inbox } from 'lucide-react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NoteList } from './NoteList';
import { buildDatabase } from '../mock/generate';
import { setMockBackend } from '../lib/ipc';
import { hydrateSettings, useSettingsStore } from '../stores/settings';
import { openNote, useSelectionStore } from '../stores/selection';
import { notesApi } from '../lib/ipc';
import type { NoteSummary } from '../types/ipc';

const SEEDED_NOTES = 10_000;

const EMPTY_STATE = {
  title: 'Nothing here',
  body: 'No notes in this view.',
  icon: <Inbox className="icon i-20" aria-hidden="true" />,
};

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

async function seededSummaries(count: number): Promise<NoteSummary[]> {
  setMockBackend(buildDatabase({ noteCount: count }));
  return notesApi.list({ kind: 'all' });
}

describe('NoteList', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({ ...useSettingsStore.getState(), hydrated: false });
    void hydrateSettings();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('renders a row per note for a small list', async () => {
    const summaries = await seededSummaries(6);
    render(
      <QueryClientProvider client={client()}>
        <NoteList
          notes={summaries}
          openNoteId={null}
          now={Date.now()}
          folderNames={new Map()}
          showFolder
          onOpen={() => {}}
          empty={EMPTY_STATE}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="note-card"]')).toHaveLength(6);
    });
  });

  it('mounts a bounded number of cards at 10 000 notes', async () => {
    const summaries = await seededSummaries(SEEDED_NOTES);
    expect(summaries).toHaveLength(SEEDED_NOTES);

    render(
      <QueryClientProvider client={client()}>
        <NoteList
          notes={summaries}
          openNoteId={null}
          now={Date.now()}
          folderNames={new Map()}
          showFolder
          onOpen={() => {}}
          empty={EMPTY_STATE}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const cards = document.querySelectorAll('[data-testid="note-card"]');
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.length).toBeLessThan(60);
    });

    const container = screen.getByTestId('note-list');
    const spacer = container.firstElementChild as HTMLElement;
    const total = Number.parseFloat(spacer.style.height);

    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(SEEDED_NOTES * 200);
    expect(total).toBeGreaterThan(SEEDED_NOTES * 40);
  });

  it('carries no document body on a summary row', async () => {
    const summaries = await seededSummaries(3);
    render(
      <QueryClientProvider client={client()}>
        <NoteList
          notes={summaries}
          openNoteId={null}
          now={Date.now()}
          folderNames={new Map()}
          showFolder
          onOpen={() => {}}
          empty={EMPTY_STATE}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="note-card"]').length).toBeGreaterThan(0);
    });
    for (const key of Object.keys(summaries[0] ?? {})) {
      expect(key).not.toBe('doc');
    }
  });

  it('shows the selection-specific empty state instead of a listbox with no options', () => {
    render(
      <QueryClientProvider client={client()}>
        <NoteList
          notes={[]}
          openNoteId={null}
          now={Date.now()}
          folderNames={new Map()}
          showFolder
          onOpen={() => {}}
          empty={{
            title: 'Nothing pinned',
            body: 'Pin a note with Ctrl+D.',
            icon: <Pin className="icon i-20" aria-hidden="true" />,
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Nothing pinned')).toBeDefined();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('marks the open note with aria-selected', async () => {
    const summaries = await seededSummaries(3);
    openNote(summaries[1]?.id ?? null);
    render(
      <QueryClientProvider client={client()}>
        <NoteList
          notes={summaries}
          openNoteId={summaries[1]?.id ?? null}
          now={Date.now()}
          folderNames={new Map()}
          showFolder
          onOpen={() => {}}
          empty={EMPTY_STATE}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const selected = document.querySelectorAll('[aria-selected="true"]');
      expect(selected).toHaveLength(1);
    });
  });

  it('renders every card with its own border and surface, not as a continuous block', async () => {
    const summaries = await seededSummaries(3);
    render(
      <QueryClientProvider client={client()}>
        <NoteList
          notes={summaries}
          openNoteId={null}
          now={Date.now()}
          folderNames={new Map()}
          showFolder
          onOpen={() => {}}
          empty={EMPTY_STATE}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="note-card"]')).toHaveLength(3);
    });
    for (const card of Array.from(document.querySelectorAll('[data-testid="note-card"]'))) {
      expect(card.className).toContain('border-[var(--border)]');
      expect(card.className).toContain('bg-[var(--surface)]');
      expect(card.className).not.toContain('border-transparent');
    }
    const row = document.querySelector('[data-index="0"]');
    expect(row?.className).toContain('pb-2');
  });

  it('marks the open card with the accent border', async () => {
    const summaries = await seededSummaries(3);
    const openId = summaries[0]?.id ?? null;
    render(
      <QueryClientProvider client={client()}>
        <NoteList
          notes={summaries}
          openNoteId={openId}
          now={Date.now()}
          folderNames={new Map()}
          showFolder
          onOpen={() => {}}
          empty={EMPTY_STATE}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="note-card"]')).toHaveLength(3);
    });
    const open =
      openId === null
        ? null
        : document.querySelector(`[data-testid="note-card"][data-note-id="${openId}"]`);
    expect(open?.className).toContain('border-[var(--accent)]');
  });
});