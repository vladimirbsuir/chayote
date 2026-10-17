import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { updatesApi } from '../lib/ipc';
import { useSettingsStore } from '../stores/settings';
import { qk } from '../queries/keys';
import type { AppInfo, DownloadEvent, UpdateSummary } from '../types/update';

/* ADR-024. The updater is server state like notes and sync
   (`02-architecture.md` §5): the Rust engine owns it and TanStack Query caches
   what it last said. The daily tick lives here rather than in Rust because
   deciding *when* to look is a UI concern — the settings store knows when the
   last check was, and Rust has no reason to. */

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** True when a day has passed since the last attempt. `null` has never checked,
    so the answer is yes: a first run should look once and then go quiet.

    A stored timestamp in the future counts as due rather than as "checked very
    recently". It means the clock moved backwards or the file was hand-edited,
    and treating it as fresh would ration checks off until real time caught up —
    a settings file should never be able to disable updates indefinitely. */
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
    /* Fixed for the life of the process — an installed update ends it — so there
       is nothing here a refetch could change. */
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });
  return { info: query.data, isPending: query.isPending };
}

export function useCheckForUpdate(): {
  check: () => Promise<UpdateSummary | null>;
  isChecking: boolean;
  /** The update the last check found, or `null`. Survives a failed check on
      purpose: an update that was real a minute ago is still real, and taking
      away the Install button because the network bliped would be worse than
      showing a version string that the install verifies anyway. */
  update: UpdateSummary | null;
  /** True once *this* hook's check has completed. Distinct from the persisted
      `lastUpdateCheckAt`, which the silent daily tick also writes: without this
      the tab would claim "up to date" from a check it never ran and never saw
      the result of. */
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

/** Download progress, accumulated from the install channel. Bytes rather than a
    percentage, because the percentage is a rendering decision and these are the
    facts — and `contentLength` is `null` when the server does not say, in which
    case there is nothing to divide by and the bar has to go indeterminate. */
export function useInstallUpdate(): {
  install: () => Promise<void>;
  isInstalling: boolean;
  downloaded: number;
  total: number | null;
  error: string | null;
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
    downloaded,
    total,
    error: failureOf(mutation.error, 'The update could not be installed.'),
  };
}

/** A rejected `invoke` is the error contract's wire shape — `{ code, message,
    details? }` — and not an `Error` instance (`10-conventions.md` §6), so
    `instanceof` would silently read every failure as "no error". `details` is
    the transport failure and stays out of this; the log is where it belongs. */
type WireError = { code?: unknown; message?: unknown };

function wireOf(error: unknown): WireError | null {
  /* No cast: every object is assignable to a type whose fields are all
     optional `unknown`, and a cast here is what the lint rule objects to. */
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

/** Once a day, in the background, saying nothing (`05-ui-ux.md` §6.6). The tab
    is where an update surfaces; a banner nobody asked for is not.

    Nothing happens on a platform that cannot update, so a macOS or Android build
    never opens a socket for this. The timestamp is written whether the check
    succeeded or failed, because the attempt is what is being rationed — a failed
    check retried on every launch would be a request per launch for ever. */
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
        /* Silent by design, per the note above. A background tick must not
           interrupt typing and there is no surface for it to report into. */
      })
      .finally(() => {
        record(Date.now());
      });
  }, [supported, lastCheckedAt, record]);
}