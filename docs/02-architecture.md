# 02 — Architecture

**Status:** Frozen. Last updated 2026-10-07.

---

## 1. Stack

### 1.1 Frontend

Versions are floors, not pins: install the current stable major and move the
number here in the same commit. Updated at M0 on 2026-10-07.

| Concern | Choice | Version | Note |
|---------|--------|---------|------|
| Language | TypeScript | 6.x | `strict: true`, `noUncheckedIndexedAccess`, no `any` in app code |
| UI library | React | 19.x | |
| Build tool | Vite | 8.x | Tauri uses it as the dev server |
| Editor | TipTap | 3.x | Verify current stable at install |
| Editor core | ProseMirror | via TipTap | |
| Styling | Tailwind CSS | 4.x | Tokens via CSS custom properties, see `05-ui-ux.md` |
| Icons | `lucide-react` | latest | Stroke-only vectors, bundled at build time. **No emoji.** See `05-ui-ux.md` §3.3, ADR-015 |
| Fonts | `@fontsource/inter` | latest | Bundled locally, no network fetch |
| Server-state | TanStack Query | 5.x | Wraps the Rust repository commands; see §5 |
| UI state | Zustand | 5.x | Theme, sidebar, selection, editor prefs |
| IDs | `uuid` (v7) | 14.x | Time-ordered, client-generated |
| Dates | plain `number` (epoch ms) | — | No date library in v1 |
| Tests | Vitest | 5.x | |

### 1.2 Backend (Rust)

| Concern | Choice | Note |
|---------|--------|------|
| Shell | Tauri 2 | Bundles the WebView, exposes the IPC layer |
| Database | SQLite via `rusqlite` (bundled feature) | The frontend never speaks SQL |
| Serialisation | `serde`, `serde_json` | TipTap documents are `serde_json::Value` at the boundary |
| Errors | `thiserror` | Typed errors mapped to a stable IPC error shape |
| Async | `tokio` | Provided by Tauri; used only for sync-related work in a later phase |
| IDs | `uuid` crate v7 | Must match the frontend generator's format |
| Tests | built-in `cargo test` | |

### 1.3 Toolchain requirements (milestone M0)

| Tool | Version |
|------|---------|
| Node.js | 20 LTS or newer |
| Rust | stable, latest |
| JDK | 17 (Android only) |
| Android Studio + NDK | latest stable (Android only) |
| Cargo targets for Android | `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android` |

## 2. Why this stack

| Criterion | Tauri 2 + React | Flutter | Compose Multiplatform | Web + Capacitor |
|-----------|-----------------|---------|-----------------------|-----------------|
| Single codebase for desktop + Android | Yes, native | Yes | Yes | Weak on desktop |
| App size | ~10–20 MB | ~20–30 MB | ~15–25 MB | ~5 MB + system WebView |
| WYSIWYG editor maturity | ProseMirror, industry standard | Weak ecosystem | Weak ecosystem | Same as Tauri |
| Memory footprint | Low | Medium–high | Low | Low |
| Access to platform APIs | Full Rust + plugin ecosystem | Full | Full | Plugin-gated |
| Time to v1 | Lowest | Medium | Highest | Low |

Tauri 2 is the only option that is simultaneously strong on editor maturity, official on Android, and light on resources. Flutter and Compose were rejected primarily because a mature WYSIWYG editor is the single hardest requirement here — see `09-decisions.md` ADR-001.

## 3. Layer diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ React UI (src/)                                                      │
│   components/  layout/  panes/  editor/  hooks/                      │
│   TanStack Query ──── calls only typed IPC functions                 │
│   Zustand        ──── UI state only, never persists data             │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  invoke("notes_list", { filter })  →  typed JSON
┌───────────────────────────────▼──────────────────────────────────────┐
│ Tauri commands (src-tauri/src/commands/)                             │
│   Validate input · map domain errors to AppError · no business logic │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ Domain services (src-tauri/src/services/)                            │
│   notes.rs  folders.rs  tags.rs  search.rs  title.rs  plaintext.rs   │
│   Outbox writes and sync-state transitions happen here only          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ Repository trait (src-tauri/src/repo/)                               │
│   trait NotesRepo { list, get, save, soft_delete, restore, ... }     │
│   trait FoldersRepo { ... }   trait TagsRepo { ... }                 │
│        ├── SqliteNotesRepo        ← v1, the only implementation      │
│        └── SupabaseNotesRepo      ← post-v1, same trait               │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ SQLite (rusqlite)          FTS5 virtual table + triggers             │
└──────────────────────────────────────────────────────────────────────┘
```

**Rule:** dependencies point downward only. The UI cannot skip a layer. The repository trait is the seam where remote storage is introduced later.

## 4. Why `rusqlite` instead of `tauri-plugin-sql`

The official SQL plugin was rejected for the data layer. Reasons, in order of importance:

1. **Custom derived columns.** Title and plain text must be recomputed from the ProseMirror JSON on every write. Doing that in Rust, inside the same transaction as the row update, makes the derived columns atomic. From the frontend it would be two separate operations.
2. **FTS5 triggers and transactions.** The search index must be updated atomically with the note row. Transaction control belongs in Rust.
3. **The repository seam.** Sync requires owning write ordering and outbox transactions. That is application logic, not a plugin.
4. **No SQL in the frontend process.** Removing the plugin removes the temptation to write ad-hoc queries in components, which is how schema decisions leak into the UI.

`tauri-plugin-sql` may still be used for one-off maintenance tasks in development. It must not be a dependency of `src/`.

## 5. State ownership

| State | Owner | Persistence |
|-------|-------|-------------|
| Notes, folders, tags, search results | Server state, TanStack Query | SQLite |
| Selection (all/pinned/folder/tag/trash) | Zustand, persisted in settings | settings JSON |
| Theme, accent, sidebar width, density | Zustand, persisted in settings | settings JSON |
| Editor contents | Local component state, written through | SQLite (debounced) |
| Undo/redo history | ProseMirror | not persisted |
| Auth session | Post-v1 | OS keychain |

**Loading states:** TanStack Query cache is the single source. A component never holds a copy of a note list in its own state. There is no global "is loading" flag; per-query pending states are used instead.

## 6. Sync-readiness rules — non-negotiable

These rules exist so that adding sync in a later phase does not require rewriting v1. Violating any of them is a bug, not a shortcut. A reviewer must reject a change that breaks any of them.

### R1 — Client-generated, time-ordered identifiers

All primary keys are UUIDv7, generated on the client, at creation time, and never reassigned. Never use auto-increment integers, never generate IDs on the server, never reuse an ID after deletion.

Reason: a device that has been offline for a week must be able to create rows that will not collide with anything the server has seen, and the merge must not require a round trip.

### R2 — Timestamps are UTC epoch milliseconds

Stored as `INTEGER` in SQLite and `timestamptz` in Postgres. Never store local time, never store formatted strings, never use the server clock at write moment.

Reason: device clocks are wrong; a monotonic local logical clock must decide ordering, and the wall clock is only ever used for display.

### R3 — Soft deletes only

Every syncable table has `deleted_at`. "Delete" writes `deleted_at`. Only the trash's permanent delete sets it to a sentinel or purges the row after it has been synced at least once.

Reason: a hard delete on device A cannot inform device B. Tombstones are the only way a deletion propagates.

### R4 — Every syncable row carries `rev` and a dirty marker

`rev` is assigned by the server on successful push and is echoed back to the client. A local write never changes `rev`; it marks the row dirty and appends to the outbox.

Reason: without a server revision the client cannot tell "this row is unchanged" from "this row is newer than what I last saw".

### R5 — All writes go through the repository trait

No service writes SQL directly; no command bypasses a service; no UI component calls a repository. Writing to storage and appending to the outbox must be possible inside one transaction.

Reason: atomicity of `row + outbox` is what makes sync reliable after a crash.

### R6 — No UI component ever touches storage or network

Components call typed commands. They receive plain serialisable data. There is no `supabase` import anywhere under `src/`.

Reason: the local-first UI must remain functional with zero network, and the storage implementation must remain replaceable.

### R7 — Stable, machine-readable error shapes

Every command returns `Result<T, AppError>` where `AppError` has a `code` string, a human-readable `message`, and optional structured `details`. Codes are part of the contract and are listed in `10-conventions.md` §6.

Reason: error handling must not change when the storage backend does.

### R8 — Migrations are forward-only and versioned

Schema changes ship as numbered migrations applied in order, each in a transaction, tracked in `schema_migrations`. No down migrations in production.

Reason: a device that has been offline across a release must be able to catch up.

### R9 — Everything derived is derived, never authoritative

`title` and `plain_text` are recomputed from the document on every write. Nothing in the UI is allowed to write them directly. They may be cached for search, but the document is authoritative.

Reason: a remote device must be able to reproduce every derived value, or two devices will disagree permanently.

## 7. IPC surface

Tauri commands exposed to the frontend. This is the complete API for v1; adding a command requires updating this table and `03-data-model.md`.

| Command | Input | Output |
|---------|-------|--------|
| `notes_list` | `NoteFilter` | `NoteSummary[]` |
| `notes_get` | `note_id` | `Note` |
| `notes_create` | `folder_id: Option<Uuid>` | `Note` |
| `notes_save` | `SaveNoteInput { id, doc, folder_id, tag_ids, is_pinned }` | `Note` |
| `notes_move` | `{ id, folder_id }` | `Note` |
| `notes_soft_delete` | `note_id` | `()` |
| `notes_restore` | `note_id` | `()` |
| `notes_destroy` | `note_id` | `()` |
| `notes_empty_trash` | `()` | `usize` |
| `folders_list` | `()` | `FolderNode[]` (tree) |
| `folders_create` | `{ name, parent_id }` | `FolderNode` |
| `folders_rename` | `{ id, name }` | `FolderNode` |
| `folders_move` | `{ id, new_parent_id, position }` | `FolderNode` |
| `folders_delete` | `id` | `()` |
| `tags_list` | `()` | `TagWithCount[]` |
| `tags_create` | `name` | `TagWithCount` |
| `tags_rename` | `{ id, name }` | `TagWithCount` |
| `tags_delete` | `id` | `()` |
| `search_query` | `SearchInput { query, filter, limit, offset }` | `SearchPage` |

Settings are read and written with `@tauri-apps/plugin-store`, not with a command.

## 8. Performance budget

| Concern | Budget |
|---------|--------|
| Cold launch to first paint | < 700 ms |
| Cold launch to editable caret | < 1200 ms |
| Keystroke to render | < 16 ms |
| Autosave commit | < 25 ms, runs off the UI thread |
| Search query, 50 MB corpus | < 50 ms |
| Note list scroll, 10 000 notes | 60 fps |
| Note open (cached doc) | < 50 ms |
| APK size | < 20 MB |
| Desktop installer | < 30 MB |

The note list must be virtualised from the first implementation. 10 000 notes is a realistic two-year dataset; the list must not degrade before that.