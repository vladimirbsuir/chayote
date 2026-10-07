-- 0002_fts.sql — external-content FTS5 index and its triggers
-- `03-data-model.md` §3.6. Triggers, not application-side updates, so the
-- index can never drift from `notes`.

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  plain_text,
  content='notes',
  content_rowid='rowid',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'"
);

CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, new.plain_text);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, old.plain_text);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, old.plain_text);
  INSERT INTO notes_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, new.plain_text);
END;