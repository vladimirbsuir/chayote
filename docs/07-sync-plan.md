# 07 — Sync Plan

**Status:** Frozen; Last updated 2026-11-21 (ADR-027).

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
| E | Retry/backoff polish, open-editor guard, never-synced delete guard, re-upload recovery, two-device live coverage | done |

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
| Both changed, but disjoint fields (`folder_id`, `is_pinned`, `title`, tags, `doc_json`) | Merge fields independently: each field this device changed stays local, every other field is taken from the server. |
| Both changed `doc_json` | **Never auto-resolve.** |

For the both-changed document case:

1. Keep the local document as the live one.
2. Write the remote document to a `conflicts` table with `note_id`, `local_rev`, `remote_rev`, `remote_doc`, `created_at`.
3. Show a non-modal badge in the sidebar.
4. The user picks: keep local, use remote, or view both.

**Which fields "this device changed" is read from the outbox** (ADR-027). `dirty` is
per row and `updated_at` is per row, so neither can say *which* fields moved — and a
device that had only pinned a note used to park a conflict against a text edit made
elsewhere and push its own stale copy of a document it never touched. Every unsent
outbox row's payload names what its write wrote: `notes_save` the document, filing
and tags; `notes_set_pinned` the pin; `notes_move` the filing; `notes_set_title` the
title. A row without a readable payload (a restore, a re-upload, a resolved conflict,
the title migration) claims every field, which is the safe direction: the worst it
does is park. A field this device changed is kept even when the server's row is
newer — the row is newer because *something* changed, not necessarily that field —
and only the document is never decided that way. The tag set unions (§5.3) only
when this device changed it; otherwise the server's set stands, so a removal made
elsewhere is not undone by a device that never looked at the tags. The pull applies
the same merge to a note whose push is still waiting, and the park, the merged
fields and the tag set are written in one transaction.

An edit queued while that push was on the wire is not rebased onto the new rev if it
touched a field the push just took from the server; left on its old base it comes
back as a conflict and goes through the merge again, instead of overwriting the
other device's value as a plain update.

Automatic three-way merging at the paragraph level is explicitly rejected for now. A silently wrong merge is worse than a visible conflict, and the conflict rate for a personal notes app is low enough that a manual prompt is acceptable.

**The title follows the document's conflict, and it travels with it** (ADR-023). The
title stopped being derived from the document, so it is no longer something a remote
device can recompute for itself: it is pushed and pulled as a column beside `doc_json`,
and a pull that adopts the remote document adopts the remote title in the same write —
`conflicts` already carries a `remote_title` for exactly this. A note whose title is still
derived (`title_source = 'auto'`) keeps `title_source` in the same push, so the other
device recomputes rather than adopting a value the first device merely guessed. Keep-mine
and use-theirs therefore move the two together, which is the only coherent outcome: a
remote document under one name and a remote title belonging to another is a note nobody
wrote.

Documents compare by parsed value, never by string: the server column is
`jsonb`, and `jsonb::text` re-spaces and reorders keys on every read, so a
round-tripped document is never string-equal to the compact text the device
stored. String comparison would park a conflict on every concurrent edit,
however identical. Keep-local converges in one round: the push that parked
already carried the local document and echoed its rev, so the re-queued row
updates cleanly instead of parking again.

### 5.2 Folders and tags — LWW per row

- Same row, both changed: higher `updated_at` wins, loser rebases.
- Concurrent rename to the same name: both applied; duplicate names are legal (`03-data-model.md` §3.2).
- Concurrent delete and rename: the delete wins, the rename is discarded, the row is tombstoned.
- Concurrent move of a folder: LWW on `parent_id`. Not ideal, acceptable.
- **Concurrent moves that would close a cycle: the first push wins** (ADR-027).
  X under Y on one device and Y under X on another each pass the local check;
  LWW alone hands the server both halves of a cycle, and every device a tree
  whose walks never end. The push asks the server whether the new parent
  already has the folder among its ancestors (a recursive CTE over `UNION`, so
  a cycle already on the server ends the walk); if so the move is dropped and
  the row rebases onto the server's. The pull is the safety net: a row whose
  parent would close a cycle locally is filed at the root and queued back, so
  a cycle that reached the server anyway is broken there too.
- **A pulled folder lands after its parent.** Pulls are ordered by `rev`, and a
  parent renamed or moved after its child was created has the higher one, so on
  a fresh device the child arrived first and failed the foreign key — every
  cycle, before a single note was pulled. Folders are therefore fetched whole
  (no page cap: a tree is hundreds of rows) and applied parent-first, in `rev`
  order wherever a parent is not waiting. A parent the device does not hold at
  all files the folder at the root, as for a note.
- **Sibling renumbering is a write.** `position` is densified on every move
  (`03-data-model.md` §3.2); each sibling whose position changes is marked dirty
  and queued like any write. It used to be renumbered silently, so the moved
  folder synced with its new position and its siblings did not. The renumbering
  leaves `updated_at` alone, so it cannot win LWW over a rename of that sibling
  made elsewhere.
- **Tag names that clash by case: the server's tag wins** (ADR-027). Names are
  unique among live tags ignoring case (`03-data-model.md` §3.4), but each
  device enforces that against its own tags, so two devices can create "work"
  and "Work" under different ids. The tag already on the server stands — every
  device sees the same row, so every device merges the same way. On push the
  device asks the server for a live tag of that name before writing; on pull it
  checks its own tags before inserting. Either way the local tag folds into the
  server's: its note links move over, those notes are queued with a tags-only
  change (which cannot park a document conflict), the local tag is dropped, and
  a tombstone is queued if the server ever held it. Before this, the second
  device's push hit the server's unique index and retried for ever, and its
  pull hit the local one and failed every cycle. A rename onto another live
  tag's name on the *same* device is refused as `VALIDATION`.
- **Folders are pushed parent-first.** The batch orders folder rows by their
  depth in the local tree. Ordering by outbox id alone pushed a child created
  under a parent that was renamed afterwards before the parent itself, and a
  new parent does not exist on the server yet, so the child failed the foreign
  key and backed off with every note filed in it.
- **A pulled folder tombstone deletes the subtree everywhere.** Deleting a
  folder deletes its subtree (`03-data-model.md` §3.2), and the deleting
  device queues a tombstone for every descendant it holds. A child created on
  another device and never seen by the deleting one got no tombstone, so the
  receiving device's cascade removed it locally with no outbox row while the
  deleting device later pulled it and filed it at the root: one folder, alive
  on one device and gone on the other, for good. Applying a tombstone now
  queues a tombstone for each local descendant that is not itself in the
  pulled rows.
- A pull filing a note into a folder the device does not hold (deleted here,
  never arrived): the note is unfiled instead of failing the cycle — the same
  `ON DELETE SET NULL` semantics a local folder delete gets. Crashing the
  cycle over a filing hint would block every row behind it.

### 5.3 `note_tags` — set union, then LWW

A many-to-many join cannot be row-merged. Treat a note's tag set as one set-valued field and union the local and remote sets. Removing a tag on one device while adding a different tag on another keeps both. Removing a tag is only truly honoured when it is applied as a whole-set replacement by a single device that saw the previous full set.

This asymmetry is a known, accepted cost of using a relational model for something Obsidian solves with a set-based CRDT. If tag-removal sync proves unreliable in practice, the escape hatch is a `doc_tags jsonb` column on `notes` that is replaced wholesale, which resolves the whole set and needs no union rule.

The push runs before the pull in every cycle, so a union can link a tag
whose row has not arrived yet; SQLite does not apply `OR IGNORE` to foreign
keys, so the local link write aborts and the row waits out backoff. Nothing
is lost — the server side already applied the full union, and the retry
completes the links once the tag row arrives. Filtering the unknown tag
instead would clobber the server union on the next push.

**A deleted tag takes its links with it on the server.** A local tag delete
drops its `note_tags` rows by cascade but queues no note, and the tombstone
push used to set only `tags.deleted_at`, so the server kept links to a dead
tag. A device that never had the tag — a new one, or one after a server
switch — then pulled a note whose set named it, the local insert failed the
foreign key, and every pull failed on that note for ever. The tombstone push
now deletes the tag's server links in the same statement, and every read of
a server tag set joins live tags, which also heals a server that already
holds such links.

**A note and its tag set are one server write.** The note row, its revision
and its `note_tags` are written by a single statement (data-modifying CTEs),
so a pull can never see the new `rev` with the old or a half-written set and
move its watermark past it, and a dropped connection cannot leave the server
note with its links deleted and not re-inserted. Links to tags the server
holds only as tombstones are skipped there, for the reason above.

### 5.4 Deletes

Soft deletes propagate as tombstone writes. Tombstones are retained
**indefinitely** — there is intentionally no GC: at personal scale a
tombstone is a few dozen bytes, while deleting them reopens the one real
hazard, a device offline past the retention window coming back and
resurrecting what it never saw deleted. ~~Permanent delete is refused while
`rev` has never been synced, so a never-pushed note cannot vanish from
another device without ever existing there.~~ Superseded by ADR-028: permanent
delete and Empty trash remove any trashed note, synced or not, and queue its
tombstone either way, so the deletion still reaches a server the device syncs
with later.

**A delete push compares `base_rev` like any other push.** The tombstone is
written whatever the server holds, but when the server's row is newer than
the device's base — another device edited the note the device just trashed —
the device takes that newer content into its trashed copy (as a merge with
nothing touched locally) before it adopts the tombstone's `rev`. It used to
adopt the `rev` over its own stale text, so a later restore pushed that stale
text as a plain update and the other device's edit was gone everywhere,
without a conflict. The acknowledgement goes through the same path as any
push, so a restore queued while the delete was in flight stays dirty and is
rebased instead of being re-trashed by the next push.

## 6. Bootstrap

First sync on a device with existing local data needs no special case: the
outbox has recorded every local write since day one, so draining it in
dependency order — tags → folders → notes → `note_tags` — *is* the upload,
and pull only starts after. If a row's ID already exists remotely, treat it
as a conflict per §5. Saving a *different* connection string re-queues
everything and restarts the watermarks, because revisions are meaningless
against a server that has never seen the device. The local `rev` of every row
is reset to 0 with them, and the queued rows carry base 0: the old server's
revisions used as a base made a stale row look newer than an edit another
device had already made on the new server, so it was pushed as a plain update
over it, and the pull skipped new-server rows whose `rev` was below the old
one. "Re-upload everything" against the *same* server keeps the revisions.

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
| Watermark | `max(rev)` of the last successful pull per table, persisted in `sync_state`; held below a deferred row so the row is re-fetched next cycle rather than skipped. Paging is separate from it: the next page in the same cycle starts past the deferred row, so the deferral does not re-read the page it is on (it used to, up to ten times a cycle) |
| Pulled tag sets | One `note_tags` query per page of pulled notes (`note_id = ANY($1)`), not one per note |
| Error codes | Only failing to reach the server is `NETWORK` ("could not reach the sync server", retry). A server that answered and refused is not: credentials, a missing database or a schema never applied (SQLSTATE classes 28, 3D; 42P01, 42703) are `VALIDATION`, for the user to fix in Settings → Sync; any other rejection is `INTERNAL`, a bug in what was sent. Rows back off and stay queued whatever the code (above) |
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
permanent-delete guard, since removed by ADR-028) followed on the same branch. What remains is §9's
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