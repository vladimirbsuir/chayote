let flusher: (() => Promise<void>) | null = null;

export function registerSyncFlusher(next: (() => Promise<void>) | null): void {
  flusher = next;
}

export async function flushEditorsForSync(): Promise<void> {
  if (flusher !== null) await flusher();
}
