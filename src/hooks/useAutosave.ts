import { useEffect, useState } from 'react';
import { notesApi } from '../lib/ipc';
import { debounce } from '../lib/debounce';
import { markSaveFailed, markSaved, markSaving, markUnsaved } from '../stores/editor';
import type { Note, SaveNoteInput } from '../types/ipc';

/* `04-editor.md` §5. Autosave is the most important behaviour in the app, so
   every clause of §5.1 maps to something here:

   | Clause                   | Where it lives                                      |
   |--------------------------|-----------------------------------------------------|
   | 800 ms debounce          | `scheduleSave`                                       |
   | one save in flight       | `inFlight`; a change during a save queues one more  |
   | skip an unchanged doc    | the `lastSaved` string comparison                    |
   | flush on five conditions | `flush`, called by EditorPane                        |
   | retry with backoff       | `scheduleRetry`, backed off from §5.1's 400 ms       |

   This is a controller object rather than a bag of refs inside the component,
   because a note switch has to write the *outgoing* note from inside an effect
   cleanup, where React cannot await. Passing the target as an argument is the
   only honest way to say "save this exact document", and it keeps the
   serialisation comparison honest too: the document is read at the moment of the
   write, not captured at the moment of the keystroke.

   There is deliberately no timer over the editor instance: the document is the
   input, and an update producing the same serialised document is not a change.
   That is what turns a typing burst into one write. */

export const AUTOSAVE_DELAY_MS = 800;
export const RETRY_BASE_MS = 400;
export const RETRY_CAP_MS = 30_000;

export type Autosave = {
  /** Called on every editor update with the document as it now stands. */
  noteChanged: (target: SaveNoteInput) => void;
  /** Writes now and waits for an in-flight save. Omit `target` to use the queued one. */
  flush: (target?: SaveNoteInput) => Promise<void>;
  /** Adopts a freshly loaded document as the baseline, so opening is not a save. */
  setBaseline: (target: SaveNoteInput) => void;
  /** Replaces the post-save handler without disturbing the in-flight state. */
  setOnSaved: (handler: (note: Note) => void) => void;
  /** Drops the pending timer and any retry. Called on unmount. */
  dispose: () => void;
};

export function createAutosave(onSaved: (note: Note) => void): Autosave {
  let onSavedRef = onSaved;
  let inFlight = false;
  let queued: SaveNoteInput | null = null;
  let attempts = 0;
  let lastSaved: string | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = (): void => {
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };

  const persist = async (forced: SaveNoteInput | null): Promise<void> => {
    const input = forced ?? queued;

    if (inFlight) {
      queued = input;
      return;
    }
    if (input === null) return;

    const serialised = JSON.stringify(input.doc);
    if (serialised === lastSaved) {
      markSaved(input.id);
      return;
    }

    inFlight = true;
    markSaving(input.id);
    try {
      const note = await notesApi.save(input);
      lastSaved = serialised;
      attempts = 0;
      clearRetry();
      markSaved(input.id);
      onSavedRef(note);
    } catch {
      markSaveFailed(input.id);
      attempts += 1;
      queued = input;
      clearRetry();
      retry = setTimeout(() => {
        retry = null;
        void persist(null);
      }, retryDelayMs(attempts));
    } finally {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next !== null && next !== input) await persist(next);
    }
  };

  const scheduleSave = debounce(
    (target: SaveNoteInput) => void persist(target),
    AUTOSAVE_DELAY_MS,
  );

  return {
    noteChanged: (target) => {
      queued = target;
      markUnsaved(target.id);
      scheduleSave(target);
    },

    flush: async (target) => {
      scheduleSave.cancel();
      const input = target ?? queued;
      queued = null;
      await persist(input);
      while (inFlight) {
        await persist(null);
        queued = null;
      }
    },

    setBaseline: (target) => {
      queued = target;
      lastSaved = JSON.stringify(target.doc);
      attempts = 0;
      clearRetry();
    },

    dispose: () => {
      scheduleSave.cancel();
      clearRetry();
      queued = null;
    },

    setOnSaved: (handler) => {
      onSavedRef = handler;
    },
  };
}

/**
 * The controller is created once and held as state rather than as a ref, so no
 * component reads a `.current` during render. That is the discipline the linter
 * enforces here, and it is the same one that keeps a save from reading a
 * half-updated document.
 */
export function useAutosave(onSaved: (note: Note) => void): Autosave {
  const [autosave] = useState(() => createAutosave(onSaved));
  autosave.setOnSaved(onSaved);

  useEffect(() => {
    return () => {
      autosave.dispose();
    };
  }, [autosave]);

  return autosave;
}

/** Exponential backoff per §5.1, capped so a long outage cannot stall the tab. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}