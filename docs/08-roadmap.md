# 08 — Roadmap

**Status:** Frozen. Last updated 2026-10-10.

---

## 1. Milestones

| # | Milestone | Depends on |
|---|-----------|----------|-----------|
| M0 | Project scaffold and toolchain | — |
| M1 | Data layer: SQLite, migrations, repositories | M0 |
| M2 | Editor: TipTap, autosave, paste, input rules | M1 |
| M3 | UI shell: layout, sidebar, note list, selection | M1 |
| M4 | Organisation: folders, tags, pinning, trash | M3 |
| M5 | Search: FTS5, filtering, snippets | M1, M3 |
| M6 | Themes, settings, keyboard, empty states, polish | M3 |
| M7 | Android | M2–M6 |
| M8 | Packaging and distribution | M7 |

## 2. Milestone details

### M0 — Scaffold and toolchain

**Shipped 2026-10-07.** `git init` with the spec and prototype; Tauri 2 + React 19 + TypeScript (`com.chayote.app`, 1280 × 820); `ipc.ts` Tauri-or-mock adapter (ADR-018) so `npm run dev` works in a browser from the first commit; Tailwind v4 token layer; `lucide-react` + `.i-*` classes, proven by building `IconButton`/`TopBar` first; strict TS/ESLint/Prettier/Vitest/clippy in CI; bundled Inter; Playwright smoke test. Gate (typecheck, lint, build, `cargo check`) clean; empty window, no console errors.

One wrong assumption shipped in the plan above: it said the Android SDK was absent from this machine — it had been installed all along, just not on `PATH` (`11-verification.md` §2).

### M1 — Data layer

**Shipped 2026-10-07.** `rusqlite` bundled, `Database` struct with the §2 pragmas; forward-only transactional migration runner (`schema_migrations`, **R8**); migrations 0001–0003; `NotesRepo`/`FoldersRepo`/`TagsRepo` traits with SQLite implementations; single-transaction derivation (**R9**) and outbox append (**R5**); document validator; Tauri commands with `AppError` (**R7**); settings store. **Done when** met: every repository method covered, UUIDv7 IDs, failed write leaves no orphan outbox row. 33 Rust tests.

One deviation: `services/` holds derivation and search rather than a module per entity — a write's business logic is its transaction.

### M2 — Editor

**Shipped 2026-10-08.** TipTap 3.31 with the §2 extension set: fresh instance per note (never `setContent`); 800 ms autosave state machine with §5.1 flush conditions and in-flight guard; three-state status indicator; DOMPurify allowlist plus the eight §4.1 rules; `clipboardTextSerializer`; input rules, Typography, per-node placeholders; §7 editor bindings; task-checkbox node view; status bar. 65 TypeScript tests and 22 Playwright tests.

Deviations, each recorded in `04-editor.md`: paste rule 7 is a `Slice` in `handlePaste` (`transformPastedText` returns text); `handleDrop` returns `true`, not `false`; `EditorShortcuts` is an extension after StarterKit; the status bar shipped without folder/tag slots (they need M4's data).

**Outstanding:** the hard-kill half of "Done when" — killing the real process within 800 ms of typing needs the native window (`11-verification.md` §3.4), so it is a human check. The save-commits-within-debounce half is asserted.

### M3 — UI shell

**Shipped 2026-10-09.** Desktop two-pane plus Android single-pane stack (§2.1/§2.4); Zustand selection/theme/width/settings stores; `TopBar`; measured virtualised `NoteList` that never loads bodies; `NoteCard` with boundary-tested relative timestamps; TanStack Query wiring; all five selections; `Ctrl+N` / `Ctrl+F` / `Ctrl+\`. **Done when** met: 10 000 seeded notes scroll, bodies never load. 98 TypeScript tests and 49 Playwright tests.

Deviations: rows are measured (`measureElement`), not fixed height — fixed heights overlapped cards; `@tanstack/react-virtual` added (`02-architecture.md` §1.1); no desktop sidebar toggle, shortcut only, button in the tablet band (`05-ui-ux.md` §9); trash is a filter tab, not a fourth section (§5 needs all five selections reachable).

### M4 — Organisation

**Shipped 2026-10-10**, branch `m4-organisation`, six commits: `FolderTree` — recursive, collapsible, one tab stop with roving tabindex, nested render over a flattened row list; inline create/rename/delete with descendant-count confirmation and per-row overflow menu (`F2`/`Delete` share the handler; childless folder deletes without a dialog; menu items are text, the §3.3 inventory has no edit glyph); drag re-parent/reorder with three-band targets, pre-write cycle refusal, densified positions; pin toggle + Pinned filter via one new command, `notes_set_pinned` (`02-architecture.md` §7); trash — soft delete, undo toast, restore, permanent delete, empty trash — with selection-keyed, portalled row menus; editor status-bar folder/tag slots showing pending values through the autosave debounce, with portalled listbox popovers (`TagEditor`/`FolderPicker`, geometry measured at the click, `Enter` on an existing name toggles). **Done when** met: depth-10 tree by keyboard alone; descendant drop refused with an explanation; folder/tags changed from the status bar survive the next keystroke.

### M5 — Search

**Shipped 2026-10-10**, branch `m5-search`, four commits. The service layer (`SearchService`, FTS index, `bm25` 8.0/1.0, prefix matching) had landed in M1; this added `useSearch` — 150 ms debounce, ≥2 characters, all five selections in scope including trash, previous page kept while loading, `nextOffset` paging with an out-of-container "Show more"; results replacing the list with `Esc` restoring it; one `NoteCard` for hits (`NoteRow` + optional snippet, snippet replacing the excerpt); a `<mark>`-only second allowlist; "No results" state with polite live count; the mobile field under the bar; a mock backend with real prefix matching, weighting and `<mark>` snippets. 338 TypeScript tests and 107 Playwright tests.

**Outstanding:** the p95 half of "Done when" — under 50 ms on a seeded 50 MB corpus, deliberately unmeasured (slowest test in the project); measure in release and record here. The no-visible-loading-state half is asserted.

### M6 — Themes, settings, polish

**Shipped 2026-10-10**, branch `m6-themes-settings`, eight commits. Genuinely new: `SettingsDialog` (no Cancel — fields apply as they change), `ThemeToggle` radiogroup with one tab stop, the top-bar overflow entry point, four §7 bindings, required test 12 (icon inventory + emoji scan), the automated contrast check over both token tables, level-2 screenshots at all six viewport-and-theme combinations. Themes, the store, the OS listener, empty states, focus rings and live regions had landed as groundwork in M0–M3. **Done when** met by command: full keyboard operation, contrast asserted. 384 TS tests and 136 Playwright tests. Q6 closed.

Four silent defects found (first is ADR-019): the dark accent was unreachable — inline `--accent` beat the dark block; §6.6's single-hex contrast claim was false, so each preset carries one value per theme; `--text-subtle` sat at 2.60:1/3.33:1, so the ladder is four steps with muted at 7:1; four emoji sat in the spec's own diagrams. Plus: accent stored as choice, not colour; custom-accent ratio readout; a seventh defect the screenshots caught (default swatch ring).

Two correct-by-design traps the tests pin: `Tab` never leaves the editor, and `Esc` closes exactly one surface (the drawer needs `defaultPrevented` plus a live ref).

### M7 — Android

**Shipped, build and runtime.** `android init`; both arm ABIs cross-compile and link; release APK **14.65 MiB** against the 20 MB budget; manifest read out of the artefact (`aapt2`): no `INTERNET`, `usesCleartextTraffic=false`, `windowSoftInputMode=0x10`. Three generator defaults corrected in the now-tracked `gen/android/` (minSdk 24→26; `INTERNET` to the debug manifest; `adjustResize` added). Back button via ADR-020 — Kotlin callback from `onWebViewCreate` asking the web layer, verified on device (pops in the editor, hands back at the root). Runtime on the Infinix X6836 (Android 13, WebView 153): real SQLite (migrations, FTS5 `bm25`/`snippet()`, WAL, `force-stop` survival), `Pause` flush, `Resume` reload, rotation, `adjustResize` observed, no `vh`-sized fixed elements, bundled Inter (cyrillic subsets in the `.so`). Window insets found broken on device and fixed (`06-platform.md` §4.3, ADR-020). The mobile editor was wrong in four ways, all found by looking at the device: handler-less three-dot button (now `EditorOverflowMenu` with pin/trash), desktop status row at 360 px (now folder/tags/`342 w`/Saved), ~20 px slots against §9's 44 px (mobile bar is 44 px), and an editor pin that never reached the list cache — wrong on desktop since M4, both paths now go through `useTogglePin`. Non-Android findings: the `keyboard.spec.ts` flake fixed (`--repeat-each=6`); `gen/` un-ignored. Known flake recorded, not fixed: `shell.spec.ts` folder-picker Escape fails ~1/4 under default parallelism, never under `--workers=1`. Commands in `11-verification.md` §3.5, halves split in §3.5a.

**Done when not met:** long-press, airplane mode, and the Android 15+ `adjustResize` question (edge-to-edge may render the attribute inert; this device is Android 13) — needs a human, a permission, or a newer device.

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
| Self-update on Android | 3 d | An `ACTION_INSTALL_PACKAGE` intent written by hand, plus `REQUEST_INSTALL_PACKAGES` and a release keystore in CI. `tauri-plugin-updater` cannot install there at all (`06-platform.md` §3.8.1), so this is new work rather than a configuration. Play Store distribution would answer it more durably and is out of scope for v1. |
| Self-update on macOS | 1 d + an Apple Developer account | Code signing, which §3.7 rules out for v1. The manifest and the updater are already in place; only the signature is missing. |
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
| Sync polish (retry/backoff, open-editor guard) | 2 d | `07-sync-plan.md` Phase E |

## 4. Deferred decisions to revisit during implementation

Each of these was resolved conservatively. Revisit the moment implementation proves the choice wrong; do not defend it out of inertia.

| Decision | Chosen for | Revisit when |
|----------|-----------|--------------|
| Native window decorations | Reliability, less platform work | If the user wants a custom title bar |
| Whole-document saves | Simplicity | If profiling shows a problem above ~50 KB documents |
| Text conflict kept local, remote parked | Never lose either version | If conflict frequency proves high, implement real three-way merge |
| Tag set union | Relational model, no extra technology | If tag removal sync proves unreliable, switch to `doc_tags jsonb` wholesale replacement |
| No manual note ordering | Recency and pinning are how notes are found | If users build ordered sequences of notes (a reading queue), not just collections |
| No link mark | No sanitisation surface in v1 | In v1.2, with attachments |
| Lucide, stroke-only, 4 fixed sizes | Neutral outline style, MIT, tree-shakes | If the visual weight ever fights the type, Heroicons or Tabler are drop-in equivalents |