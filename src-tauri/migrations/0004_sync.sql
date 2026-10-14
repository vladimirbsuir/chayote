-- 0004_sync.sql — sync conflicts and sync state
-- `07-sync-plan.md` §5.1 (conflicts table) and §8 (watermark).
-- Forward-only (R8).

-- Remote document parked on a both-sides-changed note conflict. The local
-- document stays live; the user resolves via keep-local / use-remote.
CREATE TABLE IF NOT EXISTS conflicts (
  id          TEXT    PRIMARY KEY NOT NULL,
  note_id     TEXT    NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  local_rev   INTEGER NOT NULL DEFAULT 0,
  remote_rev  INTEGER NOT NULL DEFAULT 0,
  remote_doc  TEXT    NOT NULL,
  remote_title TEXT   NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conflicts_note ON conflicts(note_id);

-- One parked copy per note: a newer remote supersedes the parked one via
-- ON CONFLICT (note_id) DO UPDATE in the sync engine.

-- Sync configuration and watermarks. Keys:
--   connection_string  Postgres URL (plaintext in v1; keychain with Auth later)
--   enabled            '1' / '0'
--   folders_rev, tags_rev, notes_rev
--                      `max(rev)` of the last successful pull, per table (§8)
--   last_synced_at     epoch ms of the last successful cycle
--   last_error         human-readable detail of the last failure, if any
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
