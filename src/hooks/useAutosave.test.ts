import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosave, retryDelayMs, RETRY_BASE_MS, RETRY_CAP_MS } from './useAutosave';
import { openNote, useEditorStore } from '../stores/editor';
import type { Note, SaveNoteInput } from '../types/ipc';
import type { JsonDoc, Uuid } from '../types/note';

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

  it('overlapping flushes wait for the in-flight save instead of spinning', async () => {
    vi.useRealTimers();
    try {
      const autosave = createAutosave(vi.fn());
      autosave.setBaseline(base);

      let resolveSave!: (note: Note) => void;
      save.mockImplementationOnce(
        (input) =>
          new Promise<Note>((resolve) => {
            resolveSave = () => {
              resolve(asNote(input));
            };
          }),
      );

      autosave.noteChanged({ ...base, doc: doc('A brand new title') });
      const first = autosave.flush();
      const second = autosave.flush();

      await new Promise((resolve) => setTimeout(resolve, 20));
      resolveSave(asNote({ ...base, doc: doc('A brand new title') }));

      await first;
      await second;
      autosave.dispose();

      expect(save).toHaveBeenCalledTimes(1);
      expect(useEditorStore.getState().saveState).toBe('saved');
    } finally {
      vi.useFakeTimers();
    }
  });

  it('does not write on a flush of an untouched note', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

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

  it('writes what was pending once on dispose, and never retries it', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);
    save.mockRejectedValueOnce(new Error('database is locked'));

    autosave.schedule({ ...base, tagIds: ['tag-1'] });
    autosave.dispose();

    await vi.advanceTimersByTimeAsync(RETRY_CAP_MS * 2);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].tagIds).toEqual(['tag-1']);
  });

  it('keeps a note’s newest document when another note opens during its save', async () => {
    let release!: () => void;
    save.mockImplementationOnce(
      (input) =>
        new Promise<Note>((resolve) => {
          release = () => {
            resolve(asNote(input));
          };
        }),
    );
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.noteChanged({ ...base, doc: doc('a1') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    autosave.noteChanged({ ...base, doc: doc('a2') });
    void autosave.flush();
    autosave.setBaseline({ ...base, id: OTHER, doc: doc('b0') });

    release();
    await settle();

    expect(save.mock.calls.map(([input]) => [input.id, input.doc])).toEqual([
      [NOTE, doc('a1')],
      [NOTE, doc('a2')],
    ]);
  });

  it('keeps retrying a failed note after another note opens', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);
    save.mockRejectedValueOnce(new Error('database is locked'));

    autosave.noteChanged({ ...base, doc: doc('a1') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    autosave.setBaseline({ ...base, id: OTHER, doc: doc('b0') });
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({ id: NOTE, doc: doc('a1') });
  });

  it('drops a pending write when an undo returns the note to its saved text', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);

    autosave.noteChanged({ ...base, doc: doc('typo') });
    autosave.noteChanged({ ...base });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(useEditorStore.getState().saveState).toBe('saved');
  });

  it('still flushes other notes while one note waits on a retry', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);
    autosave.setBaseline({ ...base, id: OTHER, doc: doc('b0') });
    save.mockRejectedValueOnce(new Error('database is locked'));

    autosave.noteChanged({ ...base, doc: doc('a1') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    autosave.noteChanged({ ...base, id: OTHER, doc: doc('b1') });
    await autosave.flush();

    expect(save.mock.calls[1]?.[0]).toMatchObject({ id: OTHER, doc: doc('b1') });
  });

  it('does not report a background note as the open note', () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline({ ...base, id: OTHER, doc: doc('b0') });

    autosave.noteChanged({ ...base, id: OTHER, doc: doc('b1') });

    expect(useEditorStore.getState().subjectId).toBe(NOTE);
    expect(useEditorStore.getState().saveState).toBe('saved');
  });

  it('compares each note against its own last saved document', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);
    autosave.setBaseline({ ...base, id: OTHER, doc: doc('b0') });

    autosave.noteChanged({ ...base });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await settle();

    expect(save).not.toHaveBeenCalled();
  });

  it('stops comparing against the previous note after a new baseline', async () => {
    const autosave = createAutosave(vi.fn());
    autosave.setBaseline(base);
    autosave.noteChanged({ ...base, doc: doc('first') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await settle();

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