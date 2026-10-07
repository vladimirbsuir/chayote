# 10 — Engineering Conventions

**Status:** Frozen. Last updated 2026-10-07.

---

## 1. Repository layout

```
chayote/
├── README.md
├── LICENSE                    # MIT, Copyright (c) 2026 Chayote contributors
├── docs/                              # this specification
│   ├── 01-product.md
│   ├── 02-architecture.md
│   ├── 03-data-model.md
│   ├── 04-editor.md
│   ├── 05-ui-ux.md
│   ├── 06-platform.md
│   ├── 07-sync-plan.md
│   ├── 08-roadmap.md
│   ├── 09-decisions.md
│   ├── 10-conventions.md
│   └── 11-verification.md
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── playwright.config.ts
├── e2e/                               # Playwright: layout, themes, flows (11-verification.md §3.3)
├── screenshots/                       # captured states, committed for human review
│
├── src/                               # React frontend
│   ├── main.tsx                       # entry; mounts after theme is resolved
│   ├── App.tsx
│   ├── lib/                           # framework-agnostic helpers
│   │   ├── ipc.ts                     # typed invoke wrappers + Tauri-or-mock adapter (ADR-018)
│   │   ├── debounce.ts
│   │   ├── relativeTime.ts
│   │   └── sanitize.ts                # DOMPurify config
│   ├── mock/                          # browser fallback backend, never imported by components
│   │   ├── adapter.ts                 # implements every command in 02-architecture.md §7
│   │   ├── derive.ts                  # title, excerpt, word_count over JsonDoc
│   │   ├── errors.ts                  # MockBackendError carrying the AppError code
│   │   ├── fixtures.ts
│   │   └── generate.ts                # 10 000-note generator for scroll tests
│   ├── types/                         # shared domain types
│   │   ├── note.ts
│   │   ├── folder.ts
│   │   ├── tag.ts
│   │   ├── search.ts
│   │   └── ipc.ts                     # command input/output types
│   ├── stores/                        # Zustand
│   │   ├── settings.ts
│   │   ├── selection.ts
│   │   └── editor.ts
│   ├── hooks/
│   │   ├── useNotes.ts
│   │   ├── useFolders.ts
│   │   ├── useTags.ts
│   │   ├── useSearch.ts
│   │   └── useAutosave.ts
│   ├── editor/
│   │   ├── extensions.ts              # TipTap extension set
│   │   ├── editorProps.ts
│   │   ├── pasteSanitizer.ts
│   │   ├── clipboardSerializer.ts
│   │   └── NoteEditor.tsx
│   ├── components/                    # presentational, one responsibility each
│   │   ├── TopBar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── FolderTree.tsx
│   │   ├── TagList.tsx
│   │   ├── NoteList.tsx
│   │   ├── NoteCard.tsx
│   │   ├── EditorPane.tsx
│   │   ├── EditorStatusBar.tsx
│   │   ├── TagEditor.tsx
│   │   ├── FolderPicker.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── SettingsDialog.tsx
│   │   ├── IconButton.tsx             # icon + optional aria-label, 32/44px hit area
│   │   ├── EmptyState.tsx             # title + cause + optional action, 05-ui-ux.md §8
│   │   └── ThemeToggle.tsx
│   ├── layout/
│   │   ├── DesktopLayout.tsx
│   │   ├── MobileLayout.tsx
│   │   └── viewStack.ts               # in-app navigation stack
│   ├── styles/
│   │   ├── tokens.css                 # values copied from prototype/index.html, incl. --accent-preset-1..6
│   │   ├── base.css                   # Tailwind v4 @theme mapping, .icon and .i-* size classes
│   │   └── editor.css                 # ProseMirror styles
│   └── queries/                       # TanStack Query keys and options
│       └── keys.ts
│
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── migrations/
    │   ├── 0001_initial.sql
    │   ├── 0002_fts.sql
    │   └── 0003_outbox.sql
    └── src/
        ├── main.rs
        ├── lib.rs
        ├── error.rs                   # AppError
        ├── db/
        │   ├── mod.rs                 # Database, pragmas, connection
        │   └── migrate.rs             # migration runner
        ├── repo/
        │   ├── mod.rs                 # traits + shared types
        │   ├── notes.rs               # SqliteNotesRepo
        │   ├── folders.rs
        │   └── tags.rs
        ├── services/                  # business logic, outbox writes
        │   ├── notes.rs
        │   ├── folders.rs
        │   ├── tags.rs
        │   ├── search.rs
        │   └── derive.rs              # title, plain_text, excerpt, word_count
        ├── doc/
        │   └── validate.rs            # document invariants from 04-editor.md §1.3
        ├── commands/
        │   ├── mod.rs
        │   ├── notes.rs
        │   ├── folders.rs
        │   ├── tags.rs
        │   └── search.rs
        └── sync/                      # empty in v1; reserved for 07-sync-plan.md
```

## 2. Naming

| Kind | Convention | Example |
|------|-----------|---------|
| Rust module / type | `snake_case` / `PascalCase` | `soft_delete_note`, `NoteFilter` |
| Rust function | `snake_case`, verb-first | `recompute_derived`, `trash_snapshots_for` |
| React component | `PascalCase` | `NoteList`, `FolderTree` |
| Hook | `use` + PascalCase noun | `useAutosave`, `useFolders` |
| CSS class | `kebab-case`, utility-first | `.note-card__excerpt` |
| CSS variable | `--kebab-case`, grouped by role | `--surface-raised` |
| Database table / column | `snake_case`, singular tables | `notes`, `plain_text` |
| Tauri command | `snake_case`, `entity_verb` | `notes_soft_delete` |
| TypeScript type | `PascalCase`, no `I` prefix | `Note`, `SearchInput` |
| Environment variable | `SCREAMING_SNAKE_CASE` | `TAURI_LOG_LEVEL` |

Rust booleans are `is_*` / `has_*`. Database booleans are `is_*` / `has_*` and store 0/1.

**No comments in code.** The specification is the documentation. A comment that restates the code is noise; a comment that explains a non-obvious constraint belongs in `docs/` and is referenced from the type or function name where possible. This is a deliberate rule, not a preference: comments drift out of date and the docs are reviewed.

## 3. TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`. `any` is banned in `src/`; `unknown` plus a narrowing function is the alternative.
- Types are defined in `src/types/` and imported. Do not declare domain types inline in components.
- `import type { ... }` for type-only imports.
- Discriminated unions for anything with variants: `Selection = { kind: 'all' } | { kind: 'folder'; id: Uuid } | ...`
- No barrel files. Import directly from the module. A `components/index.ts` makes refactoring and tree-shaking worse.
- Function components only. No class components.

## 4. Rust

- `#![deny(clippy::all)]` and `#![warn(missing_docs)]` on public items in `repo/`, `services/`, and `doc/`. `missing_docs` is suppressed in `main.rs`, `lib.rs`, and `commands/`, which are self-describing dispatch layers.
- Error handling: `AppError` with `thiserror`. Never `unwrap()` outside tests and migration setup. Never `panic!` in a command. Never `.expect()` in `src/` at all.
- `Mutex<Connection>` in Tauri state. No connection pool at this scale; a pool would imply concurrency we do not have.
- Every SQL statement is a prepared statement with bound parameters. **No string interpolation into SQL, ever** — including for sort direction, which must be matched against an allowlist rather than interpolated.
- `cargo fmt` and `cargo clippy -- -D warnings` clean, enforced in CI.
- Modules stay small. A file over 300 lines is a split waiting to happen.

## 5. IPC contract

`invoke()` appears in exactly one file: `src/lib/ipc.ts`. Everything else uses the typed wrappers. This module also holds the Tauri-or-mock adapter from ADR-018, which is what lets the frontend run in a browser for visual testing.

```ts
export const notesApi = {
  list: (filter: NoteFilter) => invoke<NoteSummary[]>('notes_list', { filter }),
  get: (id: Uuid) => invoke<Note>('notes_get', { id }),
  save: (input: SaveNoteInput) => invoke<Note>('notes_save', { input }),
}
```

Every command's input is a single named argument so that adding a field is not a breaking change. Every command validates its input in Rust before touching storage, and returns a serialisable struct with `camelCase` fields; the Rust structs carry `#[serde(rename_all = "camelCase")]`.

The mock adapter implements the same command names against in-memory fixtures. It is selected in a dev build when `'__TAURI_INTERNALS__' in window` is false; in any other case the real Tauri adapter is used. Rules:

- The mock lives in `src/mock/`, never in a component.
- It must return realistic data: nested folders, notes with and without tags, pinned and unpinned, empty collections, and a generator for 10 000 notes used only by scroll tests.
- A production build must fail loudly if the mock is reachable, rather than silently shipping a fake backend.

## 6. Error contract

`AppError` serialises to `{ code, message, details? }`. Codes are stable API. Adding a code is safe; changing or removing one is a breaking change.

| `code` | Meaning | Frontend behaviour |
|--------|---------|--------------------|
| `DB_ERROR` | SQLite failure | Log, show the generic error state, offer retry |
| `NOT_FOUND` | Row does not exist or is not visible | Close the editor, refresh the list |
| `VALIDATION` | Input failed validation | Show inline, focus the field |
| `DOC_INVALID` | Document violates the schema | Recovery screen (`04-editor.md` §8.4) |
| `DOC_TOO_LARGE` | Document exceeds 5 MB | Keep the buffer, offer export as plain text |
| `CYCLE_DETECTED` | Folder move into own descendant | Inline explanation |
| `CONFLICT` | Concurrent modification, sync only | Prompt, do not overwrite |
| `UNAUTHENTICATED` | Sync operation without a session | Sign-in prompt |
| `NETWORK` | Sync request failed | Defer, retry with backoff |
| `INTERNAL` | Anything unclassified | Log with the full chain, show the generic state |

Messages are user-facing and plain. The technical detail goes in `details` and the log, never in the message shown to the user.

## 7. State management

| Concern | Tool | Rule |
|---------|------|------|
| Server data | TanStack Query | Keys in `src/queries/keys.ts`, never inline strings |
| UI state | Zustand | One store per concern. Never store document contents — that is the editor's. |
| Editor state | TipTap | The single owner of the document |
| Persisted settings | `@tauri-apps/plugin-store` | Read at startup, written debounced at 300 ms |

Query keys:

```ts
export const qk = {
  notes:      (filter: NoteFilter) => ['notes', filter] as const,
  note:       (id: Uuid)           => ['note', id] as const,
  folders:    ()                   => ['folders'] as const,
  tags:       ()                   => ['tags'] as const,
  search:     (input: SearchInput) => ['search', input] as const,
}
```

Invalidation discipline: `notes_save` does not invalidate the list — the save response already carries the fresh `NoteSummary`, so the list entry is patched in place. Structural changes (create, delete, move, tag rename) invalidate the relevant list and the folders or tags query.

## 8. Performance rules

The budgets in `02-architecture.md` §8 are acceptance criteria, not aspirations.

- The note list is virtualised from the first commit.
- `NoteSummary` never includes the document body. `03-data-model.md` §3.3 provides `excerpt` and `word_count` precisely so the list does not need to.
- Folders and tags load once and are cached; they change rarely.
- The autosave serialisation runs on the UI thread — `JSON.stringify` on a 5 MB document would block. Above 64 KB, defer serialisation to a worker.
- Autosave writes are debounced and single-flight. Never two writes of the same note in flight.
- Search input is debounced at 150 ms. Never query FTS5 on every keystroke.
- No `useEffect` that triggers a fetch during render. No cascading renders.

## 9. Accessibility

Enforced per `05-ui-ux.md` §10. Non-negotiable in review:

- Every interactive element is keyboard reachable, with a visible focus ring.
- Icon-only controls have `aria-label`. Every other icon is `aria-hidden="true"`.
- Icons are imported per-name from `lucide-react` (`import { Search } from 'lucide-react'`), never as a namespace, so Vite can tree-shake. There is no `AppIcon` wrapper and no icon font.
- Icon size comes from the four `.i-*` classes in `05-ui-ux.md` §3.3. No inline `width`/`height`/`strokeWidth` on an icon element.
- Dialogs trap focus, restore it on close, and respond to `Esc`.
- Status changes that matter (search result count, save state) go through `aria-live="polite"`.
- Colour is never the only signal.
- `prefers-reduced-motion` is honoured.

## 10. Testing

Layers, tooling, and required tests are specified in [`11-verification.md`](11-verification.md). This section lists only the required test cases.

Required tests, because each verifies a rule that is easy to break silently:

1. Every write appends an outbox row in the same transaction; a failure leaves neither.
2. A failed write leaves no orphan outbox row.
3. `title`, `plain_text`, `excerpt`, `word_count` are recomputed on every save.
4. IDs are UUIDv7 and strictly increasing within a test run.
5. Soft delete sets `deleted_at` and leaves the row present.
6. The FTS index stays consistent with `notes` across insert, update, delete, and hard delete.
7. Search input containing FTS operators (`, `*`, `NEAR`, `^`, `-`) cannot produce an error or injection.
8. A document violating an invariant from `04-editor.md` §1.3 is rejected and the stored version survives.
9. Switching notes resets undo history.
10. Pasted script tags and inline styles do not survive into the document.
11. The mock adapter returns the same shape as the real IPC for every command in `02-architecture.md` §7.
12. Every icon in the `05-ui-ux.md` §3.3 inventory renders at all four sizes and inherits `currentColor`.

## 11. Git and workflow

- `main` is always buildable. Work happens on topic branches.
- Conventional Commits: `feat(editor): add task list input rule`.
- Scopes mirror the folders: `editor`, `db`, `repo`, `ui`, `search`, `platform`, `build`, `docs`.
- One logical change per commit. A commit that touches the schema, the UI, and the docs for two unrelated features will be rejected.
- If a change alters a decision in `docs/`, that commit must include the documentation update. This is the rule from `README.md` §1 and it is the reason the documents stay trustworthy.
- If a change touches tokens, icon sizes, layout metrics, or user-visible copy, it must also update `prototype/index.html` in the same commit (ADR-016). Visual values come from the prototype; behaviour comes from `05-ui-ux.md`.
- CI on every push: `npm run typecheck`, `npm run lint`, `npm run test`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `npm run build`.

## 12. Documentation rules

- `docs/` is the single source of truth for rules and rationale. `prototype/index.html` is the single source of truth for appearance (ADR-016). README and code comments never contradict either.
- Icons come from `lucide-react` and must already exist in the `05-ui-ux.md` §3.3 inventory. Adding a new icon to the UI means adding it there first. **Emoji are never used in the UI** (ADR-015).
- Update the document in the same change as the code. A follow-up "fix the docs" commit never happens.
- New decisions go into `09-decisions.md` as a new ADR. Existing ADRs are superseded, not edited.
- Superseded rules are struck through with a pointer to their replacement, never deleted silently. Knowing what we rejected and why is the point of the log.
- If an implementation contradicts a document and the code is right, the fix is a decision, then a document update. Not a silent patch.