/* Pre-sync editor flush for the open-editor guard (`07-sync-plan.md` Phase E).
 *
 * The sync engine defers a pull that would change the note on screen, but it
 * can only arbitrate what SQLite holds. Keystrokes still inside the 800 ms
 * autosave debounce live in TipTap alone — so every sync entry point flushes
 * first, and the pull then sees the user's actual document (dirty, parked on
 * conflict) instead of overwriting the row beneath unsaved typing.
 *
 * One registry rather than a store: exactly one `EditorPane` is mounted at a
 * time, and the flush is a function of its autosave instance, not renderable
 * state. `useSync` is the only caller. */

let flusher: (() => Promise<void>) | null = null;

export function registerSyncFlusher(next: (() => Promise<void>) | null): void {
  flusher = next;
}

export async function flushEditorsForSync(): Promise<void> {
  if (flusher !== null) await flusher();
}
