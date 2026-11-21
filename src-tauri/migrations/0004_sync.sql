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

CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
