-- chayote postgres/schema.sql — server-side schema for sync (07-sync-plan.md).
--
-- SINGLE-USER, single Postgres implementation. No `user_id`, no RLS, no Auth:
-- the connection string itself is the credential (it uses the postgres /
-- pooler password).
--
-- Run this ONCE on the server: paste it into your provider's SQL editor
-- (or `psql`) and run. It is idempotent (`IF NOT EXISTS`), so re-running
-- is safe.
--
-- Timestamps are BIGINT epoch milliseconds, exactly like the device SQLite
-- (03-data-model.md §7 recommends epoch ms over timestamptz to avoid
-- timezone bugs entirely). Booleans are BOOLEAN; the device maps 0/1.
--
-- `rev` comes from ONE global sequence (`sync_rev_seq`), assigned by the
-- server on every accepted write and echoed back to the device (02 R4).
-- A global sequence gives a total order across tables, so the device pull
-- watermark (`max(rev)` per table, 07 §8) never misses a row — two rows
-- pushed together still get distinct revs. The device never sends rev.

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

-- Case-insensitive uniqueness among live tags, mirroring the device partial
-- index (03 §3.4). `lower(name)` agrees with SQLite `COLLATE NOCASE` for the
-- ASCII names this index arbitrates; non-ASCII edge cases defer to LWW.
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

-- No server-side search: search stays local-only on FTS5 (`07-sync-plan.md`
-- Phase F, dropped). If this file is re-applied to a database created from
-- an earlier revision, a leftover `search` tsvector column and
-- `idx_notes_search` index may remain; both are unused and harmless.
