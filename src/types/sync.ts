import type { Uuid } from './note';

/* Sync shapes crossing the IPC boundary. Rust structs carry
   #[serde(rename_all = "camelCase")], so every field is camelCase here. */

export type SyncStatus = {
  configured: boolean;
  enabled: boolean;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
};

export type SyncSummary = {
  pushed: number;
  pulled: number;
  conflicts: number;
  alreadyRunning: boolean;
};

export type SyncConflict = {
  id: string;
  noteId: Uuid;
  noteTitle: string;
  localRev: number;
  remoteRev: number;
  remoteTitle: string;
  createdAt: number;
};
