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
   | skip an unchanged doc    | the `lastSaved` string comparison, unless `forced`  |
   | flush on five conditions | `flush`, called by EditorPane                        |
   | retry with backoff       | the `retry` timer, backed off from §5.1's 400 ms    |

   This is a controller object rather than a bag of refs inside the component,
   because a note switch has to write the *outgoing* note from inside an effect
   cleanup, where React cannot await. Passing the target as an argument is the
   only honest way to say "save this exact document", and it keeps the
   serialisation comparison honest too: the document is read at the moment of the
   write, not captured at the moment of the keystroke.

   There is deliberately no timer over the editor instance: the document is the
   input, and an update producing the same serialised document is not a change.
   That is what turns a typing burst into one write.

   `forced` is the exception that clause makes necessary. The comparison is over the
   document, so a folder or tag change — which arrives carrying an unchanged document
   — is judged unchanged and never written. `schedule` marks such a write forced, and
   the flag lives on the queue rather than on the call, because the three paths that
   re-enter a save (the debounce, an explicit `flush`, and the retry timer) each reach
   it differently and only one of them still holds what the caller passed. */

export const AUTOSAVE_DELAY_MS = 800;
export const RETRY_BASE_MS = 400;
export const RETRY_CAP_MS = 30_000;

export type Autosave = {
  /** Called on every editor update with the document as it now stands. */
  noteChanged: (target: SaveNoteInput) => void;
  /** Queues a write whose document may be identical to the last saved one, so the
      "is it the same?" comparison is bypassed. For the changes that carry no document
      — the note's folder and tags (`04-editor.md` §9, status bar) — which would
      otherwise be judged unchanged and silently dropped, exactly as a pin-only write
      would be. */
  schedule: (target: SaveNoteInput) => void;
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
  /* Whether the queued write must go through even if its document is identical to
     the last saved one. Set by `schedule`, cleared by a save that succeeded.

     A flag on the queue rather than an argument to `persist`, because the queue is
     what survives a note switch, a flush and a retry — all three of which used to
     lose a metadata-only write that had been judged "unchanged", and all three of
     which read the force state from the wrong place when the flag rode on the
     argument instead. A retry in particular re-enters `persist` with nothing but the
     queue, so a force flag passed in by the caller would already be gone. */
  let forced = false;

  const clearRetry = (): void => {
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };

  const persist = async (input: SaveNoteInput | null, force: boolean): Promise<void> => {
    const target = input ?? queued;

    if (inFlight) {
      queued = target;
      /* Sticky: a document edit arriving while a metadata write is queued must not
         clear the force, or the queued write is judged on the document and dropped. */
      forced = forced || force;
      return;
    }
    if (target === null) return;

    if (!force && JSON.stringify(target.doc) === lastSaved) {
      markSaved(target.id);
      forced = false;
      return;
    }

    inFlight = true;
    markSaving(target.id);
    let failed = false;
    try {
      const note = await notesApi.save(target);
      lastSaved = JSON.stringify(target.doc);
      attempts = 0;
      clearRetry();
      forced = false;
      markSaved(target.id);
      onSavedRef(note);
    } catch {
      failed = true;
      markSaveFailed(target.id);
      attempts += 1;
      /* Re-queued rather than left to the drain below: the drain exists to pick up a
         *newer* change that arrived during the write, and this one is not newer. The
         retry timer is what gets this one back, and it re-enters `persist` with
         nothing but the queue, so the force flag has to be on the queue too. */
      queued = target;
      forced = forced || force;
      clearRetry();
      retry = setTimeout(() => {
        retry = null;
        void persist(null, forced);
      }, retryDelayMs(attempts));
    } finally {
      inFlight = false;
      /* On failure the queue and the flag belong to the retry, so the drain must not
         touch them — clearing them here is what turns a retry into a no-op. */
      if (!failed) {
        const next = queued;
        const nextForced = forced;
        queued = null;
        forced = false;
        if (next !== null && next !== target) await persist(next, nextForced);
      }
    }
  };

  const scheduleSave = debounce(
    (target: SaveNoteInput) => void persist(target, forced),
    AUTOSAVE_DELAY_MS,
  );

  return {
    noteChanged: (target) => {
      /* ProseMirror fires `update` while it normalises the initial content, so a
         freshly opened note reaches here with a document nobody changed. Marking
         that unsaved would show "Unsaved changes" on a note the user has not
         touched, which is the one status the bar must never lie about. */
      if (!forced && JSON.stringify(target.doc) === lastSaved) return;

      queued = target;
      markUnsaved(target.id);
      scheduleSave(target);
    },

    /* `04-editor.md` §5.1 skips a write whose serialised document matches the last
       saved one, which is what turns a typing burst into a single write. It is the
       wrong test for a folder or tag change: those carry no document, so the
       comparison says "unchanged" and the write never happens — the same failure a
       pin-only write has, and the reason `notes_set_pinned` exists as a separate
       command.

       The fix here rather than a command of their own, because `notes_save` is the
       only write that carries `folderId` and `tagIds` together with the document,
       and the tag set is a whole-set replacement (`07-sync-plan.md` §5.3) rather than
       an increment — two commands appending rows would get that wrong. */
    schedule: (target) => {
      queued = target;
      forced = true;
      markUnsaved(target.id);
      scheduleSave(target);
    },

    flush: async (target) => {
      scheduleSave.cancel();
      const input = target ?? queued;
      const force = forced;
      queued = null;
      await persist(input, force);
      while (inFlight) {
        await persist(null, forced);
        queued = null;
      }
    },

    setBaseline: (target) => {
      queued = target;
      lastSaved = JSON.stringify(target.doc);
      attempts = 0;
      forced = false;
      clearRetry();
    },

    dispose: () => {
      scheduleSave.cancel();
      clearRetry();
      queued = null;
      forced = false;
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