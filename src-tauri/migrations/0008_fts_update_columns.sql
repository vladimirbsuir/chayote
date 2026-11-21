DROP TRIGGER IF EXISTS notes_fts_au;

CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF title, plain_text ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, old.plain_text);
  INSERT INTO notes_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, new.plain_text);
END;
