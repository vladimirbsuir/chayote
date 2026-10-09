import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosave, retryDelayMs, RETRY_BASE_MS, RETRY_CAP_MS } from './useAutosave';
import { openNote, useEditorStore } from '../stores/editor';
import type { Note, SaveNoteInput } from '../types/ipc';
import type { JsonDoc, Uuid } from '../types/note';

/* `04-editor.md` §5.1: "the same serialised document is not written again", and the
   exception the status bar creates. A folder or tag change arrives carrying an
   unchanged document, so the comparison calls it unchanged and the write never
   happens — the same failure a pin-only write has, and the reason `notes_set_pinned`
   exists as its own command.

   These tests pin that exception down through the paths that can lose it: the
   debounce, an explicit flush, and the retry timer. The retry is the one that cannot
   be reached from the UI, which is exactly why it needs a test. */

const NOTE: Uuid = '01980000-0000-7000-8000-000000000001';
const OTHER: Uuid = '01980000-0000-7000-8000-000000000002';

function doc(text: string): JsonDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const base = {
  id: NOTE,
  doc: doc('hello'),
  folderId: null,
  tagIds: [] as Uuid[],
  isPinned: false,
};

const save = vi.fn<(input: SaveNoteInput) => Promise<Note>>();

vi.mock('../lib/ipc', () => ({
  notesApi: {
    save: (input: SaveNoteInput) => save(input),
  },
}));

function asNote(input: SaveNoteInput): Note {
  return {
    id: input.id,
    title: 'Note',
    excerpt: '',
    folderId: input.folderId,
    folderName: null,
    isPinned: input.isPinned,
    wordCount: 0,
    updatedAt: 0,
    tags: [],
    doc: input.doc,
    createdAt: 0,
    deletedAt: null,
  };
}

/** Lets every pending microtask and the autosave's own timers run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('createAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    save.mockReset();
    save.mockImplementation((input) => Promise.resolve(asNote(input)));
    openNote(NOTE);
    useEditorStore.setState({ noteId: NOTE, saveState: 'saved', subjectId: NOTE });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a changed document after the debounce', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.noteChanged({ ...base, doc: doc('hello there') });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].doc).toEqual(doc('hello there'));
  });

  it('turns a typing burst into one write', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    for (const text of ['h', 'he', 'hel', 'hell', 'hello!']) {
      autosave.noteChanged({ ...base, doc: doc(text) });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].doc).toEqual(doc('hello!'));
  });

  it('skips a write whose document matches the last saved one', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    /* The comparison against the baseline, not against a document the user never
       had: opening a note is not a change. */
    autosave.noteChanged({ ...base });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).not.toHaveBeenCalled();
  });

  it('writes a folder change whose document is unchanged', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.schedule({ ...base, folderId: OTHER });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].folderId).toBe(OTHER);
  });

  it('writes a tag change whose document is unchanged', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.schedule({ ...base, tagIds: ['tag-1'] });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].tagIds).toEqual(['tag-1']);
  });

  it('keeps the metadata write when a keystroke follows it', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    /* The order matters and is the bug this guards: the tag write is queued, then a
       document edit arrives before the debounce fires. If the queueing of the edit
       cleared the "this write is metadata" state, the single write that results
       would be judged on the document alone — which has changed, so it would pass.
       The inverse is worse: a keystroke that normalises back to the same document
       would drop the tag. */
    autosave.schedule({ ...base, tagIds: ['tag-1'] });
    autosave.noteChanged({ ...base, doc: doc('hello'), tagIds: ['tag-1'] });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].tagIds).toEqual(['tag-1']);
  });

  it('writes a metadata change through an explicit flush', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.schedule({ ...base, folderId: OTHER });
    await autosave.flush();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].folderId).toBe(OTHER);
  });

  it('does not write on a flush of an untouched note', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    /* A note switch flushes the outgoing note unconditionally, and this is what
       keeps that free: no change, no write. */
    await autosave.flush({ ...base });
    await settle();

    expect(save).not.toHaveBeenCalled();
  });

  it('retries a failed metadata write rather than judging it unchanged', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);
    save.mockRejectedValueOnce(new Error('database is locked'));

    autosave.schedule({ ...base, tagIds: ['tag-1'] });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().saveState).toBe('error');

    /* The retry is where a force flag riding on the caller's argument would have been
       lost: this re-entry has only the queue, and the document it carries is the one
       already in the baseline. Judged on the document alone, the retry is "unchanged"
       and the tag is silently lost while the bar says "Saved". */
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].tagIds).toEqual(['tag-1']);
    expect(useEditorStore.getState().saveState).toBe('saved');
  });

  it('reports the saved note to whoever is listening', async () => {
    const onSaved = vi.fn<(note: Note) => void>();
    const autosave = createAutosave(onSaved);
    autosave.setBaseline(base);

    autosave.noteChanged({ ...base, doc: doc('changed') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await settle();

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0]?.[0].id).toBe(NOTE);
  });

  it('marks the note unsaved on a metadata change, because the debounce has not run', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.schedule({ ...base, tagIds: ['tag-1'] });

    expect(useEditorStore.getState().saveState).toBe('unsaved');

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await settle();

    expect(useEditorStore.getState().saveState).toBe('saved');
  });

  it('drops a pending write and its retry on dispose', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.schedule({ ...base, tagIds: ['tag-1'] });
    autosave.dispose();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 4);

    expect(save).not.toHaveBeenCalled();
  });

  it('stops comparing against the previous note after a new baseline', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);
    autosave.noteChanged({ ...base, doc: doc('first') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await settle();

    /* The switch: a new note, adopted as the baseline. A flush of the old note must
       not leave the comparison pointing at the new one's document. */
    autosave.setBaseline({ ...base, id: OTHER, doc: doc('second') });

    await autosave.flush({ ...base, id: OTHER, doc: doc('second') });
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('retryDelayMs', () => {
  it('starts at 400 ms and doubles, per §5.1', () => {
    expect(retryDelayMs(1)).toBe(400);
    expect(retryDelayMs(2)).toBe(800);
    expect(retryDelayMs(3)).toBe(1600);
  });

  it('caps at 30 s so a long outage cannot stall the tab', () => {
    expect(retryDelayMs(50)).toBe(RETRY_CAP_MS);
  });

  it('never returns less than the base for a nonsense attempt count', () => {
    expect(retryDelayMs(0)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(-3)).toBe(RETRY_BASE_MS);
  });
});