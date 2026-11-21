import { useEffect, useState } from 'react';
import { notesApi } from '../lib/ipc';
import { debounce } from '../lib/debounce';
import { markSaveFailed, markSaved, markSaving, markUnsaved } from '../stores/editor';
import type { Note, SaveNoteInput } from '../types/ipc';
import type { Uuid } from '../types/note';

export const AUTOSAVE_DELAY_MS = 800;
export const RETRY_BASE_MS = 400;
export const RETRY_CAP_MS = 30_000;

export type Autosave = {
  noteChanged: (target: SaveNoteInput) => void;
  schedule: (target: SaveNoteInput) => void;
  flush: (target?: SaveNoteInput) => Promise<void>;
  setBaseline: (target: SaveNoteInput) => void;
  setOnSaved: (handler: (note: Note) => void) => void;
  dispose: () => void;
};

type Pending = { target: SaveNoteInput; forced: boolean };

export function createAutosave(onSaved: (note: Note) => void): Autosave {
  let onSavedRef = onSaved;
  let inFlight = false;
  let flight: Promise<void> | null = null;
  let settleFlight: (() => void) | null = null;
  const pending = new Map<Uuid, Pending>();
  const lastSaved = new Map<Uuid, string>();
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearRetry = (): void => {
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };

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

  const settleFlights = async (): Promise<void> => {
    let current = flight;
    while (current !== null) {
      await current;
      current = flight;
    }
  };

  const drainLeftovers = async (): Promise<void> => {
    if (pending.size > 0 && retry === null) {
      await persist(takeNext());
      await settleFlights();
    }
  };

  const persist = async (entry: Pending | null): Promise<void> => {
    if (inFlight) {
      if (entry !== null) enqueue(entry.target, entry.forced);
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
      settleFlight?.();
      settleFlight = null;
      flight = null;
      if (!failed) await persist(takeNext());
    }
  };

  const scheduleSave = debounce((id: Uuid) => void persist(take(id)), AUTOSAVE_DELAY_MS);

  return {
    noteChanged: (target) => {
      disposed = false;
      const forced = pending.get(target.id)?.forced ?? false;
      if (!forced && JSON.stringify(target.doc) === lastSaved.get(target.id)) return;

      enqueue(target, false);
      markUnsaved(target.id);
      scheduleSave(target.id);
    },

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
        entry = takeNext();
      }
      await persist(entry);
      await settleFlights();
      await drainLeftovers();
    },

    setBaseline: (target) => {
      disposed = false;
      lastSaved.set(target.id, JSON.stringify(target.doc));
      if (pending.size === 0 && retry === null) attempts = 0;
    },

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

export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}
