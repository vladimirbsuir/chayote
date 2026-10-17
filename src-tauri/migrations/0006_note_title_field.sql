-- ADR-022: the title becomes a field of its own rather than a value derived
-- from the document, and the editor grows one.
--
-- No DDL here on purpose: `notes.title` and `notes.title_source` already exist
-- and the CHECK constraint already allows 'manual' (0001_initial.sql), which was
-- written for exactly this and had no way to be reached until now.
--
-- What is needed instead is a data pass over notes that were written under the
-- old rule, where the title *is* the document's leading H1. Moving it into the
-- field means rewriting `doc_json` and every derived column that follows from it,
-- which SQL cannot express (`plain_text` is a recursive walk, `03-data-model.md`
-- §4.2). The pass therefore runs in Rust, inside this migration's transaction,
-- in `src-tauri/db/migrate.rs` — so it is forward-only, versioned and atomic
-- with the version stamp, like every other migration (R8).

-- Intentionally empty.
SELECT 1;
