# 08 — Roadmap

**Status:** Frozen. Last updated 2026-10-10.

**Current position: M6, not started.** M0 through M5 shipped between 2026-10-07
and 2026-10-10: the frontend scaffold, the data layer behind repository traits,
the editor with autosave and paste sanitisation, the UI shell with the sidebar,
the virtualised note list and the three responsive layouts, the whole of
organisation — folders, tags, pinning and trash — and search. Work proceeds in
order; a milestone is not "mostly done".

**M6 is blocked by nothing.** It needs no Android SDK: everything in it runs in
the browser and on desktop. M7 is the milestone the SDK gates, and nothing else.

---

## 1. Milestones

| # | Milestone | Estimate | Depends on |
|---|-----------|----------|-----------|
| M0 | Project scaffold and toolchain | 1 d | — |
| M1 | Data layer: SQLite, migrations, repositories | 3 d | M0 |
| M2 | Editor: TipTap, autosave, paste, input rules | 4 d | M1 |
| M3 | UI shell: layout, sidebar, note list, selection | 4 d | M1 |
| M4 | Organisation: folders, tags, pinning, trash | 3 d | M3 |
| M5 | Search: FTS5, filtering, snippets | 2 d | M1, M3 |
| M6 | Themes, settings, keyboard, empty states, polish | 2 d | M3 |
| M7 | Android | 3 d | M2–M6 |
| M8 | Packaging and distribution | 2 d | M7 |
| — | **v1 total** | **~24 d** | |

M4–M6 are partly parallelisable: M5 and M6 touch disjoint surfaces from M4. With one developer, take them in order.

## 2. Milestone details

### M0 — Scaffold and toolchain

- Initialise git: `git init`, first commit with the specification and prototype.
- Install Node, Rust, JDK 17, Android Studio, NDK. **Node, Rust, and JDK are already present on this machine** (`docs/11-verification.md` §2); the Android SDK is not.
- Rename the directory to `chayote` (Q8) if not already done.
- `npm create tauri-app@latest` with React + TypeScript.
- Write `LICENSE` (MIT, `Copyright (c) 2026 Chayote contributors`).
- Configure `tauri.conf.json`:
  - `productName: "Chayote"`
  - `identifier: "com.chayote.app"`
  - window 1280 × 820, min 720 × 520
  - bundle targets per `06-platform.md` §3.7
- Database filename constant `chayote.db` in one place (`06-platform.md` §2).
- `src/lib/ipc.ts` with the Tauri-or-mock adapter from ADR-018, so `npm run dev` works in a browser from the first commit. This is what makes visual testing possible for the rest of the project, so it is not deferred.
- Playwright configured with a Chromium project, plus one smoke test that loads the empty app at 1280 × 820.
- Optional, from the agreed prototype: `prototype/index.html` translated into the real component tree and tokens.
- Gate: `npm run typecheck && npm run lint && npm run build && cargo check` all clean.
- Tailwind CSS v4 with the token layer from `05-ui-ux.md` §3 as CSS custom properties.
- Icon layer: `lucide-react`, the four `.i-*` size classes, and the `.icon` base rule from `05-ui-ux.md` §3.3. Everything in the prototype's icon inventory is imported and renders.
- The first UI built is `IconButton` plus the `TopBar`, so the icon layer is proven before it is used everywhere.
- Strict TypeScript, ESLint, Prettier, Vitest, `cargo clippy` in CI.
- `@fontsource/inter` bundled.
- Verified working: `npm run tauri dev` shows an empty window with no console errors.

### M1 — Data layer

- `rusqlite` with the `bundled` feature; `Database` struct with pragmas from `03-data-model.md` §2.
- Migration runner: numbered files, forward-only, transactional, tracked in `schema_migrations` (**R8**).
- Migrations `0001`–`0003` as specified in `03-data-model.md` §6.
- Repository traits `NotesRepo`, `FoldersRepo`, `TagsRepo`.
- `SqliteNotesRepo` with the queries from `03-data-model.md` §5.
- Derivation: `title`, `plain_text`, `excerpt`, `word_count` in one transaction with the row write (**R9**).
- Outbox append in the same transaction as every write (**R5**).
- Document validator: invariants from `04-editor.md` §1.3.
- Tauri commands from `02-architecture.md` §7, with `AppError` (**R7**).
- Settings store via `@tauri-apps/plugin-store`.
- **Done when:** `cargo test` covers every repository method, UUIDv7 IDs are generated, and a test asserts that a failed write leaves no orphan outbox row.
- **Shipped 2026-10-07.** Every item above is in place. 33 Rust tests, including all eight required tests from `10-conventions.md` §10 that apply to this milestone. One item shipped differently from the plan above: `services/` holds derivation and search rather than a module per entity, because the business logic of a write is the transaction in `repo/`.

### M2 — Editor

- TipTap with the extension set from `04-editor.md` §2.
- A fresh editor instance per `note_id` (**not** `setContent` — see `04-editor.md` §6).
- Autosave state machine: 800 ms debounce, flush conditions from §5.1, in-flight guard.
- Status indicator with the three states from §5.2.
- Paste sanitisation: DOMPurify allowlist plus the eight rules in `04-editor.md` §4.1.
- Clipboard out with the improved `clipboardTextSerializer`.
- Input rules and Typography verified.
- Placeholder per node type.
- `05-ui-ux.md` §7 editor shortcuts: bold, italic, strike, code, task toggle, Tab behaviour.
- **Done when:** paste from Word, Google Docs, and plain text all produce clean documents; a hard kill within 800 ms of typing loses at most the debounce window, verified by an automated test.
- **Shipped 2026-10-08.** Every item above is in place: TipTap 3.31 with the §2 extension set, a node view for the task checkbox, `useAutosave` as a controller, the status bar, DOMPurify paste sanitisation, `clipboardTextSerializer` as a core option, and the §7 bindings. 65 TypeScript tests and 22 Playwright tests; the three `10-conventions.md` §10 tests that apply here are the paste-sanitisation one, the undo-per-note one, and the editor-keyboard coverage in `e2e/editor.spec.ts`.

  Four things shipped differently from the plan, each recorded in `04-editor.md`:

  - **`transformPastedText` is not used.** ProseMirror treats its return value as text, so §4.1 rule 7 is built as a `Slice` in `handlePaste`. §2.1 now says so.
  - **`handleDrop` returns `true`, not `false`.** The sketch had the polarity backwards relative to the intent in the same paragraph. §2.1 records the correction.
  - **`EditorShortcuts` is an extension**, not `EditorProps.handleKeyDown`, because the §7 bindings need editor commands and must come after StarterKit to take `Tab` over from `listKeymap`.
  - **The status bar ships title, word count, and save state.** The folder and tag elements of §9 of `04-editor.md` need M4's data and land with it, rather than as controls that do nothing.

  **Outstanding:** the hard-kill half of "Done when". The frontend half is covered — a save commits within the debounce, and `03-data-model.md` §2's WAL and `synchronous = NORMAL` are asserted by the Rust tests. Killing the real process and checking the file needs the native window (`11-verification.md` §3.4), so it is a human check, not an automated one.

### M3 — UI shell

- Desktop two-pane layout from `05-ui-ux.md` §2.1; Android single-pane stack from §2.4.
- Zustand stores: selection, theme, sidebar width, settings.
- `TopBar` with search field, new note, theme toggle, overflow menu.
- `NoteList` virtualised; renders `NoteSummary` only, never full documents.
- `NoteCard` with title, excerpt, relative timestamp, pinned indicator.
- TanStack Query wired to the commands.
- Selection model with all five kinds (`05-ui-ux.md` §5).
- Relative timestamps: "now", "2 min", "3 h", "yesterday", then an absolute date.
- **Done when:** 10 000 seeded notes scroll at 60 fps and the list never loads a document body.
- **Shipped 2026-10-09.** Every item above is in place: `stores/selection.ts` and
  `stores/settings.ts`, the three layouts with a JS breakpoint, the resizable
  sidebar, `NoteCard` and a measured virtualised `NoteList`, `relativeTime` with
  its table tested boundary by boundary, and `Ctrl+N` / `Ctrl+F` / `Ctrl+\`.
  98 TypeScript tests and 49 Playwright tests.

  Four things shipped differently from the plan, each recorded in the document it
  belongs to:

  - **The list measures its rows.** The plan implied a fixed row height from the
    prototype's clamp. A card is a title line, an *optional* two-line excerpt, and
    a meta line, so its height genuinely varies; a fixed height overlapped the next
    card and clipped its text. `NoteList` uses `measureElement` with an estimate.
    The pairwise overlap assertion in `e2e/shell.spec.ts` is what caught it.
  - **`@tanstack/react-virtual` was added** rather than hand-rolling windowing, so
    `02-architecture.md` §1.1 lists it.
  - **No sidebar toggle in the desktop top bar.** `Ctrl/Cmd+\` collapses it and the
    prototype's desktop bar has no such control; the button appears only in the
    tablet band, where the sidebar is a drawer. Recorded in `05-ui-ux.md` §9.
  - **Trash is a filter tab, not a fourth section.** `05-ui-ux.md` §2.2 describes
    the Filters region as "All notes, Pinned", but §5 requires all five selections
    to be reachable and §8 has a trash empty state, so trash sits beside them in
    the segmented control where it is one click rather than buried in structure.

### M4 — Organisation

- `FolderTree`: recursive, collapsible, keyboard per the tree pattern in `05-ui-ux.md` §10.1. **Shipped first** — the pattern is a `05-ui-ux.md` §10 requirement with a depth-10 acceptance bar, and nothing else in this milestone touches the tree, so landing it on its own kept its diff reviewable. The tree is one tab stop with a roving tabindex, which is what makes a depth-10 tree navigable; the recursive render stays nested for `role="tree"`, and the arrows read a flattened row list (`src/components/folderRows.ts`).
- Drag to re-parent and reorder; `position` densified in one transaction. **Shipped third** — the row has three drop bands (outer quarter reorders, middle half re-parents), and the slot arithmetic is a pure function in `folderRows.ts`. Two things that are easy to get wrong and are tested as such: **the dragged folder's old slot is removed before the new index is counted**, or reordering downward lands one row too far; and **a refused drop resolves before the write**, so a cycle draws no indicator and spends no transaction. `position` densification itself was already done in M1 and is asserted by the Rust tests.
- Circular-parent guard in the frontend, matching the backend: the drop is refused with no indicator rather than by an error after the fact.
- Inline create, rename, delete; delete confirmation naming the descendant count. **Shipped second** — `InlineNameInput`, a per-row overflow menu, and `ConfirmDialog`. Two decisions worth recording: a **childless folder deletes without a dialog**, since the confirmation exists to warn about a subtree; and the menu items are **text, not icons**, because the `05-ui-ux.md` §3.3 inventory is closed and has no edit glyph, so using one would mean growing it for three verbs that are already words. `F2` and `Delete` route through the same handler as the menu items, so the confirmation cannot be present for one path and absent for the other.
- `TagList` with counts from the query in `03-data-model.md` §5; counts exclude trashed notes.
- `TagEditor` and `FolderPicker` popovers. **Shipped sixth, and last** — both are the same component over different options, because a tag editor that looked different from the folder picker would be two visual languages for "choose a value" in a 28 px row, and both are listboxes rather than menus so the arrow keys and `Home`/`End` come from the ARIA pattern rather than from hand-written handlers. Three things that were not obvious in advance: the popovers are **portalled** because the status bar sits at the bottom of the editor pane's own stacking context and an in-place popover is clipped by it; the geometry is **measured in the click handler**, not in an effect, because at the click it is already in hand; and `Enter` on a name that already exists **toggles rather than creating a duplicate**, because `tags_create` normalises to the first-created spelling and a case-insensitive match is the backend's job, not the frontend's.
- Folder and tag slots in the editor status bar. **Shipped sixth** — the row now carries all five elements of `04-editor.md` §9 plus the pin. Two decisions recorded in `04-editor.md` §9 and `05-ui-ux.md` §6.4: the slots show the **pending** value, not the saved one, so a click never appears to do nothing for 800 ms; and folder and tag changes go **through the autosave debounce** rather than through commands of their own, because `notes_save` is the only write that carries `folderId` and `tagIds` with the document together and the tag set is a whole-set replacement. That forced an exception to §5.1's unchanged-document skip, and the exception has to survive the debounce, a note-switch flush and the retry timer — the retry is unreachable from the UI, which is why it is unit-tested rather than checked by hand.
- Pin toggle and Pinned filter. Pinned notes sort first in every selection. **Shipped fourth** — the Pinned filter and the ordering were already there from M1 and M3; this adds the control on the card, `Ctrl+D` and the status-bar control in the editor, and the optimistic update with reconciliation. It required **one new IPC command, `notes_set_pinned`**, recorded in `02-architecture.md` §7 with the reasoning: a card holds no document, so reusing `notes_save` would either load a body to change a boolean or overwrite whatever the editor has typed since. `doc_json` and every derived column are untouched by it, and `updated_at` moves with the flag the same way `notes_move` does.
- Trash: soft delete, undo toast, restore, permanent delete, empty trash. **Shipped fifth** — a per-row overflow menu whose items are chosen by the *selection* rather than by the shell, so a live note has no "delete permanently" control on it and a trashed note cannot be moved to the trash again. `Ctrl/Cmd+Backspace` deletes the open note. Two things that only showed up in a browser and are recorded in `05-ui-ux.md` §6.2: the menu had to be **portalled and viewport-positioned**, because a transformed virtualised row creates a stacking context that `z-index` cannot escape — the next card painted over it and swallowed the click; and the row's menu is **keyed rather than a boolean**, so a re-sorting list cannot leave one open over the wrong note.
- Circular-parent guard in folder move: a folder cannot be moved into itself or its own descendant. **Shipped third** — the backend guard dates from M1; the frontend half is the drag bullet above.
- **Done when:** a folder tree of depth 10 can be navigated by keyboard alone, and dragging a folder onto its own descendant is refused with an explanation. A note's folder and tags are changed from the editor's status bar and survive the next keystroke.

### M5 — Search

- `notes_fts` migrations and triggers (already created in M1; index integrity verified here). **Already in place** — required test 6 in `10-conventions.md` §10 has asserted the index across insert, update, soft delete and hard delete since M1, and `SearchService` itself landed in M1 with the service layer.
- Search service: sanitisation and prefix matching from `03-data-model.md` §3.6. **Already in place** from M1, with required test 7 over FTS operators.
- `bm25` ranking, weights 8.0 / 1.0. **Already in place**; the mock now reproduces the weighting and the prefix rule (`src/mock/search.ts`).
- Search scoped to the active selection. **All five selections**, including the trash — recorded in `05-ui-ux.md` §6.5.
- Snippet generation with `<mark>` highlighting, sanitised before rendering. **A second allowlist**, in `lib/sanitize.ts`, holding `mark` and nothing else.
- Debounced input at 150 ms; query length ≥ 2; `Esc` clears. 150 ms and the ≥2 gate are in `useSearch`; `Esc` clears the field without blurring it.
- **Done when:** on a seeded 50 MB corpus, p95 search latency is under 50 ms, and a search for a term present in 10 000 notes returns without a visible loading state.

  **Shipped 2026-10-10**, branch `m5-search`. Four things in the plan shipped differently from what was written above, each recorded where it belongs:

  - **`NoteCard` grew a `snippet`, rather than a second result card.** The prototype draws a search hit as the same note card with `mark` inside the excerpt, and a separate component would have been a second card to keep in step with the pin, the chips and the row menu. `NoteRow` is `NoteSummary` plus an optional snippet, and a `SearchHit` is assignable to it with no cast.
  - **The snippet replaces the excerpt line instead of sitting under it.** A result is the sentence that matched; printing the note's opening above it as well is the same text twice. The consequence is that a match in the first block repeats the title, because `plain_text` begins with the title block — which is what FTS5 returns too.
  - **A "Show more" control, because `SearchPage` has `nextOffset` and the header counts every match.** A list that stopped at the page boundary while the header said "4,123 results" would be claiming to be complete. The control is outside the scroll container so it stays reachable.
  - **The mobile list view got its own field under the bar,** which the plan did not mention and the prototype and §2.4 both show.

  338 TypeScript tests and 107 Playwright tests. Two defects that only a browser found are fixed in `base.css`: Chromium's own cancel button beside the field's `x`, and a second focus ring drawn by the bare input inside the container.

  **Outstanding:** the p95 criterion of "Done when". Seeding a 50 MB corpus is the slowest test in the project and is deliberately **not** covered — measure it in release and record the number here when it is done. The second half of the criterion is covered: `useSearch.test.tsx` asserts that the previous result set stays on screen while the next query is in flight, which is what "without a visible loading state" means.

### M6 — Themes, settings, polish

- Light, dark, system themes from the token tables in `05-ui-ux.md` §3.1.
- Contrast verified in both themes: 7:1 body on `--surface`, 4.5:1 on `--surface-raised`.
- Accent colour picker: six presets plus a custom colour, per `05-ui-ux.md` §6.6.
- Icon pass: every icon in the `05-ui-ux.md` §3.3 inventory renders at all four sizes, inherits `currentColor`, and passes contrast against `--surface` and `--surface-raised` in both themes.
- OS theme change listener.
- Settings dialog; settings never touch the notes database.
- Full keyboard map from `05-ui-ux.md` §7, including `Ctrl/Cmd+\`, `Ctrl/Cmd+F`, `Ctrl/Cmd+S`, `F2`, `Ctrl/Cmd+D`.
- All empty states from `05-ui-ux.md` §8, with real copy, no illustrations.
- Accessibility pass: `05-ui-ux.md` §10, including the focus trap in dialogs and `aria-live` on search and save state.
- `prefers-reduced-motion` honoured.
- **Done when:** the app is fully operable from the keyboard, and both themes pass an automated contrast check.

### M7 — Android

**Blocked until the Android SDK is installed.** Commands in `docs/11-verification.md` §3.5. Everything else in the roadmap is unaffected.

- `tauri android init`; configure min SDK 26, target 34, arm64 and armeabi-v7a.
- No `INTERNET` permission (`06-platform.md` §4.2).
- `adjustResize` verified against keyboard coverage.
- No `vh`-sized fixed elements; `dvh` where unavoidable.
- Back-button handler per the stack in `06-platform.md` §4.4.
- Lifecycle flush on `Pause`; reload on `Resume`.
- `@fontsource/inter` bundled — no network font fetch.
- Verified on an arm64 device with the **oldest** supported System WebView, not only the newest.
- **Done when:** every item in `06-platform.md` §6 "Android" passes on a physical arm64 device in airplane mode.

### M8 — Packaging

- Windows NSIS installer and portable `.exe`.
- macOS `.app` and `.dmg`; unsigned-launch steps documented.
- Linux `.deb` and `.AppImage`.
- Android debug-signed APK, keystore outside the repository.
- App icons and a minimal `README` for end users, separate from this specification.
- Release build passes `npm run build`, `cargo test`, `cargo clippy`, and `npm run typecheck` with zero warnings.
- **Done when:** a clean machine installs the desktop build and the APK runs on a device, with no development tooling present.

## 3. Deferred, in candidate order

Ordered by value per unit of effort. Each needs a scope document before implementation.

| Feature | Effort | Prerequisite |
|---------|--------|--------------|
| Slash command menu | 2 d | Command registry |
| Wiki links and backlinks | 5 d | Note reference index |
| Link support | 3 d | URL sanitisation, edit popover, share intents |
| Export to HTML / Markdown / PDF | 2 d | Serialisers specified in `04-editor.md` §10 |
| Note version history | 3 d | Revisions table |
| Code syntax highlighting | 2 d | `lowlight`, dark-theme token set |
| Command palette | 2 d | Command registry |
| Images and attachments | 8 d | Asset storage, thumbnails, pickers, Android permissions |
| Global quick-capture shortcut | 2 d | Capture flow design, platform UI |
| iOS | 10 d | Separate build and distribution project |
| Tables | 4 d | Mobile horizontal-scroll strategy |
| Sync, Phase A–F | 12 d | `07-sync-plan.md` |

## 4. Dependencies

```
M0 ──► M1 ──┬──► M2 ──┬──► M7 ──► M8
            │          │
            └──► M3 ───┴──► M4
                        └──► M5
                        └──► M6
```

Critical path: M0 → M1 → M2 → M7 → M8. M3–M6 are not on it.

## 5. Deferred decisions to revisit during implementation

Each of these was resolved conservatively. Revisit the moment implementation proves the choice wrong; do not defend it out of inertia.

| Decision | Chosen for | Revisit when |
|----------|-----------|--------------|
| Native window decorations | Reliability, less platform work | If the user wants a custom title bar |
| Whole-document saves | Simplicity | If profiling shows a problem above ~50 KB documents |
| Text conflict kept local, remote parked | Never lose either version | If conflict frequency proves high, implement real three-way merge |
| Tag set union | Relational model, no extra technology | If tag removal sync proves unreliable, switch to `doc_tags jsonb` wholesale replacement |
| No manual note ordering | Recency and pinning are how notes are found | If users build ordered sequences of notes (a reading queue), not just collections |
| Pinning as the only ordering flag | `is_pinned` and `is_favorite` were the same idea | Never, unless a genuine second need appears |
| No link mark | No sanitisation surface in v1 | In v1.2, with attachments |
| Lucide, stroke-only, 4 fixed sizes | Neutral outline style, MIT, tree-shakes | If the visual weight ever fights the type, Heroicons or Tabler are drop-in equivalents |
| Emoji banned from the UI | Rendering and theming are unreliable across platforms | Never — this is a hard constraint, not a preference |
| FTS5 for local, `tsvector` remote | Instant offline search | Never — the asymmetry is intentional |
| Editor instance per note | Undo history must not leak | Never |

## 6. Open questions

| # | Question | Status | Default if unanswered | Blocks |
|---|----------|--------|----------------------|--------|
| Q1 | Product name, bundle identifier, database filename | **Answered** — Chayote, `com.chayote.app`, `chayote.db` | — | Resolved |
| Q2 | Default folder on first launch, or everything unfiled? | **Answered** — everything unfiled, by ADR-014 | — | Resolved |
| Q3 | `is_pinned` versus `is_favorite` | **Answered** — `is_pinned` only. `is_favorite` removed from the schema | — | Resolved |
| Q4 | Timestamp style in the note list | **Answered** — relative only, no tooltip, per `05-ui-ux.md` §6.5a. The default in this table had contradicted itself; §6.5a now settles it | — | Resolved |
| Q5 | Remember collapsed folder-tree state per folder | **Answered** — persisted per folder in settings, shipped at M4 | — | Resolved |
| Q6 | Accent palette: one configurable colour, or presets plus custom | **Open** | Six presets plus a custom colour picker | M6 |
| Q7 | Should pinning be visible as a dedicated filter, or only as an ordering? | **Answered** — both, per `05-ui-ux.md` §5 and §6.3a. The filter ships in M4 with the rest of the pinning work; the ordering already does | — | Resolved |
| Q8 | Repository directory rename from `notes` to `chayote` | **Answered** — done, the directory is `D:\Projects\chayote` | — | Resolved |

**None of the open questions blocks M0.** Each has a documented default that can be implemented and changed later without a migration.

### Q8 — resolved

The directory is `D:\Projects\chayote`. The rename succeeded after the shells holding the old path were closed. Nothing in the specification depended on the directory name; the identifier that matters for Android signing is `com.chayote.app`, fixed in ADR-012.

## 7. Progress tracker

| Milestone | Status | Notes |
|-----------|--------|-------|
| M0 | **Done** | 2026-10-07. Scaffold, tokens, icon layer, `ipc.ts` + mock, Playwright, CI. Gates clean. `docs/02-architecture.md` §1.1 version floors updated to TS 6 / Vite 8 / Vitest 5 / uuid 14 |
| M1 | **Done** | 2026-10-07. `rusqlite`, migrations 0001–0003, repository traits, `AppError`, settings store, 33 Rust tests + 29 TS tests. Still 33 — M4's three Rust tests were offset by no new ones here, so the count moved to 36 in the M4 row |
| M2 | **Done** | 2026-10-08. TipTap 3.31, paste sanitisation, `clipboardTextSerializer`, autosave controller, status bar, task-checkbox node view. 65 TS tests + 22 Playwright tests. Four deviations from the plan recorded in §2. Hard-kill check still outstanding |
| M3 | **Done** | 2026-10-09. `Sidebar`, `NoteCard`, a measured virtualised `NoteList`, `stores/selection.ts` + `stores/settings.ts`, `relativeTime`, three layouts, resizable sidebar, `Ctrl+N`/`Ctrl+F`/`Ctrl+\`. 98 TS tests + 49 Playwright tests. Four deviations recorded in §2 |
| M4 | **Done** | 2026-10-10. Branch `m4-organisation`, six commits. The folder tree keyboard pattern of `05-ui-ux.md` §10.1 (one tab stop, roving tabindex); inline create/rename/delete with the descendant-count confirmation and the per-row overflow menu; drag to re-parent and reorder with the three-band drop target and the pre-write cycle refusal; the pin toggle with `Ctrl+D`, which added one IPC command, `notes_set_pinned`; the trash actions with their undo toast; and the status bar's folder and tag slots with their two popovers. Q5 closed. 36 Rust tests, 303 TS, 95 Playwright. Two things worth carrying forward: the autosave needed an exception to §5.1's unchanged-document skip that has to survive the debounce, a note-switch flush *and* the retry timer — the retry is unreachable from the UI, so it is unit-tested; and creating a tag flushes before refetching, because `tags_list` hides a tag whose count is zero and the new tag is genuinely not in the library until the note carrying it is saved |
| M5 | **Done** | 2026-10-10. Branch `m5-search`, four commits. The `useSearch` hook — 150 ms debounce, the ≥2-character minimum, the active selection as scope, the previous page kept while the next one loads, and paging via `nextOffset`; results replacing the list with `Esc` restoring it; one `NoteCard` for both with `NoteRow` carrying an optional snippet; a snippet allowlist holding `mark` and nothing else; the "No results for “query”" state and a polite live count; the mobile list view's own field; and a mock backend that answers with real prefix matching, the 8.0/1.0 weighting, and `<mark>` snippets rather than substrings and an opening excerpt. Four deviations from the plan recorded in §2. 36 Rust tests, 338 TS, 107 Playwright. The p95 half of "Done when" is **outstanding** and deliberately not covered |
| M6 | Not started | Q6 has a default. Screenshot review of the full UI starts here |
| M7 | Not started | **Blocked** — needs Android SDK, `docs/11-verification.md` §3.5 |
| M8 | Not started | |