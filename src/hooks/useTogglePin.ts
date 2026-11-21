import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import type { NoteSummary } from '../types/ipc';
import type { Uuid } from '../types/note';

type TogglePin = (id: Uuid, isPinned: boolean) => void;

export function useTogglePin(): {
  togglePin: TogglePin;
  pendingId: Uuid | null;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, isPinned }: { id: Uuid; isPinned: boolean }) =>
      notesApi.setPinned(id, isPinned),
    onMutate: ({ id, isPinned }) => {
queryClient.setQueriesData(
        { queryKey: ['notes'] },
        (existing: NoteSummary[] | undefined) =>
          Array.isArray(existing)
            ? existing.map((summary) => (summary.id === id ? { ...summary, isPinned } : summary))
            : existing,
      );
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.note(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });

  return {
    togglePin: (id, isPinned) => {
      mutation.mutate({ id, isPinned });
    },
    pendingId: mutation.isPending ? mutation.variables.id : null,
  };
}