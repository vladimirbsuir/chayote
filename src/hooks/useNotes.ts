import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NoteFilter, NoteSummary } from '../types/ipc';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';

export function useNotes(filter: NoteFilter): {
  notes: NoteSummary[] | undefined;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: qk.notes(filter),
    queryFn: () => notesApi.list(filter),
  });

  return {
    notes: query.data,
    isPending: query.isPending,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

const TICK_MS = 60_000;

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return now;
}