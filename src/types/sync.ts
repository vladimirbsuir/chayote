import type { Uuid } from './note';

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
  deferred: number;
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
