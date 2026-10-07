-- 0001_initial.sql — folders, notes, tags, note_tags
-- `03-data-model.md` §3.2–§3.5. Forward-only (R8).

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  parent_id  TEXT    REFERENCES folders(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL DEFAULT 0,
  dirty      INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id, position);
CREATE INDEX IF NOT EXISTS idx_folders_dirty  ON folders(dirty)          WHERE dirty = 1;
CREATE INDEX IF NOT EXISTS idx_folders_live   ON folders(deleted_at)     WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS notes (
  id           TEXT    PRIMARY KEY NOT NULL,
  title        TEXT    NOT NULL DEFAULT '',
  title_source TEXT    NOT NULL DEFAULT 'auto'
                         CHECK (title_source IN ('auto','manual','first_heading')),
  doc_json     TEXT    NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
  plain_text   TEXT    NOT NULL DEFAULT '',
  excerpt      TEXT    NOT NULL DEFAULT '',
  word_count   INTEGER NOT NULL DEFAULT 0,
  folder_id    TEXT    REFERENCES folders(id) ON DELETE SET NULL,
  is_pinned    INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  rev          INTEGER NOT NULL DEFAULT 0,
  dirty        INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  synced_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notes_live    ON notes(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_folder  ON notes(folder_id, is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_dirty   ON notes(dirty) WHERE dirty = 1;
CREATE INDEX IF NOT EXISTS idx_notes_pinned  ON notes(is_pinned) WHERE is_pinned = 1 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  rev        INTEGER NOT NULL DEFAULT 0,
  dirty      INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_live ON tags(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tags_dirty ON tags(dirty) WHERE dirty = 1;

CREATE TABLE IF NOT EXISTS note_tags (
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);