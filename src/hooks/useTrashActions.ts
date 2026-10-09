import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import type { Uuid } from '../types/note';

/* The five trash actions of `05-ui-ux.md` §6.2, over commands that already existed
   from M1: soft delete, undo (a restore), permanent delete, and empty trash.

   Three behaviours are worth stating, because each is a place where the obvious
   implementation is wrong.

   - **Soft delete is immediate and undo is a restore, not a deferred write.** §6.2
     is exact: "The soft delete is already persisted; undo simply restores." A toast
     promising to undo a write that has not happened yet would be a lie if the app
     closed in between.

   - **A note leaving the trash closes the editor**, and one coming back re-opens it.
     `10-conventions.md` §6 says `NOT_FOUND` means "close the editor, refresh the
     list", and a deleted note is not something the editor should keep rendering.
     Restoring re-opens, because the user just asked for that note back and closing
     it would make undo look like it worked on the wrong thing.

   - **Every action invalidates the note list, never patches it.** These are
     structural changes — a row leaves the selection, or leaves the database
     entirely — and there is no entry to patch in place. `10-conventions.md` §7
     allows in-place patching only for `notes_save`, whose response carries the
     fresh summary. */

type Options = {
  /** Called after an action that removed the open note, so the shell can close the
      editor and fall back to a selection that still exists. `null` means "whatever
      was open is gone" — empty trash, where the shell does not know which note it
      was and does not need to. */
  onOpenNoteGone: (id: Uuid | null) => void;
  onRestored?: (id: Uuid) => void;
};

export function useTrashActions({ onOpenNoteGone, onRestored }: Options): {
  softDelete: (id: Uuid) => void;
  restore: (id: Uuid) => Promise<void>;
  destroy: (id: Uuid) => Promise<void>;
  emptyTrash: () => Promise<number>;
} {
  const queryClient = useQueryClient();

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
  };

  const softDelete = useMutation({
    mutationFn: (id: Uuid) => notesApi.softDelete(id),
    onSuccess: (_result, id) => {
      refresh();
      onOpenNoteGone(id);
    },
  });

  const restore = useMutation({
    mutationFn: (id: Uuid) => notesApi.restore(id),
    onSuccess: (_result, id) => {
      refresh();
      onRestored?.(id);
    },
  });

  const destroy = useMutation({
    mutationFn: (id: Uuid) => notesApi.destroy(id),
    onSuccess: (_result, id) => {
      refresh();
      onOpenNoteGone(id);
    },
  });

  const empty = useMutation({
    mutationFn: () => notesApi.emptyTrash(),
    onSuccess: () => {
      refresh();
      onOpenNoteGone(null);
    },
  });

  return {
    softDelete: (id) => {
      softDelete.mutate(id);
    },
    restore: async (id) => {
      await restore.mutateAsync(id);
    },
    destroy: async (id) => {
      await destroy.mutateAsync(id);
    },
    emptyTrash: async () => empty.mutateAsync(),
  };
}

/** The cache key of one note, re-exported so callers do not import `queries/keys`
    for a single lookup. */
export function noteKeyOf(id: Uuid): readonly ['note', Uuid] {
  return qk.note(id);
}