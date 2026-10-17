# Chayote — Product & Engineering Specification

**Chayote** is a minimalist, local-first WYSIWYG notes application for **Desktop (Windows/macOS/Linux)** and **Android**, built with **Tauri 2 + React + TypeScript + TipTap + SQLite**.

The specification is complete and the application is being built from it, milestone by
milestone. Where the code and this document disagree, the code is where the milestone
actually got to — see §2.

Two artefacts define the UI, and they are authoritative for different things.
They change together — see ADR-016.

| Artefact                                       | Authority over                             |
| ---------------------------------------------- | ------------------------------------------ |
| [`prototype/index.html`](prototype/index.html) | How it **looks**. Open it in a browser.    |
| [`docs/05-ui-ux.md`](docs/05-ui-ux.md)         | **Why** it is that way, and how it behaves |

| Property          | Value                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name      | **Chayote**                                                                                                                                                     |
| Bundle identifier | **`com.chayote.app`**                                                                                                                                           |
| Database filename | `chayote.db`                                                                                                                                                    |
| Licence           | MIT (`LICENSE`)                                                                                                                                                 |
| Current milestone | **M8** — packaging in progress on `m8-packaging`; Windows NSIS + portable verified, icons drawn, `INSTALL.md` written                                           |
| Next milestone    | **M8 done** — clean-machine install, macOS/Linux artefacts from the release workflow, see `docs/08-roadmap.md` §7                                               |
| Git repository    | **Initialised**, `main` buildable, work on topic branches landing via pull request                                                                              |
| Android SDK       | **Installed and building** — `%LOCALAPPDATA%\Android\Sdk`, NDK 27, licences accepted. `ANDROID_HOME` set, Rust Android targets installed. Release APK 14.65 MiB |

---

## 1. Document index

**Read in this order.** Each document is self-contained and states its own status.

| #   | Document                                             | Purpose                                                                                |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 01  | [`docs/01-product.md`](docs/01-product.md)           | Vision, UX principles, v1 scope, explicit non-goals                                    |
| 02  | [`docs/02-architecture.md`](docs/02-architecture.md) | Stack, layer diagram, IPC surface, **sync-readiness rules R1–R9**                      |
| 03  | [`docs/03-data-model.md`](docs/03-data-model.md)     | Full SQLite schema, FTS5, migrations, mapping to Postgres                              |
| 04  | [`docs/04-editor.md`](docs/04-editor.md)             | TipTap configuration, document format, paste, autosave                                 |
| 05  | [`docs/05-ui-ux.md`](docs/05-ui-ux.md)               | Layout, **icon system**, tokens, shortcuts, empty states, a11y                         |
| 06  | [`docs/06-platform.md`](docs/06-platform.md)         | Desktop and Android specifics, paths, build and release                                |
| 07  | [`docs/07-sync-plan.md`](docs/07-sync-plan.md)       | Supabase/Postgres sync: phases, conflict policy, RLS                                   |
| 08  | [`docs/08-roadmap.md`](docs/08-roadmap.md)           | Milestones M0–M8, acceptance criteria, **progress tracker §7**                         |
| 09  | [`docs/09-decisions.md`](docs/09-decisions.md)       | Decision log: what was chosen, what was rejected, why                                  |
| 10  | [`docs/10-conventions.md`](docs/10-conventions.md)   | Repo layout, naming, state, errors, testing, quality gates                             |
| 11  | [`docs/11-verification.md`](docs/11-verification.md) | **How each layer is proved correct.** Gates, Playwright, what an agent can check alone |

Three documents carry the weight and are worth more attention than the rest: `02` for the rules that must never be broken, `08` §7 for where the project actually is, and `09` for why anything was decided the way it was.

**Two artefacts, two kinds of authority.** `docs/` is authoritative for rules and rationale. [`prototype/index.html`](prototype/index.html) is authoritative for appearance. They change together — see ADR-016 and `docs/10-conventions.md` §12.

**Conflict rule:** if code and a document disagree, the code is wrong until either the code is fixed or the document is corrected in the same change. Documents are updated _before_ implementation when a decision changes.

---

## 2. Current status

| Item                              | Status                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name, identifier, licence | **Decided** — Chayote, `com.chayote.app`, MIT                                                                                                                                                                                                              |
| Stack and v1 scope                | **Decided**                                                                                                                                                                                                                                                |
| Sync architecture direction       | **Decided** (Supabase/Postgres, local-first)                                                                                                                                                                                                               |
| Sync implementation               | **Not started** — architecture only, see §5                                                                                                                                                                                                                |
| Specification                     | **Complete**, 11 documents                                                                                                                                                                                                                                 |
| UI prototype                      | **Complete and approved** — `prototype/index.html`                                                                                                                                                                                                         |
| Application code                  | **M0–M6 complete** — scaffold, tokens, icon layer, IPC seam, SQLite data layer, editor with autosave, UI shell with sidebar and virtualised note list, organisation: folders, tags, pinning, trash, search, and themes, settings and the full keyboard map |
| Current milestone                 | **M8** — packaging: icons, `INSTALL.md`, release workflow, Windows NSIS + portable verified locally                                                                                                                                                        |
| Frozen decisions | 23. ADR-019 was added at M6: the accent is per-theme. ADR-023 was added on 2026-10-17: the note title is a field of its own, not a value derived from the first line of the body |

**M6 shipped on 2026-10-10; M7 followed on the same day.** M0 and M1 shipped on 2026-10-07, M2 on 2026-10-08, M3 on 2026-10-09, M4, M5 and M6 on 2026-10-10. `npm run tauri dev` shows the window and creates `chayote.db` with the full schema; `npm run dev` runs the frontend in a browser through the mock backend; 36 Rust tests, 388 TypeScript tests, and 141 Playwright tests cover the data layer, the editor, the shell, organisation, search and themes, and the gate commands are clean. The editor chunk is loaded after first paint, so the shell still paints at the M0 cost. The sidebar's folder tree is keyboard-navigable and draggable, folders and tags are created, renamed and deleted in place, notes can be pinned, filed, tagged, trashed and restored, the editor's status bar changes a note's folder and tags, `Ctrl+F` finds notes by title or body with the matching words marked and `Esc` restoring the list, and the settings dialog themes the app per theme with an accent that is verified for contrast in both. The whole app is operable from the keyboard alone, checked as one continuous flow in `e2e/keyboard.spec.ts`.

**M6 found four silent defects that had shipped since M3**, all recorded in `docs/08-roadmap.md` §2: the dark theme's accent was unreachable because `--accent` was written inline on the element carrying `data-theme`; `05-ui-ux.md` §6.6's contrast claim was false as written; `--text-subtle` carried note timestamps at 2.6:1; and four emoji sat in the specification's own diagrams. The first is ADR-019. The lesson worth carrying: **a number in a document is only worth what asserts it**, and none of these four looked wrong.

**M7 shipped on device; M8 is in progress.** An APK cross-compiles for both arm ABIs, measures 14.65 MiB against the 20 MB budget, and carries no `INTERNET` permission — read out of the built artefact, not off the source file. The on-device run covered the real SQLite backend, the back button via ADR-020, and the mobile editor fixes; long-press, airplane mode and the Android 15+ `adjustResize` question stay unmeasured, see §7. M8 so far: the Chayote icon set, `INSTALL.md`, a release workflow for clean-runner bundles, and a locally verified Windows NSIS installer (3.20 MiB) plus portable exe (7.17 MiB).

**One criterion is outstanding, and one more was found at M7.** The p95 latency half of M5's "Done when" — under 50 ms on a seeded 50 MB corpus — is deliberately not covered by a test. Seeding that corpus is the slowest thing in the project, and it is recorded as outstanding in `docs/08-roadmap.md` §2 rather than claimed. Everything else in M5 is verified by a command. The second is smaller and was fixed: `e2e/keyboard.spec.ts` had been failing about two runs in three on `main`, because it typed into the editor without the settle step `10-conventions.md` §10 requires of a code-split editor. It was not caused by M7 and was not caught earlier because nothing had re-run that spec on `main`.

---

## 3. Frozen decisions

Do not re-litigate any of these. The reasoning for each, and the alternatives that were rejected, are in [`docs/09-decisions.md`](docs/09-decisions.md).

| ADR | Decision                                                                               |
| --- | -------------------------------------------------------------------------------------- |
| 012 | Name **Chayote**, identifier `com.chayote.app`, database `chayote.db`, licence **MIT** |
| 001 | Shell is **Tauri 2** (Rust) + React 19 + TypeScript + Vite                             |
| 002 | **ProseMirror JSON** is the only stored content format. HTML is export-only            |
| 003 | **SQLite via `rusqlite`** behind repository traits. The frontend never writes SQL      |
| 004 | Search is **FTS5 + `bm25`** locally, Postgres `tsvector` remotely                      |
| 005 | Sync is **local-first**, Supabase/Postgres, implemented **after v1**                   |
| 006 | **Two panes** on desktop, single pane on mobile                                        |
| 007 | v1 scope: folders, tags, pinning, trash, search, themes — nothing more                 |
| 008 | **Tailwind v4** with CSS custom properties for theming                                 |
| 009 | **Native** window decorations in v1                                                    |
| 010 | The **nine sync-readiness rules** R1–R9 are review criteria                            |
| 011 | **Pinning** replaces favourites. Notes are **not** manually ordered                    |
| 014 | First launch creates **no** folders or tags                                            |
| 015 | Icons are **Lucide vectors**. No emoji in the UI, ever                                 |
| 016 | The prototype is a **permanent** visual reference, changed with the docs               |
| 019 | The accent is **per-theme**; a custom accent is used verbatim                          |
| 023 | The note title is a **field of its own**; the body's leading line is not it             |

Full table with dates in [`docs/09-decisions.md`](docs/09-decisions.md).

**What is deferred, and to when:** sync, wiki links, tables, attachments, slash menu, command palette, exports, version history, iOS. See `docs/01-product.md` §6 and `docs/08-roadmap.md` §3.

---

## 4. Repository layout

```
chayote/
├── README.md                  ← you are here
├── AGENTS.md                  ← agent onboarding and workflow
├── LICENSE                    ← MIT
├── INSTALL.md                   ← end-user install guide, separate from the spec
├── docs/                      ← specification, 11 documents
├── prototype/index.html       ← visual source of truth, permanent (ADR-016)
├── src/                       ← React frontend
├── src-tauri/                 ← Rust backend
└── package.json, vite.config.ts, tsconfig.json, src-tauri/Cargo.toml
```

The authoritative layout is `docs/10-conventions.md` §1. This is a summary.
Contributing rules for agents live in `AGENTS.md`; the sync-readiness rules
R1–R9 live in `docs/02-architecture.md` §6.

## 5. Manual steps outstanding

**The runtime half of M7 has now been run on a physical device.** An Infinix X6836,
Android 13, System WebView 153, arm64-v8a, with a debug-signed APK. What that verified
is in `docs/11-verification.md` §3.5a: the real SQLite backend including migrations,
FTS5 and WAL on the device filesystem, derivation, survival of a hard `force-stop`, the
`Pause` flush, `Resume`, rotation, and `adjustResize` observed rather than merely
declared. It also found a defect the browser could not — the app drew under the system
status and navigation bars — which is fixed. **The back button is now built too**
— ADR-020 is the decision it needed, since Tauri 2.12 has no back-button event
JavaScript can reach — **and the mobile editor's cramped status bar is fixed**: the
user pointed at it and the prototype already solved it, so below 768 px the row
carries folder, tags, an abbreviated word count and the save state, while the pin
and the delete action live in the "three dots" overflow menu that finally works.

**What is still outstanding:**

- **Long-press and airplane mode** — need a human thumb or a permission this shell does not have. Recorded as unmeasured in `§3.5a` rather than folded into "verified on device".
- **The Android 15+ `adjustResize` question.** This device is Android 13, so it could
  not settle whether `targetSdk 37` plus `enableEdgeToEdge()` makes the attribute inert
  on a newer phone. Recorded as unmeasured rather than folded into "verified on device".

The toolchain is here and the build is repeatable: `docs/11-verification.md` §3.5 has
the commands, including the `aapt2` checks that read the manifest off the APK rather
than off the source file. M0–M6 and M8 are unaffected.
