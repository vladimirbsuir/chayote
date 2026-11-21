import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { syncApi } from '../lib/ipc';
import { flushEditorsForSync } from '../lib/syncFlush';
import { useSelectionStore } from '../stores/selection';
import { qk } from '../queries/keys';
import type { SyncStatus, SyncSummary } from '../types/sync';

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
    mutationFn: async () => {
      await flushEditorsForSync();
      return syncApi.now(useSelectionStore.getState().openNoteId);
    },
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
} {  const invalidate = useInvalidateLibrary();
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

export function useReupload(): {
  reupload: () => Promise<number>;
  isReuploading: boolean;
} {
  const invalidate = useInvalidateLibrary();
  const mutation = useMutation({
    mutationFn: () => syncApi.reupload(),
    onSuccess: () => {
      invalidate();
    },
  });
  return {
    reupload: () => mutation.mutateAsync(),
    isReuploading: mutation.isPending,
  };
}

export function useAutoSync(status: SyncStatus | undefined): void {
  const queryClient = useQueryClient();
  const enabled = status !== undefined && status.enabled;
  const configured = status !== undefined && status.configured;
  useEffect(() => {
    if (!enabled || !configured) return;
    const timer = setInterval(() => {
      void (async () => {
        await flushEditorsForSync().catch(() => undefined);
        await syncApi
          .now(useSelectionStore.getState().openNoteId)
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
      })();
    }, AUTO_SYNC_MS);
    return () => {
      clearInterval(timer);
    };
  }, [queryClient, enabled, configured]);
}
