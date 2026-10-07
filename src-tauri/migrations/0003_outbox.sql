-- 0003_outbox.sql — sync write-ahead log and trash snapshots
-- `03-data-model.md` §3.7–§3.8. Written from day one, drained by nothing
-- until the sync phase (ADR-005).

CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT    NOT NULL CHECK (entity IN ('note','folder','tag','note_tags')),
  entity_id  TEXT    NOT NULL,
  op         TEXT    NOT NULL CHECK (op IN ('upsert','delete')),
  payload    TEXT,
  base_rev   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sent_at    INTEGER,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS trash_snapshots (
  id         TEXT    PRIMARY KEY NOT NULL,
  root_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('folder','note')),
  payload    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trash_root ON trash_snapshots(root_id);