import { useEffect, useState } from 'react';
import { notesApi } from '../lib/ipc';
import { debounce } from '../lib/debounce';
import { markSaveFailed, markSaved, markSaving, markUnsaved } from '../stores/editor';
import type { Note, SaveNoteInput } from '../types/ipc';
import type { Uuid } from '../types/note';

/* `04-editor.md` §5. Autosave is the most important behaviour in the app, so
   every clause of §5.1 maps to something here:

   | Clause                   | Where it lives                                      |
   |--------------------------|-----------------------------------------------------|
   | 800 ms debounce          | `scheduleSave`                                       |
   | one save in flight       | `inFlight`; a change during a save queues one more  |
   | skip an unchanged doc    | the `lastSaved` comparison, unless the entry is forced |
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
   the flag lives on the pending entry rather than on the call, because the three
   paths that re-enter a save (the debounce, an explicit `flush`, and the retry timer)
   each reach it differently and only the entry survives all three. */

export const AUTOSAVE_DELAY_MS = 800;
export const RETRY_BASE_MS = 400;
export const RETRY_CAP_MS = 30_000;

export type Autosave = {
  /** Called on every editor update with the document as it now stands. */
  noteChanged: (target: SaveNoteInput) => void;
  /** Queues a write whose document may be identical to the last saved one, so the
      "is it the same?" comparison is bypassed. For the changes that carry no document
      — the note's folder and tags (`04-editor.md` §9, status bar) — which would
      otherwise be judged unchanged and silently dropped. */
  schedule: (target: SaveNoteInput) => void;
  /** Writes now and waits for an in-flight save. Omit `target` to write what is
      pending. */
  flush: (target?: SaveNoteInput) => Promise<void>;
  /** Adopts a freshly loaded document as the baseline, so opening is not a save. */
  setBaseline: (target: SaveNoteInput) => void;
  /** Replaces the post-save handler without disturbing the in-flight state. */
  setOnSaved: (handler: (note: Note) => void) => void;
  /** Drops the pending timer and any retry, and writes what was pending once.
      Called on unmount. */
  dispose: () => void;
};

type Pending = { target: SaveNoteInput; forced: boolean };

export function createAutosave(onSaved: (note: Note) => void): Autosave {
  let onSavedRef = onSaved;
  let inFlight = false;
  /* Settles when the running save finishes. An overlapping flush waits on this
     rather than spinning on `inFlight` — see `flush`. The two are set and
     cleared together, except inside the `finally` below where the flag drops
     first so the drain can start its follow-up save under a fresh promise. */
  let flight: Promise<void> | null = null;
  let settleFlight: (() => void) | null = null;
  /* Writes not yet made, **one per note**, oldest first.

     This used to be one slot shared by every note, with one `lastSaved` string and
     one force flag, and a note switch adopted the incoming note by overwriting the
     slot. Type in A while a save of A is running, open B, and A's newest keystrokes
     were replaced by B's unchanged document: B was rewritten for nothing and A's
     last words were never saved. A failed save fared no better — opening B cleared
     A's retry, so the "will retry" the bar had promised never happened. Keyed by
     note, a switch cannot touch another note's pending write. */
  const pending = new Map<Uuid, Pending>();
  /* The last document written or loaded, per note — the §5.1 comparison. */
  const lastSaved = new Map<Uuid, string>();
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  /* After `dispose` a failure is not retried: there is no editor left to report
     it, and a timer that outlives its component is a leak. Any later use clears
     it again, which is what a StrictMode remount of the same controller does. */
  let disposed = false;

  const clearRetry = (): void => {
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };

  /* Adds or replaces a note's pending write. The force is sticky: a document edit
     arriving while a metadata write is pending must not clear it, or the write is
     judged on the document and dropped. */
  const enqueue = (target: SaveNoteInput, force: boolean): void => {
    const previous = pending.get(target.id);
    pending.delete(target.id);
    pending.set(target.id, { target, forced: force || (previous?.forced ?? false) });
  };

  const take = (id: Uuid): Pending | null => {
    const entry = pending.get(id) ?? null;
    pending.delete(id);
    return entry;
  };

  const takeNext = (): Pending | null => {
    const first = pending.keys().next();
    return first.done === true ? null : take(first.value);
  };

  /* Waits out whatever save is running. A helper rather than inline code in
     `flush`: the shared lets are only assigned inside `persist`, so a direct
     check after `flush`'s own assignments narrows to "always false" and lies.
     A fresh function scope reads the declared types instead. */
  const settleFlights = async (): Promise<void> => {
    let current = flight;
    while (current !== null) {
      await current;
      current = flight;
    }
  };

  /* Persists whatever an overlap left pending — unless the retry timer owns it,
     in which case an immediate write would jump the backoff. Same fresh-scope
     reason as above. */
  const drainLeftovers = async (): Promise<void> => {
    if (pending.size > 0 && retry === null) {
      await persist(takeNext());
      await settleFlights();
    }
  };

  const persist = async (entry: Pending | null): Promise<void> => {
    if (inFlight) {
      if (entry !== null) enqueue(entry.target, entry.forced);
      /* The caller is a flush that must not resolve before this document is
         written. Wait for the running save; `flush` awaits the same promise and
         then persists whatever this left pending. */
      await flight;
      return;
    }
    if (entry === null) return;
    const { target, forced } = entry;
    const serialised = JSON.stringify(target.doc);

    if (!forced && serialised === lastSaved.get(target.id)) {
      markSaved(target.id);
      return;
    }

    inFlight = true;
    flight = new Promise<void>((resolve) => {
      settleFlight = resolve;
    });
    markSaving(target.id);
    let failed = false;
    try {
      const note = await notesApi.save(target);
      lastSaved.set(target.id, serialised);
      attempts = 0;
      markSaved(target.id);
      onSavedRef(note);
    } catch {
      failed = true;
      markSaveFailed(target.id);
      attempts += 1;
      /* Back on the queue — behind any newer document typed into this note since,
         which is then the one to write, keeping this one's force. The retry timer
         re-enters with nothing but the queue. */
      const newer = take(target.id);
      enqueue(newer?.target ?? target, forced || (newer?.forced ?? false));
      clearRetry();
      if (!disposed) {
        retry = setTimeout(() => {
          retry = null;
          void persist(takeNext());
        }, retryDelayMs(attempts));
      }
    } finally {
      inFlight = false;
      /* The save itself is done; wake anyone waiting on it before the drain starts
         its follow-up under a fresh promise — a waiter that woke into the drain's
         save re-waits on that one through `flush`'s loop. */
      settleFlight?.();
      settleFlight = null;
      flight = null;
      /* On failure the queue belongs to the retry, so the drain must not touch it —
         draining here would turn the backoff into a tight loop. */
      if (!failed) await persist(takeNext());
    }
  };

  const scheduleSave = debounce((id: Uuid) => void persist(take(id)), AUTOSAVE_DELAY_MS);

  return {
    noteChanged: (target) => {
      disposed = false;
      /* ProseMirror fires `update` while it normalises the initial content, so a
         freshly opened note reaches here with a document nobody changed. Marking
         that unsaved would show "Unsaved changes" on a note the user has not
         touched, which is the one status the bar must never lie about. */
      const forced = pending.get(target.id)?.forced ?? false;
      if (!forced && JSON.stringify(target.doc) === lastSaved.get(target.id)) return;

      enqueue(target, false);
      markUnsaved(target.id);
      scheduleSave(target.id);
    },

    /* `04-editor.md` §5.1 skips a write whose serialised document matches the last
       saved one, which is what turns a typing burst into a single write. It is the
       wrong test for a folder or tag change: those carry no document, so the
       comparison says "unchanged" and the write never happens.

       The fix here rather than a command of their own, because `notes_save` is the
       only write that carries `folderId` and `tagIds` together with the document,
       and the tag set is a whole-set replacement (`07-sync-plan.md` §5.3) rather than
       an increment — two commands appending rows would get that wrong. */
    schedule: (target) => {
      disposed = false;
      enqueue(target, true);
      markUnsaved(target.id);
      scheduleSave(target.id);
    },

    flush: async (target) => {
      disposed = false;
      scheduleSave.cancel();
      let entry: Pending | null = null;
      if (target !== undefined) {
        entry = { target, forced: take(target.id)?.forced ?? false };
      } else if (retry === null) {
        /* With a retry pending the queue is the timer's: writing now would jump
           the backoff. */
        entry = takeNext();
      }
      await persist(entry);
      /* An overlapping save may still be running — a second flush (blur, then
         unmount), a late keystroke's debounce, the retry timer. Wait for the
         work; never spin on the flag.

         The old loop did spin: `while (inFlight)` re-entered `persist`, which
         early-returned at once, forever. That is a microtask loop, and a
         microtask loop starves the task queue — including the queue the save's
         own IPC response arrives on. On this WebView a Tauri response needs a
         task, so the save never settles, the flag never clears, and the app
         freezes: type a title into a fresh note, press back, dead. Found on a
         phone; unreproducible in a browser, where the mock resolves in a
         microtask and the spin terminates. */
      await settleFlights();
      await drainLeftovers();
    },

    /* Adopts a freshly opened note's document as its comparison point, and touches
       no other note's pending write or retry — see `pending`. */
    setBaseline: (target) => {
      disposed = false;
      lastSaved.set(target.id, JSON.stringify(target.doc));
      if (pending.size === 0 && retry === null) attempts = 0;
    },

    /* The debounce timer is dropped, but not what it was holding: a change the user
       made is written once more, without a retry. Dropping it lost a folder or tag
       picked in the last 800 ms before the editor went away. */
    dispose: () => {
      disposed = true;
      scheduleSave.cancel();
      clearRetry();
      if (pending.size > 0) void persist(takeNext());
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
