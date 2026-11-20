-- 0007_tags_live_unique.sql — drop the table-level UNIQUE on tags.name.
-- `03-data-model.md` §3.4. Forward-only (R8).
--
-- 0001 declared `name ... COLLATE NOCASE UNIQUE` on the column as well as the
-- partial index `idx_tags_name_live`. The column constraint covers tombstones
-- too, which is exactly what §3.4 says the partial index exists to allow: a
-- soft-deleted `work` beside a live `Work`. Uniqueness among live tags stays,
-- through the partial index, which inherits the column's NOCASE collation.
--
-- SQLite cannot drop a column constraint, so the table is rebuilt. `note_tags`
-- references `tags(id) ON DELETE CASCADE`, and DROP TABLE runs an implicit
-- DELETE with foreign keys on — which would cascade every tag link away — so
-- the links are copied aside first and restored after the rename.

CREATE TEMP TABLE note_tags_0007 AS
  SELECT note_id, tag_id, created_at FROM note_tags;

CREATE TABLE tags_0007 (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL COLLATE NOCASE,
  rev        INTEGER NOT NULL DEFAULT 0,
  dirty      INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

INSERT INTO tags_0007 (id, name, rev, dirty, created_at, updated_at, deleted_at)
  SELECT id, name, rev, dirty, created_at, updated_at, deleted_at FROM tags;

DROP TABLE tags;
ALTER TABLE tags_0007 RENAME TO tags;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_live ON tags(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tags_dirty ON tags(dirty) WHERE dirty = 1;

INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at)
  SELECT note_id, tag_id, created_at FROM note_tags_0007;

DROP TABLE note_tags_0007;
