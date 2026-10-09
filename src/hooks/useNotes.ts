import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NoteFilter, NoteSummary } from '../types/ipc';
import { notesApi } from '../lib/ipc';
import { qk } from '../queries/keys';

/* The note list is server state and nothing else (`02-architecture.md` §5).
   No component holds a copy of it: this hook is the single reader, and the
   TanStack Query cache is the single source. Per-query pending states are used
   instead of a global loading flag.

   The list is re-read after a structural change — a create, delete, move, or
   pin — but not after a save. `10-conventions.md` §7 patches the list entry in
   place on save, because the save response already carries the fresh summary. */

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

/**
 * One clock reading for the whole note list, re-read every 60 s.
 *
 * `05-ui-ux.md` §6.5a requires timestamps recomputed on an interval so a list
 * left open stays accurate, and editing a note must move it to the top
 * immediately rather than wait for the interval. The second half falls out of
 * `updated_at` arriving fresh from the save response; this hook only owns the
 * first. One reading for every row means the list cannot straddle a minute
 * boundary and show two notes with the same label for different ages.
 */
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