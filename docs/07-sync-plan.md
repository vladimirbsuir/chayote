# 07 — Sync Plan (Supabase / Postgres)

**Status:** Direction frozen, implementation **not started**. Last updated 2026-10-07.

**v1 ships without sync.** This document exists so the v1 code does not paint us into a corner, and so the later phase has a design instead of a blank page. Nothing here is implemented in v1. What *is* implemented in v1 is the outbox table and the schema fields that this plan depends on — see `03-data-model.md` §3.7.

---

## 1. Principles

1. **Local-first.** The app is fully functional with no account and no network. Sync is an accelerator, never a dependency.
2. **The device is the source of truth for its own edits.** The server is a replication target and an arbiter of revision numbers, not an authority over content.
3. **Push-only writes.** The client never waits for a server round trip to make an edit durable.
4. **Never silently lose data.** Any conflict that cannot be resolved automatically leaves both versions on disk.
5. **The user owns their data.** Export is always possible. Deleting the account does not require contacting anyone.

## 2. Architecture

```
┌──────────────┐
│ React UI     │
└──────┬───────┘
       │ repository trait
┌──────▼──────────┐         ┌─────────────────────┐
│ SQLite + outbox │◄───────►│ Supabase            │
│ (always)       │  drain  │ Postgres + RLS      │
└─────────────────┘         │ Realtime (optional) │
                            └─────────────────────┘
```

The same repository trait has two implementations: `SqliteNotesRepo` (v1) and `SupabaseNotesRepo` (later). The sync layer is a coordinator above the trait that drains the outbox and applies inbound changes. It is not a third data path.

## 3. Phase plan

| Phase | Scope | Milestone |
|-------|-------|-----------|
| A | Schema in Postgres, RLS policies, Supabase Auth, nothing wired | post-v1.0 |
| B | Push: outbox drain loop, one entity type at a time, tags → folders → notes | post-v1.1 |
| C | Pull: incremental fetch by `rev` watermark, apply with conflict checks | post-v1.1 |
| D | Bootstrap: first sign-in uploads the local database | post-v1.1 |
| E | Background sync, retry, status UI, per-device settings | post-v1.2 |
| F | Search across devices (`tsvector`) | post-v1.2 |
| G | Optional realtime push | not planned |

Each phase ships behind a feature flag and is disabled by default. A user who never signs in runs exactly the v1 build.

## 4. Postgres schema and RLS

Every table carries `user_id uuid NOT NULL REFERENCES auth.users(id)`, plus `rev bigint NOT NULL DEFAULT 0`, `updated_at bigint NOT NULL`, `deleted_at timestamptz`.

RLS, enabled on every table, with no policy that grants access across users:

```sql
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_own ON notes
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

The same four statements repeat for `folders`, `tags`, `note_tags`. There is no shared-note model in v1, so `USING` and `WITH CHECK` are the same predicate. Security-definer functions are avoided; service-role keys never reach the client.

`user_id` is the only column the local database does not have. Adding it later is a migration, not a redesign, because no local query filters on it.

## 5. Conflict policy

Last-write-wins is the default, with an explicit exception per entity type. A conflict is detected when a push carries `base_rev` lower than the server's current `rev`.

### 5.1 Notes — three-way merge on `doc_json`

Text is not merged blindly. LWW on a whole document loses work silently, which violates principle 4.

| Situation | Resolution |
|-----------|------------|
| Local changed, remote unchanged | Push local. Clear `dirty`. |
| Remote changed, local clean | Accept remote. Update `rev`, `synced_at`. |
| Both changed, but disjoint fields (`folder_id`, `is_pinned`, tags) | Merge fields independently. |
| Both changed `doc_json` | **Never auto-resolve.** |

For the both-changed document case:

1. Keep the local document as the live one.
2. Write the remote document to a `conflicts` table with `note_id`, `local_rev`, `remote_rev`, `remote_doc`, `created_at`.
3. Show a non-modal badge in the sidebar.
4. The user picks: keep local, use remote, or view both.

Automatic three-way merging at the paragraph level is explicitly rejected for now. A silently wrong merge is worse than a visible conflict, and the conflict rate for a personal notes app is low enough that a manual prompt is acceptable.

### 5.2 Folders and tags — LWW per row

- Same row, both changed: higher `updated_at` wins, loser rebases.
- Concurrent rename to the same name: both applied; duplicate names are legal (`03-data-model.md` §3.2).
- Concurrent delete and rename: the delete wins, the rename is discarded, the row is tombstoned.
- Concurrent move of a folder: LWW on `parent_id`. Not ideal, acceptable.

A tree cannot be merged structurally in v1. Documented limitation.

### 5.3 `note_tags` — set union, then LWW

A many-to-many join cannot be row-merged. Treat a note's tag set as one set-valued field and union the local and remote sets. Removing a tag on one device while adding a different tag on another keeps both. Removing a tag is only truly honoured when it is applied as a whole-set replacement by a single device that saw the previous full set.

This asymmetry is a known, accepted cost of using a relational model for something Obsidian solves with a set-based CRDT. If tag-removal sync proves unreliable in practice, the escape hatch is a `doc_tags jsonb` column on `notes` that is replaced wholesale, which resolves the whole set and needs no union rule.

### 5.4 Deletes

Soft deletes propagate as tombstone writes. Tombstones are retained server-side for 90 days before hard deletion, and locally until every device has acknowledged past the tombstone's `rev`. Permanent delete is refused while `rev` has never been synced, so a never-pushed note cannot vanish from another device without ever existing there.

## 6. Bootstrap

First sign-in on a device with existing local data:

1. Create the user, get `user_id`, set it on all local rows in one transaction.
2. Push everything through the normal outbox path, in dependency order: tags → folders → notes → `note_tags`.
3. Only then enable the pull path.
4. If a row's ID already exists remotely, treat it as a conflict per §5.

Alternative — sign in before creating anything — makes bootstrap trivial but forces an account at first launch, which contradicts principle 1. Bootstrap order stays local-first.

## 7. Authentication

Supabase Auth. Email magic link on desktop; on Android, magic link plus Google sign-in.

- Tokens in the OS keychain via `@tauri-apps/plugin-stronghold`, never in SQLite, never in settings.
- No `INTERNET` permission until Phase B.
- Deleting the local account unlinks the device and keeps local data.
- Deleting the Supabase account deletes remote data. The UI states this plainly, including what happens to local notes, before the action is confirmed.

## 8. Sync loop

```
on app start      → pull since watermark
on interval (60s) → drain outbox → pull since watermark
on app background → drain outbox only, best effort
on local write     → nothing; the outbox already has the row
```

| Concern | Policy |
|---------|--------|
| Batch size | 50 rows |
| Ordering | Within a batch: tags → folders → notes → `note_tags` |
| Retry | Exponential backoff from 2 s, cap 5 min, jitter ±20 % |
| `attempts` | Incremented per failure, reset on success |
| Permanently failing row | Kept in the outbox, `last_error` set, surfaced in the sync status UI. Never discarded. |
| Watermark | `max(rev)` of the last successful pull, persisted in settings |
| Offline | Detected by request failure. All activity is deferred, never blocked. |
| Concurrency | One sync cycle at a time, guarded by an in-process lock |

## 9. Data integrity across the two engines

The two databases will disagree over time. Three scheduled repairs, run from the sync status UI, never automatically:

| Check | Action |
|-------|--------|
| `notes.doc_json` fails schema validation | Remote version replaced with local |
| `title` or `plain_text` disagree with the derivation from `doc_json` | Recompute from `doc_json`, push |
| Row count differs between local and remote | Full pull for the missing ids, no deletions |

Derivation is deterministic (`03-data-model.md` §4), so these are checks, not guesses. A device that has never synced has no `synced_at` and is skipped entirely.

## 10. Effort estimate

| Phase | Estimate |
|-------|----------|
| A — schema, RLS, Auth | 1.5 days |
| B — push | 3 days |
| C — pull | 2 days |
| D — bootstrap | 1 day |
| E — background, retry, status UI | 3 days |
| F — server search | 1 day |
| **Total** | **~12 days** |

Roughly 12 days of work added to a ~20-day v1. The reason v1 does not include it is not effort: it is that an account gate in front of a notes app is a worse product than no sync at all.

## 11. Rejected alternatives

| Alternative | Why not |
|-------------|---------|
| Supabase Realtime for live updates | A permanent WebSocket contradicts the offline guarantee and adds a connection lifecycle. Polling is sufficient for a personal notes app. |
| Yjs / CRDT documents | Excellent merge semantics, but it changes the storage model from a JSON document to a CRDT update log, which invalidates FTS5 over `plain_text`, complicates the whole-document save model, and roughly doubles editor complexity. Only justified if real-time collaboration ever becomes a requirement. |
| A hosted sync service (e.g. a notes vendor's API) | Locks the data model to a third-party schema. Contradicts principle 5. |
| CouchDB / PouchDB | Correct replication semantics, but a second persistence technology to maintain in a Rust-first app, and no natural Postgres host for it. |
| WebSocket-free polling with `If-Modified-Since` | Only workable once the data exceeds a few thousand rows; `rev` watermarks are simpler. |

## 12. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `doc_json` conflicts annoy users | Medium | The conflict badge is non-blocking and rare; conflicts are resolvable in two taps |
| Two SQLite engines diverge | Medium | §9 integrity checks, on demand |
| Outbox grows unbounded offline | Low | Rows are pruned after 30 days post-sync; the table is small |
| The `dirty` flag becomes inconsistent with the outbox | Low | Both are written in one transaction; an integrity check compares counts |
| Device clock skew breaks LWW | Medium | `rev`, not the clock, is authoritative. Clocks only order user-visible timestamps. |
| Android foreground sync drains battery | Low | Sync is foreground-only; intervals back off when backgrounded |