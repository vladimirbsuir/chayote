import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { updatesApi } from '../lib/ipc';
import { useSettingsStore } from '../stores/settings';
import { qk } from '../queries/keys';
import type { AppInfo, DownloadEvent, UpdateSummary } from '../types/update';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isCheckDue(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null || now < lastCheckedAt) return true;
  return now - lastCheckedAt >= CHECK_INTERVAL_MS;
}

export function useAppInfo(): {
  info: AppInfo | undefined;
  isPending: boolean;
} {
  const query = useQuery({
    queryKey: qk.appInfo(),
    queryFn: () => updatesApi.info(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });
  return { info: query.data, isPending: query.isPending };
}

export function useCheckForUpdate(): {
  check: () => Promise<UpdateSummary | null>;
  isChecking: boolean;
  update: UpdateSummary | null;
  hasChecked: boolean;
  error: string | null;
  errorCode: string | null;
} {
  const record = useSettingsStore((state) => state.setLastUpdateCheckAt);
  const mutation = useMutation({
    mutationFn: async () => {
      const found = await updatesApi.check();
      record(Date.now());
      return found;
    },
  });

  return {
    check: () => mutation.mutateAsync(),
    isChecking: mutation.isPending,
    update: mutation.data ?? null,
    hasChecked: mutation.isSuccess,
    error: failureOf(mutation.error, 'Could not check for updates.'),
    errorCode: codeOf(mutation.error),
  };
}

export function useInstallUpdate(): {
  install: () => Promise<void>;
  isInstalling: boolean;
  installed: boolean;
  downloaded: number;
  total: number | null;
  error: string | null;
  errorCode: string | null;
} {
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      updatesApi.install((event: DownloadEvent) => {
        if (event.event === 'started') {
          setDownloaded(0);
          setTotal(event.data.contentLength);
        } else if (event.event === 'progress') {
          setDownloaded((current) => current + event.data.chunkLength);
        }
      }),
  });

  return {
    install: () => mutation.mutateAsync(),
    isInstalling: mutation.isPending,
    installed: mutation.isSuccess,
    downloaded,
    total,
    error: failureOf(mutation.error, 'The update could not be installed.'),
    errorCode: codeOf(mutation.error),
  };
}

type WireError = { code?: unknown; message?: unknown };

function wireOf(error: unknown): WireError | null {
  return typeof error === 'object' && error !== null ? error : null;
}

function codeOf(error: unknown): string | null {
  const code = wireOf(error)?.code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

function failureOf(error: unknown, fallback: string): string | null {
  if (error === null || error === undefined) return null;
  const message = wireOf(error)?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export function useDailyUpdateCheck(): void {
  const { info } = useAppInfo();
  const lastCheckedAt = useSettingsStore((state) => state.lastUpdateCheckAt);
  const record = useSettingsStore((state) => state.setLastUpdateCheckAt);
  const supported = info?.updatesSupported === true;

  useEffect(() => {
    if (!supported || !isCheckDue(lastCheckedAt, Date.now())) return;
    void updatesApi
      .check()
      .catch(() => {
      })
      .finally(() => {
        record(Date.now());
      });
  }, [supported, lastCheckedAt, record]);
}