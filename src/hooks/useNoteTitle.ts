import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import { applySaveToList } from '../lib/noteOrder';
import { summaryOf } from '../components/summaryOf';
import type { NoteFilter, NoteSummary } from '../types/ipc';
import type { Uuid } from '../types/note';

const DEBOUNCE_MS = 800;

type Pending = { id: Uuid; title: string };

export function useNoteTitle(): {
  write: (id: Uuid, title: string) => void;
  flush: () => void;
} {
  const queryClient = useQueryClient();

  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, title }: Pending) => notesApi.setTitle(id, title),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.note(saved.id), saved);
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
