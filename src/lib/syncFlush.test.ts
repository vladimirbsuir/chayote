import { describe, expect, it, vi } from 'vitest';
import { flushEditorsForSync, registerSyncFlusher } from './syncFlush';

/* The pre-sync flush registry: with no editor mounted there is nothing to
   flush, and the mounted pane's flush runs before every sync entry point. */

describe('syncFlush', () => {
  it('resolves with no editor mounted', async () => {
    registerSyncFlusher(null);
    await expect(flushEditorsForSync()).resolves.toBeUndefined();
  });

  it('calls the registered flusher exactly once', async () => {
    const flush = vi.fn(() => Promise.resolve());
    registerSyncFlusher(flush);
    await flushEditorsForSync();
    expect(flush).toHaveBeenCalledTimes(1);
    registerSyncFlusher(null);
  });
});
