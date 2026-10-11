# 08 — Roadmap

**Status:** Frozen. Last updated 2026-10-10.

**Current position: M7 shipped; M8 is in progress.** M0 through M7
shipped between 2026-10-07 and 2026-10-10: the frontend scaffold, the data layer
behind repository traits, the editor with autosave and paste sanitisation, the UI
shell with the sidebar, the virtualised note list and the three responsive
layouts, the whole of organisation — folders, tags, pinning and trash — search,
themes, settings and the full keyboard map, and Android through the on-device
run in `11-verification.md` §3.5a. Work proceeds in order; a
milestone is not "mostly done".

**M8 so far, on branch `m8-packaging`.** The Chayote icon set is drawn and
generated (accent square with a fruit glyph, desktop and Android launcher
icons); `INSTALL.md` carries the end-user install, unsigned-launch,
data-location and uninstall steps; `.github/workflows/release.yml` builds the
Windows, macOS and Linux bundles on clean runners. Verified locally on
Windows: `Chayote_0.1.0_x64-setup.exe` (3.20 MiB, NSIS) and the portable
`chayote.exe` (7.17 MiB, both far under the 30 MB desktop budget), the
portable build launches to a responding `Chayote` window and creates
`chayote.db` with the full schema. Gates clean: 36 Rust, 388 TS, 141
Playwright. Still open: a clean-machine install, the macOS and Linux
artefacts (the release workflow is written but unrun), and the three items
M7 left unmeasured (long-press, airplane mode, Android 15+ `adjustResize`).

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
| Q6 | Accent palette: one configurable colour, or presets plus custom | **Answered** — six presets plus a custom colour picker, **each preset carrying a value per theme**; shipped at M6 under ADR-019 | — | Resolved |
| Q7 | Should pinning be visible as a dedicated filter, or only as an ordering? | **Answered** — both, per `05-ui-ux.md` §5 and §6.3a. The filter ships in M4 with the rest of the pinning work; the ordering already does | — | Resolved |
| Q8 | Repository directory rename from `notes` to `chayote` | **Answered** — done, the directory is `D:\Projects\chayote` | — | Resolved |

## 7. Progress tracker

| Milestone | Status | Notes |
|-----------|--------|-------|
| M0 | **Done** | 2026-10-07. Scaffold, tokens, icon layer, `ipc.ts` + mock, Playwright, CI. Gates clean. `docs/02-architecture.md` §1.1 version floors updated to TS 6 / Vite 8 / Vitest 5 / uuid 14 |
| M1 | **Done** | 2026-10-07. `rusqlite`, migrations 0001–0003, repository traits, `AppError`, settings store, 33 Rust tests + 29 TS tests. Still 33 — M4's three Rust tests were offset by no new ones here, so the count moved to 36 in the M4 row |
| M2 | **Done** | 2026-10-08. TipTap 3.31, paste sanitisation, `clipboardTextSerializer`, autosave controller, status bar, task-checkbox node view. 65 TS tests + 22 Playwright tests. Four deviations from the plan recorded in §2. Hard-kill check still outstanding |
| M3 | **Done** | 2026-10-09. `Sidebar`, `NoteCard`, a measured virtualised `NoteList`, `stores/selection.ts` + `stores/settings.ts`, `relativeTime`, three layouts, resizable sidebar, `Ctrl+N`/`Ctrl+F`/`Ctrl+\`. 98 TS tests + 49 Playwright tests. Four deviations recorded in §2 |
| M4 | **Done** | 2026-10-10. Branch `m4-organisation`, six commits. The folder tree keyboard pattern of `05-ui-ux.md` §10.1 (one tab stop, roving tabindex); inline create/rename/delete with the descendant-count confirmation and the per-row overflow menu; drag to re-parent and reorder with the three-band drop target and the pre-write cycle refusal; the pin toggle with `Ctrl+D`, which added one IPC command, `notes_set_pinned`; the trash actions with their undo toast; and the status bar's folder and tag slots with their two popovers. Q5 closed. 36 Rust tests, 303 TS, 95 Playwright. Two things worth carrying forward: the autosave needed an exception to §5.1's unchanged-document skip that has to survive the debounce, a note-switch flush *and* the retry timer — the retry is unreachable from the UI, so it is unit-tested; and creating a tag flushes before refetching, because `tags_list` hides a tag whose count is zero and the new tag is genuinely not in the library until the note carrying it is saved |
| M5 | **Done** | 2026-10-10. Branch `m5-search`, four commits. The `useSearch` hook — 150 ms debounce, the ≥2-character minimum, the active selection as scope, the previous page kept while the next one loads, and paging via `nextOffset`; results replacing the list with `Esc` restoring it; one `NoteCard` for both with `NoteRow` carrying an optional snippet; a snippet allowlist holding `mark` and nothing else; the "No results for “query”" state and a polite live count; the mobile list view's own field; and a mock backend that answers with real prefix matching, the 8.0/1.0 weighting, and `<mark>` snippets rather than substrings and an opening excerpt. Four deviations from the plan recorded in §2. 36 Rust tests, 338 TS, 107 Playwright. The p95 half of "Done when" is **outstanding** and deliberately not covered |
| M6 | **Done** | 2026-10-10. Branch `m6-themes-settings`, eight commits. `SettingsDialog` and `ThemeToggle`, the top-bar overflow menu that reaches them, the three-state theme cycle on the button and on `Ctrl/Cmd+Shift+L`, `Ctrl/Cmd+Enter` for sidebar→editor and `Esc` for the tablet drawer; `useDialogFocus` shared with `ConfirmDialog`; required test 12 over the icon inventory, with the inventory read out of `05-ui-ux.md` and an emoji scan over `src/` and `docs/`; the automated contrast check M6's "Done when" names, over both token tables; and level-2 screenshots at all six viewport-and-theme combinations. Q6 closed. 384 TS tests, 136 Playwright. **Four silent defects found, all shipped since M3**: the dark theme's accent was unreachable because `applyAccent` wrote `--accent` inline on the element carrying `data-theme` (ADR-019); §6.6's contrast claim was false as written and no preset holds 4.5:1 in both themes, so each preset now has a value per theme; `--text-subtle` sat at 2.60:1 light and 3.33:1 dark on note timestamps, and the ladder is now four steps with muted at 7:1; and four emoji sat in the specification's own diagrams. Five deviations from the plan recorded in §2 |
| M7 | **Done** | Branch `m7-android`. `tauri android init` against NDK 27.2.12479018 / Gradle 9.6.1 / AGP 9.3.1; both arm ABIs cross-compile and link; **release APK 14.65 MiB against the 20 MB budget**, `native-code` `arm64-v8a` + `armeabi-v7a` only. Manifest read out of the artefact with `aapt2`: **no `INTERNET`**, `usesCleartextTraffic=false`, `windowSoftInputMode=0x10`. Three generator defaults contradicted `06-platform.md` §4 and were corrected; `src-tauri/gen/android/` is now tracked. **On an Infinix X6836 (Android 13, WebView 153, arm64-v8a) with a debug-signed APK: the real SQLite backend, migrations, FTS5 with `bm25` and `snippet()`, WAL on the device filesystem, derivation, survival of a hard `force-stop`, `Pause` flush, `Resume` reload, rotation, and `adjustResize` observed working. The back button was built via ADR-020** — Kotlin from `MainActivity.onWebViewCreate`, asking the web layer whether it consumed the press; verified on device, pops in the editor and hands the press back at the root. **The mobile editor was wrong in four ways, all found by looking at the device** — the three-dot button had no handler (now `EditorOverflowMenu` with Pin/Unpin and Move to trash); the status bar rendered the desktop row at 360 px (now folder, tags, `342 w`, Saved per the prototype); the slots were ~20 px against §9's 44 px (the mobile bar is 44 px); and **a pin made in the editor never reached the list cache** (wrong since M4 on desktop too, both paths now go through `useTogglePin`). **Still outstanding:** long-press, airplane mode, and the Android 15+ `adjustResize` question — the device is Android 13 and cannot settle it. Gates: 36 Rust, 388 TS, 141 Playwright |
| M8 | **In progress** | Branches `m8-packaging`, `fix/mobile-list-full-bleed`, `fix/android-landscape-stays-mobile` and `fix/folder-menu-portal` merged; `fix/mobile-delete-returns-to-list`, `fix/mobile-note-menu-long-press`, `fix/note-menu-single` and `fix/folder-drag-touch-gate` open. Icon set, `INSTALL.md`, release workflow. Windows NSIS (3.20 MiB) + portable (7.17 MiB) verified locally; gates 36 Rust, 409 TS, 152 Playwright. **Found on the phone:** the folder long-press menu rendered in-row and clipped to a sliver — portalled like the note menu, asserted in unit tests + `e2e/mobile.spec.ts`, confirmed via `screencap` after an adb swipe-hold long-press (which the WebView does recognise, correcting the M7 note). The Tags `+` was dead (`NOOP`) and is removed: a bare tag is invisible by the count rule, so creation stays in the note's tag editor (§6.4; prototype updated). Collapse exists via the twisty — verified on device with a nested folder, then removed — with a coarse-pointer hit slop, since 44 px does not fit a 26 px row. Device-work note: two blind taps hit Delete and removed the user's empty Work folder; the pulled DB proved no note was ever filed in it, and it was recreated. The same session found an Enter+blur double-submit making two folders, now guarded in `InlineNameInput`. **Found on the phone:** the mobile list reused the desktop sidebar width, ending the content early with a stray divider — fixed by a null (fluid) width, asserted in `e2e/mobile.spec.ts` and confirmed on the Infinix via `screencap`. **Found on the phone next to it:** rotating to landscape widened the viewport past 768 px and flipped to the tablet band, landing the list in the last-opened note with desktop chrome — fixed by answering `mobile` for any Android WebView (`isAndroidWebView`), asserted at 800×360 in `e2e/mobile.spec.ts` with the desktop bands pinned unchanged, and confirmed on the Infinix by forcing the display orientation and reading back the mobile list. **Found on the phone:** deleting the open note closed it but left the editor view on the stack, stranding the phone on the desktop "No note open · Ctrl+N" pane — fixed by popping the view stack next to the editor close in `onOpenNoteGone` (a no-op at the root), asserted in `e2e/mobile.spec.ts` and confirmed on the Infinix by tapping through Move to trash to the list. Device-work note: the verification trashed the user's only live note and the toast expired before Undo, so it was restored by editing the pulled DB (`deleted_at=NULL`, mirroring the repo restore) and pushing it back — verified back in the list, pin intact. The same session found restore-from-trash has no touch path on mobile (the row menu button is `pointer:fine`-only, long-press selects text, the editor offers no restore) — fixed next on this branch: the row answers `contextmenu` like the folder rows (which is also what a hold fires, and what right-click and the specified §7 `ContextMenu` key reach), with the release's synthesised click swallowed by the row. Measured on the Infinix: the row and the list section had to stop being selectable first (a hold over a card grabbed the "Empty trash" header and no `contextmenu` fired at all); with that, the hold opens Restore/Delete permanently and the menu stays open after release — the prevented hold synthesises nothing on this WebView, and the click guard covers engines that do. Asserted in unit tests + `e2e/mobile.spec.ts`. **Found on the phone next:** two holds open two row menus (the state was per-card — lifted to the list, like the folder tree), and permanent delete leaves the menu under its own confirmation (choosing now closes first; the folder menu already did). Both asserted in unit tests + `e2e/mobile.spec.ts`/`shell.spec.ts` — including the reason the first hid on desktop: a right-click's `mousedown` closes the old menu, which a hold never sends, so the e2e holds dispatch `contextmenu` directly. **Found on the phone next:** a folder row dimmed and untappable after a long-press — a hold started a touch drag before the menu's re-render withdrew `draggable`, and no `dragend` ever cleared it (it resets on a Sidebar remount, e.g. opening a note and back). Rows are not draggable on a coarse pointer now, and opening the menu ends any drag UI; asserted in `FolderTree.drag.test.tsx`. Device-work note: eyeballing pixels put every adb hold ~100 px off (the CSS viewport is 360 wide at DPR 3) — hold coordinates now come from CDP-measured rects over `adb forward`, which also gives trusted touch input on the real WebView. **Found on the phone, three more:** leaving a note left its row highlighted on the list — the marker belongs to a visible editor, so leaving now closes the note through one funnel for both backs, asserted in `e2e/mobile.spec.ts`; the long-press menu had no pin — it leads the live menu now, asserted in unit tests + `e2e/mobile.spec.ts`; and tapping the empty area under a short note did nothing — the editable element fills the pane with a guarded end-focus fallback for the padding, asserted in `e2e/mobile.spec.ts` via touchscreen taps. **Found on the phone:** the mobile list bar’s hamburger was dead (`NOOP` since M3 - the list *is* the sidebar, so nothing opened) and mobile had no path to Settings at all - the slot is a settings gear opening the dialog directly, asserted in `e2e/mobile.spec.ts` by pressing it, and confirmed on the Infinix via `screencap`: gear, tap, dialog, Done. `05-ui-ux.md` sections 2.4/4/6.6/9 and the prototype section 3 phone updated to match. **Found on the phone:** typing a title into a fresh note then pressing back froze the app - the tap blurs the editor (flush one starts the save) and the unmount flushes again while it runs, and the old `while (inFlight)` loop re-entered `persist` and early-returned forever, a microtask loop that starves the task queue the save\u2019s own IPC response arrives on. Unreproducible in a browser, where the mock resolves in a microtask. `flush` now waits on the running save and drains leftovers (retry-owned queue excluded), asserted in `useAutosave.test.ts` with a task-delayed save - pre-fix it hangs so hard even the test runner cannot time out - plus the type-then-back flow in `e2e/mobile.spec.ts`, and confirmed on the Infinix via `screencap`: title typed, back, list with the note saved. **Found on the phone, three more:** the search field\u2019s focus ring lost its bottom edge under the sidebar - the ring is drawn 2 px outside the container onto the sidebar below, which paints later and covers it; the container now lifts above the sidebar while focused (`relative focus-within:z-10`), no layout change. An edit never re-sorted the list - saves patch the cached rows in place without refetching, keeping the old order although `updated_at` just moved; the patch now re-sorts every live selection with the backend ordering (`src/lib/noteOrder.ts`, trash keeps deletion order, search keeps relevance), asserted in unit tests plus the edit-then-back flow in `e2e/mobile.spec.ts` - the `useNotes` comment claiming otherwise was the same wrong mental model. And the tag editor hugged the right screen edge - anchor-relative placement of a 260 px panel has nothing worth following at 360 px, so it is centred on narrow viewports. All three confirmed on the Infinix via `screencap` (ring whole, edited note on top, centred panel). User-requested polish (branch `feat/note-cards`): every note card carries its own border and surface with an 8 px gap — adjacent notes read as separate cards rather than one continuous block — and the open card's border is the accent; prototype §1 and `05-ui-ux.md` §4 updated to match. User-requested polish (branch `feat/section-collapse`): the Folders and Tags sections collapse as a whole from a chevron in their headers — the twisty hides one branch, this hides the high-level list — persisted as `sectionsCollapsed` in the settings store, with `+` expanding a collapsed Folders section first; `05-ui-ux.md` §§2.2/3.3/6.3 and the prototype headers updated to match. User-requested polish (branch `feat/sidebar-alignment`): top-level folder and tag rows hang under their section header in shared columns — twisty under the header chevron, glyph under the header glyph — instead of drifting left of the section titles; the base indent is rem-based so the columns hold at a scaled root font (measured on the phone, where the tag glyph sat a full chevron-width left), with the 16 px per-level nesting untouched; prototype rows and `05-ui-ux.md` §6.3 updated to match, asserted as geometry in `e2e/shell.spec.ts`. Still open: clean-machine install, macOS/Linux artefacts, M7's three unmeasured items |