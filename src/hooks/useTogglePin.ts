import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import type { NoteSummary } from '../types/ipc';
import type { Uuid } from '../types/note';

/* `05-ui-ux.md` §6.3a: pinning is optimistic in the UI and reconciled by the
   command response.
   The optimistic part is not decoration. A pin reorders every list in the app
   immediately, and a list that waits for a round trip before moving a row feels
   broken for the length of the write — the note visibly jumps a moment after the
   press. The response then carries the authoritative `updated_at`, which the
   ordering depends on, so the cache entry is replaced rather than assumed.

   `notes_set_pinned` rather than `notes_save` because the note list holds a
   `NoteSummary` with no document: the note card has nothing to send but a boolean,
   and loading a body to change a flag would put every pinned note's document on the
   write path. */

type TogglePin = (id: Uuid, isPinned: boolean) => void;

export function useTogglePin(): {
  togglePin: TogglePin;
  /** The note whose pin is in flight, so its card can show the pending state. */
  pendingId: Uuid | null;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, isPinned }: { id: Uuid; isPinned: boolean }) =>
      notesApi.setPinned(id, isPinned),
    onMutate: ({ id, isPinned }) => {
      /* The optimistic write has to be synchronous — `onMutate` is the only hook
         that runs before the request — and every list cache has to be patched, not
         just the visible one, or switching selection briefly shows a stale pin. */
queryClient.setQueriesData(
        { queryKey: ['notes'] },
        (existing: NoteSummary[] | undefined) =>
          Array.isArray(existing)
            ? existing.map((summary) => (summary.id === id ? { ...summary, isPinned } : summary))
            : existing,
      );
    },
    onSuccess: (saved) => {
      /* The response carries the real `updated_at`, which decides the ordering, so
         the open note's entry is replaced rather than left at the optimistic guess.
         The list itself is re-read: a pinned note moves to the top, which patching
         one row cannot express. */
      queryClient.setQueryData(qk.note(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });

  return {
    togglePin: (id, isPinned) => {
      mutation.mutate({ id, isPinned });
    },
    /* `variables` is always set while a mutation is in flight — TanStack clears it
       only after settling — so the `isPending` guard is what makes the null possible. */
    pendingId: mutation.isPending ? mutation.variables.id : null,
  };
}