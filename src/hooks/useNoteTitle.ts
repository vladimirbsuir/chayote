import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import { applySaveToList } from '../lib/noteOrder';
import { summaryOf } from '../components/summaryOf';
import type { NoteFilter, NoteSummary } from '../types/ipc';
import type { Uuid } from '../types/note';

/* ADR-023: typing a title, the write path for it, and the flush conditions.

   `notes_set_title` rather than a field on `notes_save`, for the same reason the
   pin has its own command: `04-editor.md` §5.1 makes the serialised document the
   comparison the autosave uses to decide whether anything changed, so a title
   carried in the save input would be judged unchanged and never written. This
   hook also keeps the body off the path — the note list holds summaries with no
   document, and the field is typed from a list of them.

   Debounced on the same 800 ms as the document, and for the same reason
   (`04-editor.md` §5.1): a title is typed in bursts, and one write per burst beats
   one per keystroke. What matters is that a burst cannot be lost — so `flush` is
   called on blur, on `Enter`, on a note switch, and through the sync flusher,
   which is the same set the document has. */

const DEBOUNCE_MS = 800;

type Pending = { id: Uuid; title: string };

export function useNoteTitle(): {
  /** Queues a title write. Safe to call on every keystroke. */
  write: (id: Uuid, title: string) => void;
  /** Writes the pending title now, if there is one. */
  flush: () => void;
} {
  const queryClient = useQueryClient();

  /* Held in a ref because the debounce below is created once: a callback that
     changed identity would restart the timer on every render and never fire. */
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, title }: Pending) => notesApi.setTitle(id, title),
    onSuccess: (saved) => {
      /* The open note's entry is replaced rather than patched, because the
         response carries the authoritative `updated_at` the ordering depends on.
         Every list is patched too, or a card elsewhere in the app would keep the
         old title until its next refetch. */
      queryClient.setQueryData(qk.note(saved.id), saved);
      /* Re-sorted, not only patched: `updated_at` moved, and it is the order. */
      const summary = summaryOf(saved);
      for (const [key, existing] of queryClient.getQueriesData<NoteSummary[]>({
        queryKey: ['notes'],
      })) {
        if (!Array.isArray(existing)) continue;
        const filter = key[1] as NoteFilter | undefined;
        queryClient.setQueryData(key, applySaveToList(existing, summary, filter?.kind));
      }
    },
  });

  /* `mutate`, not the `mutation` object: the object is new on every render, so a
     `send` depending on it changed identity on every keystroke, and the effect
     below ran its cleanup — which sends — each time. The debounce never got to
     fire; every keystroke was its own write, its own `updated_at` and its own
     outbox row. `mutate` is stable for the life of the hook. */
  const { mutate } = mutation;
  const send = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const queued = pendingRef.current;
    pendingRef.current = null;
    if (queued === null) return;
    mutate(queued);
  }, [mutate]);

  const write = useCallback(
    (id: Uuid, title: string): void => {
      pendingRef.current = { id, title };
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(send, DEBOUNCE_MS);
    },
    [send],
  );

  /* A title typed and then abandoned by closing the app is a title the user
     wrote and did not keep. The document has the same rule through its own
     window-blur flush; this is the title's half of it. */
  useEffect(() => {
    const onHide = (): void => {
      send();
    };
    window.addEventListener('blur', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', onHide);
      document.removeEventListener('visibilitychange', onHide);
      send();
    };
  }, [send]);

  return { write, flush: send };
}
