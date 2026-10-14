# 07 — Sync Plan (Supabase / Postgres)

**Status:** Direction frozen; MVP implemented on branch `feat/sync-mvp` (single general Postgres engine, no Auth, Settings → Sync tab, status + conflict UI). Phase E polish (backoff, open-editor guard, never-synced delete guard) implemented on the same branch. Last updated 2026-10-14.

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
│ SQLite + outbox │◄───────►│ Any Postgres        │
│ (always)        │  drain  │ (connection string) │
└─────────────────┘         └─────────────────────┘
```

One general Postgres implementation, no provider-specific code: the sync
layer above the repository trait drains the outbox and applies inbound
changes. It is not a third data path, and there is no second trait
implementation. There are no accounts: the connection string is the
credential, and sync is settings-gated rather than feature-flagged — a user
who never configures it runs exactly the v1 build.

## 3. Phase plan

| Phase | Scope | Status |
|-------|-------|--------|
| A | Server schema (`postgres/schema.sql`), single-user, no RLS, no Auth | done on `feat/sync-mvp` |
| B | Push: outbox drain loop, tags → folders → notes | done |
| C | Pull: incremental fetch by `rev` watermark, apply with conflict checks | done |
| D | Bootstrap: falls out of the drain; switching servers re-queues everything | done |
| E | Retry/backoff polish, open-editor guard, never-synced delete guard | done |

Phases F (cross-device search) and G (realtime push) were dropped, not
deferred: there is no server search and no live updates, by decision.

## 4. Server schema

Authoritative SQL lives in `postgres/schema.sql`, applied once per server.
Single user: no `user_id` column, no RLS, no Auth — the connection string is
the credential. Every table carries `rev bigint` from one global sequence
(`sync_rev_seq`), assigned by the server on every accepted write and echoed
back to the device (R4); timestamps are epoch-ms bigints, exactly like the
device, so there is no timezone mapping anywhere.

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

Soft deletes propagate as tombstone writes. Tombstones are retained
**indefinitely** — there is intentionally no GC: at personal scale a
tombstone is a few dozen bytes, while deleting them reopens the one real
hazard, a device offline past the retention window coming back and
resurrecting what it never saw deleted. Permanent delete is refused while
`rev` has never been synced, so a never-pushed note cannot vanish from
another device without ever existing there.

## 6. Bootstrap

First sync on a device with existing local data needs no special case: the
outbox has recorded every local write since day one, so draining it in
dependency order — tags → folders → notes → `note_tags` — *is* the upload,
and pull only starts after. If a row's ID already exists remotely, treat it
as a conflict per §5. Saving a *different* connection string re-queues
everything and restarts the watermarks, because revisions are meaningless
against a server that has never seen the device.

Recovery after a server wipe is the same operation on demand: "Re-upload
everything" (`sync_reupload`) re-queues every surviving row and restarts the
watermarks, so the next cycle pushes the whole library again. Without it, a
wiped server against clean rows and stale watermarks is permanent divergence
with no way out — a sync would push nothing (empty outbox) and pull nothing
(watermarks past every rev), and re-saving the same string is deliberately a
no-op. Idempotent upserts make running it twice harmless.

## 7. Authentication

There is none, by decision: no accounts, no sign-in, no keychain. The
connection string is the credential, stored on the device next to the
database, and sync is settings-gated rather than feature-flagged. Wiping
the server is one `TRUNCATE` (`postgres/README.md` §5); the device keeps
its notes regardless.

## 8. Sync loop

```
on interval (60s, while open) → flush editor → drain outbox → pull since watermark
on Sync now                     → flush editor → drain outbox → pull since watermark
on local write                  → nothing; the outbox already has the row
```

| Concern | Policy |
|---------|--------|
| Batch size | 50 distinct rows |
| Ordering | Within a batch: tags → folders → notes; `note_tags` rides inside its note |
| Retry | 30 s deadline per round trip; a timed-out row records `attempts`/`last_error` and its next-due time (`outbox.next_retry_at`) and never blocks the queue. Backoff is ×4 from a 30 s base (30 s, 2 min, 8 min), capped at 30 min; the drain skips not-due rows, collapsing to the latest row per entity *before* filtering so a stale state is never promoted past a waiting latest |
| Permanently failing row | Kept in the outbox, `last_error` set, surfaced in the sync status UI. Never discarded. |
| Open-editor guard | Every sync entry point flushes the autosave first; `sync_now` carries the open note id, and a pull that would change that note defers it instead — reported as `deferred` in the summary, re-fetched next cycle. Typing is never clobbered. |
| Watermark | `max(rev)` of the last successful pull per table, persisted in `sync_state`; held below a deferred row so the row is re-fetched rather than skipped |
| Offline | Detected by request failure. All activity is deferred, never blocked. |
| Concurrency | One sync cycle at a time, guarded by an in-process lock; a second caller gets `already_running` |

## 9. Data integrity across the two engines

Derivation is deterministic (`03-data-model.md` §4), so drift is checkable, not guessable. The three scheduled repairs from the original plan (schema validation, derivation recompute, row-count reconciliation from the sync status UI) are **not implemented** — open Phase-E polish, if drift ever shows in practice.

## 10. Effort estimate

The original ~12-day estimate (schema + RLS + Auth, push, pull, bootstrap,
background/retry/UI, server search) no longer describes the work: phases
A–D and the status/conflict UI shipped as the MVP on `feat/sync-mvp`
without Auth, RLS, or flags, and Phase E polish (retry with backoff, the
open-editor guard with flush-then-sync and pull deferral, and the never-synced
permanent-delete guard) followed on the same branch. What remains is §9's
repairs, unwritten until drift shows in practice. The reason sync waited past v1 stands: an account gate
in front of a notes app is a worse product than no sync at all — which is
also why there is no account at all.

## 11. Rejected alternatives

| Alternative | Why not |
|-------------|---------|
| Yjs / CRDT documents | Excellent merge semantics, but it changes the storage model from a JSON document to a CRDT update log, which invalidates FTS5 over `plain_text`, complicates the whole-document save model, and roughly doubles editor complexity. Only justified if real-time collaboration ever becomes a requirement. |
| A hosted sync service (e.g. a notes vendor's API) | Locks the data model to a third-party schema. Contradicts principle 5. |
| CouchDB / PouchDB | Correct replication semantics, but a second persistence technology to maintain in a Rust-first app, and no natural Postgres host for it. |
| WebSocket-free polling with `If-Modified-Since` | Only workable once the data exceeds a few thousand rows; `rev` watermarks are simpler. |

Live updates and cross-device search were dropped outright (see §3), not
parked here: polling on a 60 s interval is the update model, and search
stays local-only on FTS5.

## 12. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `doc_json` conflicts annoy users | Medium | The conflict badge is non-blocking and rare; conflicts are resolvable in two taps |
| Two SQLite engines diverge | Medium | Deterministic derivation makes drift checkable; §9 repairs are unwritten until drift shows |
| Outbox grows unbounded offline | Low | No pruning is implemented; at one row per write the table stays small at personal scale |
| The `dirty` flag becomes inconsistent with the outbox | Low | Both are written in one transaction; the drain collapses to the latest row per entity |
| Device clock skew breaks LWW | Medium | `rev`, not the clock, is authoritative. Clocks only order user-visible timestamps. |
| Android foreground sync drains battery | Low | Sync runs on a 60 s interval while open and never in the background |