import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import type { Uuid } from '../types/note';

type Options = {
  onOpenNoteGone: (id: Uuid | null) => void;
  onRestored?: (id: Uuid) => void;
};

export function useTrashActions({ onOpenNoteGone, onRestored }: Options): {
  softDelete: (id: Uuid) => Promise<void>;
  restore: (id: Uuid) => Promise<void>;
  destroy: (id: Uuid) => Promise<void>;
  emptyTrash: () => Promise<number>;
} {
  const queryClient = useQueryClient();

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
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
    softDelete: async (id) => {
      await softDelete.mutateAsync(id);
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

export function noteKeyOf(id: Uuid): readonly ['note', Uuid] {
  return qk.note(id);
}