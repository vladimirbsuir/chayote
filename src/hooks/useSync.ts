import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { syncApi } from '../lib/ipc';
import { qk } from '../queries/keys';
import type { SyncStatus, SyncSummary } from '../types/sync';

/* Sync is server state like notes, folders and tags (`02-architecture.md`
   §5): the Rust engine owns it, TanStack Query caches it, and nothing else
   holds a copy. Status refreshes on a slow poll so the badge and the Sync
   tab converge without a manual refresh; the 60 s push-pull rhythm itself
   lives in `useAutoSync`, not in the poll. */

const STATUS_STALE_MS = 15_000;
const AUTO_SYNC_MS = 60_000;

export function useSyncStatus(): {
  status: SyncStatus | undefined;
  isPending: boolean;
} {
  const query = useQuery({
    queryKey: qk.syncStatus(),
    queryFn: () => syncApi.status(),
    staleTime: STATUS_STALE_MS,
    refetchInterval: STATUS_STALE_MS,
    retry: 1,
  });
  return { status: query.data, isPending: query.isPending };
}

function useInvalidateLibrary(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['note'] });
    void queryClient.invalidateQueries({ queryKey: ['folders'] });
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: qk.syncStatus() });
    void queryClient.invalidateQueries({ queryKey: qk.syncConflicts() });
  };
}

export function useSyncNow(): {
  syncNow: () => Promise<SyncSummary>;
  isSyncing: boolean;
} {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const mutation = useMutation({
    mutationFn: () => syncApi.now(),
    onSuccess: () => {
      invalidate();
    },
  });
  return {
    syncNow: async () => {
      const summary = await mutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: qk.syncConflicts() });
      return summary;
    },
    isSyncing: mutation.isPending,
  };
}

export function useSyncConflicts(enabled: boolean): {
  conflicts: Awaited<ReturnType<typeof syncApi.conflicts>> | undefined;
} {
  const query = useQuery({
    queryKey: qk.syncConflicts(),
    queryFn: () => syncApi.conflicts(),
    enabled,
    staleTime: STATUS_STALE_MS,
  });
  return { conflicts: query.data };
}

export function useResolveConflict(): {
  resolve: (id: string, keepLocal: boolean) => Promise<void>;
} {
  const invalidate = useInvalidateLibrary();
  const mutation = useMutation({
    mutationFn: ({ id, keepLocal }: { id: string; keepLocal: boolean }) =>
      syncApi.resolve(id, keepLocal),
    onSuccess: () => {
      invalidate();
    },
  });
  return {
    resolve: (id, keepLocal) => mutation.mutateAsync({ id, keepLocal }),
  };
}

/* `07-sync-plan.md` §8: drain-then-pull on an interval while the app is
   open, best effort. A manual Sync now always works; this only fires when a
   previous status read said sync is enabled and configured, so an
   unconfigured app never touches the network — the offline guarantee holds
   by default. Failures land in the status (`lastError`), never in a dialog:
   a background tick must not interrupt typing. */
export function useAutoSync(status: SyncStatus | undefined): void {
  const queryClient = useQueryClient();
  /* Destructured before the effect: depending on the whole status object
     would restart the 60 s timer on every 15 s poll, so the tick could never
     fire. Booleans are stable until sync is actually toggled. */
  const enabled = status !== undefined && status.enabled;
  const configured = status !== undefined && status.configured;
  useEffect(() => {
    if (!enabled || !configured) return;
    const timer = setInterval(() => {
      void syncApi
        .now()
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ['notes'] });
          void queryClient.invalidateQueries({ queryKey: ['note'] });
          void queryClient.invalidateQueries({ queryKey: ['folders'] });
          void queryClient.invalidateQueries({ queryKey: ['tags'] });
          void queryClient.invalidateQueries({ queryKey: qk.syncStatus() });
          void queryClient.invalidateQueries({ queryKey: qk.syncConflicts() });
        })
        .catch(() => {
          void queryClient.invalidateQueries({ queryKey: qk.syncStatus() });
        });
    }, AUTO_SYNC_MS);
    return () => {
      clearInterval(timer);
    };
  }, [queryClient, enabled, configured]);
}
