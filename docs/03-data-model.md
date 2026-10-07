# 03 — Data Model

**Status:** Frozen. Last updated 2026-10-07.

Authoritative SQL lives in `src-tauri/migrations/`. This document defines the schema, its invariants, and the mapping to Postgres.

---

## 1. Conventions

| Rule | Value |
|------|-------|
| Primary key | `id TEXT PRIMARY KEY`, UUIDv7 string, generated client-side (**rule R1**) |
| Timestamps | `INTEGER NOT NULL`, UTC epoch milliseconds (**rule R2**) |
| Soft delete | `deleted_at INTEGER` NULL, filter with `deleted_at IS NULL` (**rule R3**) |
| Server revision | `rev INTEGER NOT NULL DEFAULT 0` (**rule R4**) |
| Dirty marker | `dirty INTEGER NOT NULL DEFAULT 1`, `1`/`0` (**rule R4**) |
| Booleans | `INTEGER` with a `CHECK (col IN (0,1))` constraint |
| Ordering, folders | `position INTEGER NOT NULL DEFAULT 0`, siblings ordered ascending — **manually reorderable** |
| Ordering, notes | **No `position` column.** Sorted by `is_pinned DESC, updated_at DESC` — **not manually reorderable in v1** |
| Text | `TEXT NOT NULL`, no length limit, never `VARCHAR(n)` |
| Money, quantities | Not applicable in v1 |

Notes are **not** manually reorderable in v1. The decision is recorded in `09-decisions.md` ADR-011 and the reasoning in §5.4 below. Folders keep `position` because folder trees need explicit order and the drag interaction already exists for re-parenting.

`CHECK` constraints on text length are deliberately omitted. They cause migration pain and give no real benefit at personal-note scale.

## 2. Connection pragmas

Applied on every open, before any query.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

| Pragma | Reason |
|--------|--------|
| `WAL` | Readers do not block the autosave writer. Critical because search reads while a save commits. |
| `synchronous = NORMAL` | One fsync per WAL checkpoint rather than per commit. With WAL this is crash-safe against application crash; only a power loss can lose the last transactions. |
| `foreign_keys = ON` | Off by default in SQLite. Required for the cascades below. |
| `busy_timeout` | Prevents transient `SQLITE_BUSY` when the outbox and UI touch the DB concurrently. |

## 3. Schema

### 3.1 `schema_migrations`

```sql
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY NOT NULL,
  name        TEXT    NOT NULL,
  applied_at  INTEGER NOT NULL
);
```

### 3.2 `folders`

```sql
CREATE TABLE folders (
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

CREATE INDEX idx_folders_parent   ON folders(parent_id, position);
CREATE INDEX idx_folders_dirty    ON folders(dirty)          WHERE dirty = 1;
CREATE INDEX idx_folders_live     ON folders(deleted_at)     WHERE deleted_at IS NULL;
```

Notes on the design:

- **Self-referencing `parent_id`** rather than a separate adjacency table. A tree is a tree; an extra join buys nothing at this scale.
- **`ON DELETE CASCADE` on self-reference.** A folder cannot be hard-deleted while children exist; a permanent delete of a branch deletes the whole subtree, which is the only sane semantic for nested folders. The trash keeps a record of the subtree at the time of soft delete (§3.8).
- **`position` is a sibling-local integer**, densified on every move. No fractional indexing in v1: moves are user-initiated and infrequent, so renumbering siblings in one transaction is cheap and avoids the drift that gap-based ordering accumulates.
- **No uniqueness constraint on `(parent_id, name)`.** Duplicate folder names are permitted; a personal notes app has no navigation that depends on unique names, and the constraint would create confusing sync conflicts.

### 3.3 `notes`

```sql
CREATE TABLE notes (
  id          TEXT    PRIMARY KEY NOT NULL,
  title       TEXT    NOT NULL DEFAULT '',
  title_source TEXT   NOT NULL DEFAULT 'auto'
                    CHECK (title_source IN ('auto','manual','first_heading')),
  doc_json    TEXT    NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
  plain_text  TEXT    NOT NULL DEFAULT '',
  excerpt     TEXT    NOT NULL DEFAULT '',
  word_count  INTEGER NOT NULL DEFAULT 0,
  folder_id   TEXT    REFERENCES folders(id) ON DELETE SET NULL,
  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  rev         INTEGER NOT NULL DEFAULT 0,
  dirty       INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  synced_at   INTEGER
);

CREATE INDEX idx_notes_live        ON notes(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_folder      ON notes(folder_id, is_pinned DESC, updated_at DESC);
CREATE INDEX idx_notes_updated     ON notes(updated_at DESC);
CREATE INDEX idx_notes_dirty       ON notes(dirty) WHERE dirty = 1;
CREATE INDEX idx_notes_pinned      ON notes(is_pinned) WHERE is_pinned = 1 AND deleted_at IS NULL;
```

Column-by-column rationale:

| Column | Why it exists |
|--------|----------------|
| `title` | **Derived.** Search and list rendering need it without walking every document. Recomputed on every write (**rule R9**). |
| `title_source` | Records whether the user typed a title. `auto` means the title will be overwritten by derivation on the next save, so the UI must not let the user type into it. |
| `doc_json` | The source of truth. The only authored content field. |
| `plain_text` | Derived. Search index input and previews. Never read back into the editor. |
| `excerpt` | Derived, first ~200 characters of `plain_text`, used by the note list and Android list. Avoids loading whole documents to render a list. |
| `word_count` | Derived. Cheap status-bar value, avoids a full document parse on open. |
| `folder_id` | `ON DELETE SET NULL`, not cascade. A note must survive its folder being destroyed; it becomes unfiled. |
| `is_pinned` | The only ordering flag in v1. Pinned notes sort above everything regardless of folder. Replaces the earlier `is_favorite`; see ADR-011. |
| `synced_at` | Last successful push. `NULL` means never pushed. Distinct from `dirty`, which is about *this* device's pending changes. |

**Deliberately absent:** `position` (no manual note order in v1), `is_favorite` (folded into `is_pinned`), `html`, `markdown`, `tags` (as text), `attachments`. Tags live in a join table; content has exactly one serialised form.

### 3.4 `tags`

```sql
CREATE TABLE tags (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  rev        INTEGER NOT NULL DEFAULT 0,
  dirty      INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX idx_tags_name_live ON tags(name) WHERE deleted_at IS NULL;
CREATE INDEX idx_tags_dirty ON tags(dirty) WHERE dirty = 1;
```

Tag names are case-insensitive unique among live tags: `Work`, `work`, and `WORK` are the same tag and are normalised to the first-created spelling. The `COLLATE NOCASE` on the column plus the partial unique index gives this without application-level case folding that Postgres would disagree with.

The partial index, not the table-level `UNIQUE`, is what allows a soft-deleted `work` tag to coexist with a live `work` tag.

### 3.5 `note_tags`

```sql
CREATE TABLE note_tags (
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);
```

A join table rather than a JSON column or a delimited string. Reasons: referential integrity, cheap tag→notes queries, cheap cascade delete, and a shape that Postgres implements identically. `WITHOUT ROWID` saves an index because the primary key *is* the rowid.

**Sync note:** a many-to-many join table cannot be merged by last-write-wins. The sync phase treats the tag set of a note as a single set-valued field with set-union merge semantics — see `07-sync-plan.md` §5.3.

### 3.6 Full-text search

External-content FTS5: the index references `notes` rather than duplicating rows.

```sql
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title,
  plain_text,
  content='notes',
  content_rowid='rowid',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'"
);

CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, new.plain_text);
END;

CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, old.plain_text);
END;

CREATE TRIGGER notes_fts_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, old.plain_text);
  INSERT INTO notes_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, new.plain_text);
END;
```

Triggers, not application-side index updates, because the index must never be able to drift from the table. A bug that skips an application code path cannot corrupt search.

`tokenchars '_'` keeps `snake_case` identifiers and `#tag`-style words from being shredded. `remove_diacritics 2` makes `café` match `cafe`, which is what a user typing on a phone keyboard without accents expects.

Rebuild after a migration that touches indexed columns:

```sql
INSERT INTO notes_fts(notes_fts) VALUES ('rebuild');
```

**Search query**

```sql
SELECT
  n.id, n.title, n.excerpt, n.folder_id, n.is_pinned, n.updated_at,
  bm25(notes_fts, 8.0, 1.0) AS rank,
  snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12) AS snippet
FROM notes_fts
JOIN notes n ON n.rowid = notes_fts.rowid
WHERE notes_fts MATCH :query
  AND n.deleted_at IS NULL
  AND (:folder_id   IS NULL OR n.folder_id = :folder_id)
  AND (:tag_id      IS NULL OR EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = :tag_id))
  AND (:pinned_only = 0      OR n.is_pinned = 1)
ORDER BY rank
LIMIT :limit OFFSET :offset;
```

`bm25` weights of 8.0 for title and 1.0 for body make a title hit outrank roughly eight body hits, which matches intuition. FTS5 returns *more negative* values for better matches, so `ORDER BY rank ASC` is correct.

**Query sanitisation is mandatory.** `MATCH` takes a query expression, not a string. Wrap every user token:

```rust
fn to_fts_match(input: &str) -> Option<String> {
    let tokens: Vec<String> = input
        .split_whitespace()
        .filter_map(|t| {
            let cleaned: String = t
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if cleaned.is_empty() { None } else { Some(format!("{cleaned}*")) }
        })
        .collect();
    if tokens.is_empty() { None } else { Some(tokens.join(" AND ")) }
}
```

Trailing `*` makes the last token a prefix match, so results appear while typing. If sanitisation yields nothing, the search falls back to `updated_at DESC` over the active filter rather than returning an error.

### 3.7 `outbox`

The sync write-ahead log. Written from day one, drained by nothing until the sync phase.

```sql
CREATE TABLE outbox (
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

CREATE INDEX idx_outbox_pending ON outbox(created_at) WHERE sent_at IS NULL;
```

The pending-rows partial index is what the drain loop scans. Every service write appends here in the same transaction as the row write (**rule R5**); if the process dies between the two, neither happened.

For `note_tags`, `entity_id` is a hash of the sorted `(note_id, tag_id)` pairs so that a set change collapses to one outbox row per note per drain cycle.

### 3.8 `trash_snapshots`

Preserves a deleted subtree so that permanent delete is genuinely permanent and restorable-into-shape is possible.

```sql
CREATE TABLE trash_snapshots (
  id         TEXT    PRIMARY KEY NOT NULL,
  root_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('folder','note')),
  payload    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_trash_root ON trash_snapshots(root_id);
```

Written when a folder is soft-deleted, capturing the entire descendant set. A note soft delete needs no snapshot: its row already exists with `deleted_at` set.

## 4. Derived value computation

Computed in Rust inside the save transaction (**rule R9**). None of these are ever sent from the frontend.

### 4.1 Title

```
if title_source = 'manual'  -> keep title as-is
else if title_source = 'first_heading' -> title = text of the first heading in the doc
else -> title = text of the first non-empty block, truncated to 120 chars
   -> if the result is empty: "Untitled"
```

### 4.2 Plain text

A recursive walk of the ProseMirror tree:

- Text nodes contribute their `text`.
- Inline marks (bold, italic, code, link) are transparent — their text is included as-is.
- Hard breaks contribute `\n`.
- Block nodes terminate with `\n`.
- Images and other atom nodes contribute their `alt` text or nothing.

Result is truncated to 200 000 characters before storage. Beyond that the note is pathological, and the limit bounds both the FTS index and the memory cost of derivation.

### 4.3 Excerpt and word count

`excerpt` = `plain_text` collapsed to single spaces, truncated at 200 characters on a word boundary.
`word_count` = `plain_text.split_whitespace().count()`.

## 5. Canonical queries

Reference implementations. All of them filter `deleted_at IS NULL` unless the caller explicitly asks for trash.

**Notes in a selection**

```sql
SELECT id, title, excerpt, folder_id, is_pinned, word_count, updated_at
FROM notes
WHERE deleted_at IS NULL
  AND (:folder_id  IS NULL OR folder_id = :folder_id)
  AND (:pinned     = 0     OR is_pinned = 1)
  AND (:tag_id     IS NULL OR EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = notes.id AND nt.tag_id = :tag_id))
ORDER BY is_pinned DESC, updated_at DESC
LIMIT :limit OFFSET :offset;
```

Pinned notes sort first across the whole selection, not just within a folder, so a pinned note in another folder is still visible at the top of the current list. This matches how every mail client behaves and is the single most useful ordering behaviour in the app.

### 5.4 Why notes are not manually reorderable

Rejected for v1. The reasoning, so it is not relitigated without new information:

1. **The interaction is awkward on both platforms.** Drag-reordering a vertical list needs a long-press threshold on Android to avoid conflicting with scroll, and it has no keyboard equivalent. The `05-ui-ux.md` §10 keyboard requirement would need a "move up / move down" command pair to satisfy.
2. **The value is low.** Notes are found by recency, search, and pinning. Someone who wants a manual order wants folders, and folders are the ordering mechanism that does have keyboard support.
3. **The cost is not just the UI.** A `position` column that is user-editable means renumbering transactions on every drag, plus an extra drag interaction to test on touch.
4. **It is cheap to add later.** The column, the query change, and the drag handler are additive. Nothing in v1 depends on its absence.

What would change this decision: if users routinely create ordered lists of notes — a reading queue, a checklist that must stay in sequence — rather than collections that search or recency order well.

**Folder tree** — built in Rust by loading all live folders ordered by `(parent_id, position)` and assembling the tree in memory. A recursive CTE is unnecessary at the expected size (hundreds of folders) and produces a shape that is awkward to map back to the UI.

**Tags with note counts**

```sql
SELECT t.id, t.name, COUNT(nt.note_id) AS count
FROM tags t
LEFT JOIN note_tags nt ON nt.tag_id = t.id
LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.name
HAVING count > 0
ORDER BY t.name COLLATE NOCASE;
```

The `HAVING count > 0` hides tags whose notes are all in the trash — an empty filter in the sidebar is noise.

**Trash** — same as notes in a selection, with `deleted_at IS NOT NULL ORDER BY deleted_at DESC`.

**Integrity check** — run in debug builds and in tests, never in production:

```sql
PRAGMA integrity_check;
SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'integrity';  -- forces a full scan
SELECT COUNT(*) FROM notes WHERE dirty = 1;                          -- must match outbox row count
```

## 6. Migrations

Forward-only, numbered, each applied in its own transaction and recorded in `schema_migrations` (**rule R8**).

```
src-tauri/migrations/
  0001_initial.sql        -- folders, notes, tags, note_tags
  0002_fts.sql            -- notes_fts + triggers
  0003_outbox.sql         -- outbox, trash_snapshots
  0004_note_title_source.sql
```

Rules:

1. Never edit an applied migration. Add a new one.
2. Every migration is idempotent where SQLite allows it: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE TRIGGER IF NOT EXISTS`. `ALTER TABLE ADD COLUMN` is not idempotent — guard it with a `PRAGMA table_info` check in Rust before running it.
3. A migration that changes an indexed column must run `INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')` at the end.
4. A migration must never rewrite the `notes` table with `DROP`/`CREATE`. The FTS triggers reference `notes` by name and `rowid`; recreating the table invalidates the external-content mapping and requires a full rebuild.

## 7. Migration path to Postgres

The mapping for the sync phase. `07-sync-plan.md` covers the protocol; this table is the schema contract.

| SQLite | Postgres | Notes |
|--------|----------|-------|
| `TEXT` id (UUIDv7) | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Client always supplies the value. The default exists only for server-side tooling. |
| `INTEGER` epoch ms | `timestamptz(3)` | Convert on the wire as ISO-8601 UTC with milliseconds, or epoch ms — **pick one and pin it**. Recommended: epoch ms as `bigint` to avoid timezone bugs entirely. |
| `INTEGER` 0/1 | `boolean` | |
| `INTEGER` position (folders only) | `integer` | Notes have no `position` in v1 |
| `deleted_at INTEGER` | `timestamptz` nullable | |
| `rev INTEGER` | `bigint NOT NULL DEFAULT 0` | Server-assigned, incremented on every accepted write. |
| `dirty INTEGER` | *dropped* | Replaced by a `sync_state` view or by comparing `updated_at` against `last_pulled_at`. Dirty is a local-only concept. |
| `doc_json TEXT` | `jsonb` | Enables partial queries later. |
| `notes_fts` | `notes_search` with `tsvector GENERATED ALWAYS AS (...) STORED` + GIN index | See below. |
| `FTS5 MATCH` + `bm25()` | `ts_rank_cd()` + `ts_headline()` | Different ranking, same query surface. |
| Recursive CTE tree | Same recursive CTE | |

**Search is the one component that is not portable.** FTS5 does not exist in Postgres. The server search must be Postgres full-text search with `english` or `simple` config, `to_tsvector('simple', title || ' ' || plain_text)`, a GIN index, and `websearch_to_tsquery` for user input. `websearch_to_tsquery` is the correct replacement for the hand-rolled sanitisation in §3.6 — it accepts user input directly and safely.

This asymmetry is intentional and was accepted knowingly: local search stays on FTS5 because it is instant and offline, and server search exists only to search across devices. See `09-decisions.md` ADR-006.

## 8. Capacity assumptions

| Metric | Assumed |
|--------|---------|
| Notes | 10 000 |
| Average document size | 2 KB |
| Average plain text | 1.2 KB |
| Total `notes` size | 20 MB |
| FTS5 index overhead | ~1.3× content size, ~26 MB |
| Database file with WAL | ~60 MB after 5 years |
| Folders | 200 |
| Tags | 300 |

At 10 000 notes the full-text search budget in `02-architecture.md` §8 holds without any optimisation beyond the indexes listed above. If measurements disagree, the first lever is a `plain_text` length cap in §4.2, not a different search engine.