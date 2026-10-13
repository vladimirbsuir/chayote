import { fireEvent, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteList } from './NoteList';
import { UndoToast } from './UndoToast';
import { UNDO_WINDOW_MS, useUndoToast } from './useUndoToast';
import { buildDatabase } from '../mock/generate';
import { notesApi, setMockBackend } from '../lib/ipc';
import { useSelectionStore } from '../stores/selection';
import type { NoteSummary } from '../types/ipc';

/* `05-ui-ux.md` §6.2: "Delete moves the note to trash with an undo toast for 6
   seconds offering 'Undo'. The soft delete is already persisted; undo simply
   restores. Permanent delete and empty trash require `ConfirmDialog`."

   What is asserted here is the *contract between the list and the actions*, because
   that is where the two can drift: a row offering permanent delete in a live list is
   the failure this whole milestone cares about, and it is invisible until someone
   clicks it. */

const NOW = 1_800_000_000_000;

const EMPTY_STATE = {
  title: 'Trash is empty',
  body: 'Deleted notes stay in the trash until you empty it.',
  icon: <Inbox className="icon i-20" aria-hidden="true" />,
};

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

const noop = (): void => {};

function List(props: {
  notes?: NoteSummary[];
  onPin?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDestroy?: (id: string) => void;
}): React.ReactElement {
  return (
    <NoteList
      notes={props.notes ?? [note()]}
      openNoteId={null}
      now={NOW}
      folderNames={new Map()}
      showFolder
      onOpen={noop}
      onTogglePin={props.onPin}
      onDeleteNote={props.onDelete}
      onRestoreNote={props.onRestore}
      onDestroyNote={props.onDestroy}
      empty={EMPTY_STATE}
    />
  );
}

/** Open a card's menu the way a user does: hover the row, then press the button.
    `force` is not used — §9 keeps the control at `pointer: fine` on hover, so the
    row has to be hovered for the button to be laid out at all. */
function openMenuFor(id: string): void {
  const card = document.querySelector(`[data-testid="note-card"][data-note-id="${id}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no card ${id}`);
  fireEvent.click(card.querySelector('[data-testid="note-menu-button"]') ?? card);
}

describe('note row actions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('offers no menu at all when the caller supplies no actions', () => {
    render(<List />);

    expect(screen.queryByTestId('note-menu-button')).toBeNull();
    expect(screen.queryByTestId('note-menu')).toBeNull();
  });

  it('offers pin and move to trash, and nothing else, in a live list', () => {
    const onDelete = vi.fn();
    render(<List onPin={noop} onDelete={onDelete} />);

    openMenuFor('n-1');

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Pin note');
    expect(items[1]?.textContent).toContain('Move to trash');
  });

  it('offers restore and permanent delete, and no soft delete, in the trash', () => {
    render(<List onRestore={noop} onDestroy={noop} />);

    openMenuFor('n-1');

    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Restore');
    expect(labels[1]).toContain('Delete permanently');
    /* §6.2: a note already in the trash cannot be moved to the trash again. */
    expect(labels.some((label) => label.includes('Move to trash'))).toBe(false);
    /* The pin of a deleted note is not actionable anywhere, menu included. */
    expect(screen.queryByTestId('note-menu-pin')).toBeNull();
  });

  it('names the pin item for the state it will leave, like the editor menu', () => {
    render(<List notes={[note({ isPinned: true })]} onPin={noop} onDelete={noop} />);

    openMenuFor('n-1');

    expect(screen.getByTestId('note-menu-pin').textContent).toContain('Unpin note');
  });

  it('pins through the menu for the note the row is about', () => {
    const onPin = vi.fn();
    render(<List onPin={onPin} onDelete={noop} />);

    openMenuFor('n-1');
    fireEvent.click(screen.getByTestId('note-menu-pin'));

    expect(onPin).toHaveBeenCalledWith('n-1');
    expect(screen.queryByTestId('note-menu')).toBeNull();
  });

  it('calls the handler it was given, for the note the row is about', () => {
    const onDelete = vi.fn();
    render(<List onDelete={onDelete} />);

    openMenuFor('n-1');
    fireEvent.click(screen.getByTestId('note-menu-delete'));

    expect(onDelete).toHaveBeenCalledWith('n-1');
  });

  it('labels the menu with the note it acts on, so a verb is never ambiguous', () => {
    render(<List notes={[note({ id: 'n-1', title: 'Reading list' })]} onDelete={noop} />);

    openMenuFor('n-1');

    expect(screen.getByRole('menu', { name: 'Reading list actions' })).toBeDefined();
  });

  it('uses "Untitled" in the menu label for an unnamed note, as the list does', () => {
    render(<List notes={[note({ id: 'n-1', title: '' })]} onDelete={noop} />);

    openMenuFor('n-1');

    expect(screen.getByRole('menu', { name: 'Untitled actions' })).toBeDefined();
  });

  it('paints move to trash in the danger token, like the editor menu', () => {
    render(<List onPin={noop} onDelete={noop} />);

    openMenuFor('n-1');

    expect(screen.getByTestId('note-menu-delete').className).toContain('var(--danger)');
  });

  it('renders the menu itself unselectable so a hold presses, never selects', () => {
    render(<List onPin={noop} onDelete={noop} />);

    openMenuFor('n-1');

    expect(screen.getByTestId('note-menu').className).toContain('select-none');
  });

  it('paints permanent delete in the danger token and restore not', () => {
    render(<List onRestore={noop} onDestroy={noop} />);

    openMenuFor('n-1');

    expect(screen.getByTestId('note-menu-destroy').className).toContain('var(--danger)');
    expect(screen.getByTestId('note-menu-restore').className).not.toContain('var(--danger)');
  });

  it('returns focus to the row when the menu closes on Escape', () => {
    render(<List onDelete={noop} />);
    openMenuFor('n-1');

    fireEvent.keyDown(screen.getByTestId('note-menu'), { key: 'Escape' });

    expect(screen.queryByTestId('note-menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('note-card'));
  });

  it('moves between items with the arrow keys', () => {
    render(<List onRestore={noop} onDestroy={noop} />);
    openMenuFor('n-1');

    fireEvent.keyDown(screen.getByTestId('note-menu'), { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getByTestId('note-menu-destroy'));
  });

  it('closes on a click outside', () => {
    render(<List onDelete={noop} />);
    openMenuFor('n-1');

    fireEvent.click(document.body);

    expect(screen.queryByTestId('note-menu')).toBeNull();
  });

  it('closes by itself when the note changes, so its actions cannot hit the wrong row', () => {
    const { rerender } = render(<List onDelete={noop} />);
    openMenuFor('n-1');
    expect(screen.getByTestId('note-menu')).toBeDefined();

    /* A delete re-sorts the list, and the card at this position may now be a
       different note. The menu is keyed by the note's id and timestamp, so it simply
       stops matching rather than needing an effect to close it. */
    rerender(
      <List
        notes={[note({ id: 'n-1', title: 'Meeting notes', updatedAt: NOW - 10 })]}
        onDelete={noop}
      />,
    );

    expect(screen.queryByTestId('note-menu')).toBeNull();
  });

  it('does not open the note when the menu button is pressed', () => {
    const onOpen = vi.fn();
    render(
      <NoteList
        notes={[note()]}
        openNoteId={null}
        now={NOW}
        folderNames={new Map()}
        showFolder
        onOpen={onOpen}
        onDeleteNote={noop}
        empty={EMPTY_STATE}
      />,
    );

    openMenuFor('n-1');

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the menu from a right-click, the path a touch long-press takes', () => {
    /* On the device a hold fires `contextmenu` — the WebView recognises the
       adb swipe-hold, and the folder rows already open their menu this way. The
       note rows answered it with a text selection, which is the gap: the menu
       button is `pointer:fine`-only, so on touch there was no other path. */
    render(<List onRestore={noop} onDestroy={noop} />);

    fireEvent.contextMenu(screen.getByTestId('note-card'));

    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Restore');
    expect(labels[1]).toContain('Delete permanently');
  });

  it('asks for no menu on right-click when the caller supplies no actions', () => {
    render(<List />);

    fireEvent.contextMenu(screen.getByTestId('note-card'));

    expect(screen.queryByTestId('note-menu')).toBeNull();
  });

  it('does not open the note on the click that ends a long-press, but does after', () => {
    /* The release after the hold synthesises a click. Without the guard the row
       opens the note under the menu it just opened; with it, exactly that one
       click is eaten — and as an outside click it also dismisses the menu — so
       the next real click opens as usual. */
    const onOpen = vi.fn();
    render(
      <NoteList
        notes={[note()]}
        openNoteId={null}
        now={NOW}
        folderNames={new Map()}
        showFolder
        onOpen={onOpen}
        onDeleteNote={noop}
        empty={EMPTY_STATE}
      />,
    );

    const card = screen.getByTestId('note-card');
    fireEvent.contextMenu(card);
    expect(screen.getByTestId('note-menu')).toBeDefined();

    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByTestId('note-menu')).toBeNull();

    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('n-1');
  });

  it('opens the menu from the ContextMenu key, per the §7 shortcut table', () => {
    render(<List onDelete={noop} />);

    fireEvent.keyDown(screen.getByTestId('note-card'), { key: 'ContextMenu' });

    expect(screen.getByTestId('note-menu')).toBeDefined();
    expect(screen.getByTestId('note-menu-delete')).toBeDefined();
  });

  it('keeps only one menu open: a second row replaces the first', () => {
    /* Found on a phone: long-pressing a second row left the first menu up, so
       two portalled menus overlapped. The state lives in the list now, and
       opening for another row replaces rather than adds. */
    render(
      <List
        notes={[note({ id: 'n-1', title: 'First' }), note({ id: 'n-2', title: 'Second' })]}
        onDelete={noop}
      />,
    );

    const cards = screen.getAllByTestId('note-card');
    const first = cards[0];
    const second = cards[1];
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
      throw new Error('expected two cards');
    }
    fireEvent.contextMenu(first);
    expect(screen.getByRole('menu', { name: 'First actions' })).toBeDefined();

    fireEvent.contextMenu(second);

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menu', { name: 'Second actions' })).toBeDefined();
  });

  it('closes the menu when an action runs, before anything else changes', () => {
    /* Found on a phone: permanent delete opens a confirmation, and the menu
       stayed up under its own dialog — the note has not changed yet, so the
       data-change keying cannot close it. Choosing closes, for all three items. */
    const onDestroy = vi.fn();
    render(<List onRestore={noop} onDestroy={onDestroy} />);

    fireEvent.contextMenu(screen.getByTestId('note-card'));
    fireEvent.click(screen.getByTestId('note-menu-destroy'));

    expect(onDestroy).toHaveBeenCalledWith('n-1');
    expect(screen.queryByTestId('note-menu')).toBeNull();
  });
});

describe('trash actions against the backend', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('a soft-deleted note leaves the live list and joins the trash', async () => {
    setMockBackend(buildDatabase({ noteCount: 5 }));

    const live = await notesApi.list({ kind: 'all' });
    const target = live[0];
    if (target === undefined) return;

    await act(async () => {
      await notesApi.softDelete(target.id);
    });

    expect((await notesApi.list({ kind: 'all' })).some((n) => n.id === target.id)).toBe(false);
    expect((await notesApi.list({ kind: 'trash' })).some((n) => n.id === target.id)).toBe(true);
  });

  it('restore puts the note back, with its text intact', async () => {
    setMockBackend(buildDatabase({ noteCount: 5 }));

    const live = await notesApi.list({ kind: 'all' });
    const target = live[0];
    if (target === undefined) return;
    const before = await notesApi.get(target.id);

    await act(async () => {
      await notesApi.softDelete(target.id);
    });
    await act(async () => {
      await notesApi.restore(target.id);
    });

    const after = await notesApi.get(target.id);
    /* §6.2: "undo simply restores". A restore that lost the body would make the undo
       toast a lie. */
    expect(after.doc).toEqual(before.doc);
    expect(after.deletedAt).toBeNull();
    expect((await notesApi.list({ kind: 'all' })).some((n) => n.id === target.id)).toBe(true);
  });

  it('permanent delete removes the row rather than re-hiding it', async () => {
    setMockBackend(buildDatabase({ noteCount: 5 }));

    const live = await notesApi.list({ kind: 'all' });
    const target = live[0];
    if (target === undefined) return;

    await act(async () => {
      await notesApi.softDelete(target.id);
    });
    await act(async () => {
      await notesApi.destroy(target.id);
    });

    await expect(notesApi.get(target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await notesApi.list({ kind: 'trash' })).some((n) => n.id === target.id)).toBe(false);
  });

  it('empty trash reports how many went and leaves the trash empty', async () => {
    setMockBackend(buildDatabase({ noteCount: 5 }));

    const live = await notesApi.list({ kind: 'all' });
    const [first, second] = live;
    if (first === undefined || second === undefined) return;

    await act(async () => {
      await notesApi.softDelete(first.id);
    });
    await act(async () => {
      await notesApi.softDelete(second.id);
    });

    let removed = 0;
    await act(async () => {
      removed = await notesApi.emptyTrash();
    });

    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await notesApi.list({ kind: 'trash' })).toHaveLength(0);
    /* The live notes are untouched: emptying the trash is not emptying the app. */
    expect((await notesApi.list({ kind: 'all' })).length).toBe(live.length - 2);
  });

  it('refuses to restore a note that is not in the trash', async () => {
    setMockBackend(buildDatabase({ noteCount: 3 }));

    const live = await notesApi.list({ kind: 'all' });
    const target = live[0];
    if (target === undefined) return;

    /* Restoring something already live is a no-op in the Rust repo; what matters is
       that it cannot silently resurrect a destroyed row. */
    await act(async () => {
      await notesApi.destroy(target.id);
    });
    await expect(notesApi.restore(target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/* The toast's own module. Driven with fake timers, because the six seconds are the
   contract and a real timer would make the test either slow or flaky — and this is
   the only place in the app where a wall-clock duration is a user-visible promise. */
describe('useUndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function ToastHarness({ undo }: { undo: () => void }): React.ReactElement {
    const { toast, show } = useUndoToast();
    return (
      <div>
        <button
          type="button"
          data-testid="show"
          onClick={() => {
            show('n-1', 'Meeting notes', undo);
          }}
        >
          delete
        </button>
        {toast === null ? null : <UndoToast toast={toast} />}
      </div>
    );
  }

  it('shows the note it deleted, so the toast names what is undoable', () => {
    render(<ToastHarness undo={noop} />);

    expect(screen.queryByTestId('undo-toast')).toBeNull();
    fireEvent.click(screen.getByTestId('show'));

    expect(screen.getByTestId('undo-toast').textContent).toContain('Meeting notes');
  });

  it('renders the toast itself unselectable, so a hold never selects its text', () => {
    render(<ToastHarness undo={noop} />);
    fireEvent.click(screen.getByTestId('show'));

    expect(screen.getByTestId('undo-toast').className).toContain('select-none');
  });

  it('runs the callback it was given when Undo is pressed', () => {
    const undo = vi.fn();
    render(<ToastHarness undo={undo} />);
    fireEvent.click(screen.getByTestId('show'));

    fireEvent.click(screen.getByTestId('undo-toast-undo'));

    expect(undo).toHaveBeenCalledTimes(1);
    /* The toast goes with the undo, rather than sitting there offering to undo a
       note that is already back in the list. */
    expect(screen.queryByTestId('undo-toast')).toBeNull();
  });

  it('announces itself politely and moves no focus', () => {
    render(
      <>
        <button type="button" data-testid="elsewhere">
          focus me
        </button>
        <ToastHarness undo={noop} />
      </>,
    );
    const elsewhere = screen.getByTestId('elsewhere');
    elsewhere.focus();
    fireEvent.click(screen.getByTestId('show'));

    /* Assertive would interrupt whatever a screen reader is reading, and a focus
       move would break the keystroke the user is in the middle of. */
    expect(screen.getByTestId('undo-toast').getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement).toBe(elsewhere);
  });

  it('disappears on its own after six seconds', () => {
    render(<ToastHarness undo={noop} />);
    fireEvent.click(screen.getByTestId('show'));

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    });
    expect(screen.getByTestId('undo-toast')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('undo-toast')).toBeNull();
  });

  it('is still there just before the six seconds are up', () => {
    render(<ToastHarness undo={noop} />);
    fireEvent.click(screen.getByTestId('show'));

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS - 100);
    });

    expect(screen.getByTestId('undo-toast')).toBeDefined();
  });

  it('dismisses early without running the undo', () => {
    const undo = vi.fn();
    render(<ToastHarness undo={undo} />);
    fireEvent.click(screen.getByTestId('show'));

    fireEvent.click(screen.getByTestId('undo-toast-dismiss'));

    expect(undo).not.toHaveBeenCalled();
    expect(screen.queryByTestId('undo-toast')).toBeNull();
  });

  it('a second delete replaces the first toast rather than stacking a second timer', () => {
    const undo = vi.fn();
    render(<ToastHarness undo={undo} />);

    fireEvent.click(screen.getByTestId('show'));
    fireEvent.click(screen.getByTestId('show'));

    /* One toast, and it survives the full window from the *second* delete. Two
       timers racing would restore whichever note each was pointed at. */
    expect(screen.getAllByTestId('undo-toast')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    });
    expect(screen.getByTestId('undo-toast')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('undo-toast')).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });
});