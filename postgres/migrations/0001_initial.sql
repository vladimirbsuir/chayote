CREATE SEQUENCE IF NOT EXISTS sync_rev_seq;

CREATE TABLE IF NOT EXISTS folders (
  id         UUID    PRIMARY KEY,
  name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  parent_id  UUID    REFERENCES folders(id) ON DELETE CASCADE,
  position   BIGINT  NOT NULL DEFAULT 0,
  rev        BIGINT  NOT NULL DEFAULT nextval('sync_rev_seq'),
  created_at BIGINT  NOT NULL,
  updated_at BIGINT  NOT NULL,
  deleted_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id, position);

CREATE TABLE IF NOT EXISTS tags (
  id         UUID   PRIMARY KEY,
  name       TEXT   NOT NULL,
  rev        BIGINT NOT NULL DEFAULT nextval('sync_rev_seq'),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_live
  ON tags(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS notes (
  id           UUID    PRIMARY KEY,
  title        TEXT    NOT NULL DEFAULT '',
  title_source TEXT    NOT NULL DEFAULT 'auto'
                       CHECK (title_source IN ('auto','manual','first_heading')),
  doc_json     JSONB   NOT NULL,
  plain_text   TEXT    NOT NULL DEFAULT '',
  excerpt      TEXT    NOT NULL DEFAULT '',
  word_count   BIGINT  NOT NULL DEFAULT 0,
  folder_id    UUID    REFERENCES folders(id) ON DELETE SET NULL,
  is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
  rev          BIGINT  NOT NULL DEFAULT nextval('sync_rev_seq'),
  created_at   BIGINT  NOT NULL,
  updated_at   BIGINT  NOT NULL,
  deleted_at   BIGINT,
  synced_at    BIGINT
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id    UUID   NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id     UUID   NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);
