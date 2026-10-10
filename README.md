# Chayote — Product & Engineering Specification

**Chayote** is a minimalist, local-first WYSIWYG notes application for **Desktop (Windows/macOS/Linux)** and **Android**, built with **Tauri 2 + React + TypeScript + TipTap + SQLite**.

The specification is complete and the application is being built from it, milestone by
milestone. Where the code and this document disagree, the code is where the milestone
actually got to — see §2.

Two artefacts define the UI, and they are authoritative for different things.
They change together — see ADR-016.

| Artefact | Authority over |
|----------|-----------------|
| [`prototype/index.html`](prototype/index.html) | How it **looks**. Open it in a browser. |
| [`docs/05-ui-ux.md`](docs/05-ui-ux.md) | **Why** it is that way, and how it behaves |

| Property | Value |
|----------|-------|
| Product name | **Chayote** |
| Bundle identifier | **`com.chayote.app`** |
| Database filename | `chayote.db` |
| Licence | MIT (`LICENSE`) |
| Current milestone | **M6** — shipped 2026-10-10 |
| Next milestone | **M7** — Android: blocked on the Android SDK, see §7 |
| Git repository | **Initialised**, `main` buildable, work on topic branches |
| Android SDK | **Missing** — blocks M7 only, and nothing else |

---

## 1. Document index

**Read in this order.** Each document is self-contained and states its own status.

| # | Document | Purpose |
|---|----------|---------|
| 01 | [`docs/01-product.md`](docs/01-product.md) | Vision, UX principles, v1 scope, explicit non-goals |
| 02 | [`docs/02-architecture.md`](docs/02-architecture.md) | Stack, layer diagram, IPC surface, **sync-readiness rules R1–R9** |
| 03 | [`docs/03-data-model.md`](docs/03-data-model.md) | Full SQLite schema, FTS5, migrations, mapping to Postgres |
| 04 | [`docs/04-editor.md`](docs/04-editor.md) | TipTap configuration, document format, paste, autosave |
| 05 | [`docs/05-ui-ux.md`](docs/05-ui-ux.md) | Layout, **icon system**, tokens, shortcuts, empty states, a11y |
| 06 | [`docs/06-platform.md`](docs/06-platform.md) | Desktop and Android specifics, paths, build and release |
| 07 | [`docs/07-sync-plan.md`](docs/07-sync-plan.md) | Supabase/Postgres sync: phases, conflict policy, RLS |
| 08 | [`docs/08-roadmap.md`](docs/08-roadmap.md) | Milestones M0–M8, acceptance criteria, **progress tracker §7** |
| 09 | [`docs/09-decisions.md`](docs/09-decisions.md) | Decision log: what was chosen, what was rejected, why |
| 10 | [`docs/10-conventions.md`](docs/10-conventions.md) | Repo layout, naming, state, errors, testing, quality gates |
| 11 | [`docs/11-verification.md`](docs/11-verification.md) | **How each layer is proved correct.** Gates, Playwright, what an agent can check alone |

Three documents carry the weight and are worth more attention than the rest: `02` for the rules that must never be broken, `08` §7 for where the project actually is, and `09` for why anything was decided the way it was.

**Two artefacts, two kinds of authority.** `docs/` is authoritative for rules and rationale. [`prototype/index.html`](prototype/index.html) is authoritative for appearance. They change together — see ADR-016 and `docs/10-conventions.md` §12.

**Conflict rule:** if code and a document disagree, the code is wrong until either the code is fixed or the document is corrected in the same change. Documents are updated *before* implementation when a decision changes.

---

## 2. Current status

| Item | Status |
|------|--------|
| Product name, identifier, licence | **Decided** — Chayote, `com.chayote.app`, MIT |
| Stack and v1 scope | **Decided** |
| Sync architecture direction | **Decided** (Supabase/Postgres, local-first) |
| Sync implementation | **Not started** — architecture only, see §5 |
| Specification | **Complete**, 11 documents |
| UI prototype | **Complete and approved** — `prototype/index.html` |
| Application code | **M0–M6 complete** — scaffold, tokens, icon layer, IPC seam, SQLite data layer, editor with autosave, UI shell with sidebar and virtualised note list, organisation: folders, tags, pinning, trash, search, and themes, settings and the full keyboard map |
| Current milestone | **M7** — Android: **blocked** on the missing Android SDK |
| Frozen decisions | 18. ADR-019 was added at M6: the accent is per-theme |

**M6 shipped on 2026-10-10; M7 is next.** M0 and M1 shipped on 2026-10-07, M2 on 2026-10-08, M3 on 2026-10-09, M4, M5 and M6 on 2026-10-10. `npm run tauri dev` shows the window and creates `chayote.db` with the full schema; `npm run dev` runs the frontend in a browser through the mock backend; 36 Rust tests, 384 TypeScript tests, and 136 Playwright tests cover the data layer, the editor, the shell, organisation, search and themes, and the gate commands are clean. The editor chunk is loaded after first paint, so the shell still paints at the M0 cost. The sidebar's folder tree is keyboard-navigable and draggable, folders and tags are created, renamed and deleted in place, notes can be pinned, filed, tagged, trashed and restored, the editor's status bar changes a note's folder and tags, `Ctrl+F` finds notes by title or body with the matching words marked and `Esc` restoring the list, and the settings dialog themes the app per theme with an accent that is verified for contrast in both. The whole app is operable from the keyboard alone, checked as one continuous flow in `e2e/keyboard.spec.ts`.

**M6 found four silent defects that had shipped since M3**, all recorded in `docs/08-roadmap.md` §2: the dark theme's accent was unreachable because `--accent` was written inline on the element carrying `data-theme`; `05-ui-ux.md` §6.6's contrast claim was false as written; `--text-subtle` carried note timestamps at 2.6:1; and four emoji sat in the specification's own diagrams. The first is ADR-019. The lesson worth carrying: **a number in a document is only worth what asserts it**, and none of these four looked wrong.

**M7 is blocked and is the only thing that is.** The Android SDK is still missing; see §7. Nothing in M0–M6 or M8 depends on it.

**One criterion is outstanding.** The p95 latency half of M5's "Done when" — under 50 ms on a seeded 50 MB corpus — is deliberately not covered by a test. Seeding that corpus is the slowest thing in the project, and it is recorded as outstanding in `docs/08-roadmap.md` §2 rather than claimed. Everything else in M5 is verified by a command.

---

## 3. Frozen decisions

Do not re-litigate any of these. The reasoning for each, and the alternatives that were rejected, are in [`docs/09-decisions.md`](docs/09-decisions.md).

| ADR | Decision |
|-----|----------|
| 012 | Name **Chayote**, identifier `com.chayote.app`, database `chayote.db`, licence **MIT** |
| 001 | Shell is **Tauri 2** (Rust) + React 19 + TypeScript + Vite |
| 002 | **ProseMirror JSON** is the only stored content format. HTML is export-only |
| 003 | **SQLite via `rusqlite`** behind repository traits. The frontend never writes SQL |
| 004 | Search is **FTS5 + `bm25`** locally, Postgres `tsvector` remotely |
| 005 | Sync is **local-first**, Supabase/Postgres, implemented **after v1** |
| 006 | **Two panes** on desktop, single pane on mobile |
| 007 | v1 scope: folders, tags, pinning, trash, search, themes — nothing more |
| 008 | **Tailwind v4** with CSS custom properties for theming |
| 009 | **Native** window decorations in v1 |
| 010 | The **nine sync-readiness rules** R1–R9 are review criteria |
| 011 | **Pinning** replaces favourites. Notes are **not** manually ordered |
| 014 | First launch creates **no** folders or tags |
| 015 | Icons are **Lucide vectors**. No emoji in the UI, ever |
| 016 | The prototype is a **permanent** visual reference, changed with the docs |
| 019 | The accent is **per-theme**; a custom accent is used verbatim |

Full table with dates in [`docs/09-decisions.md`](docs/09-decisions.md).

**What is deferred, and to when:** sync, wiki links, tables, attachments, slash menu, command palette, exports, version history, iOS. See `docs/01-product.md` §6 and `docs/08-roadmap.md` §3.

---

## 4. Starting work in a new chat

**This file is the onboarding document.** If you are an agent and you have read
this file, you already have everything in §4.1. Do not wait to be told to read
the other documents — that instruction is here so it cannot be missed.

The only thing a new session cannot discover on its own is **the path to this
folder**, because the session may have opened somewhere else entirely. That is
what the one-line first message in §4.2 provides.

### 4.1 Agent onboarding — read this, then act

Do this in order. Do not skip to writing code.

1. Read `docs/01` through `docs/11` in numeric order. They total about 190 KB.
   Read them all; they are written to be read once and then followed.
2. Read `prototype/index.html`. It is the visual source of truth for the UI.
   Build components against it, never against the ASCII wireframes in
   `docs/05-ui-ux.md`. If you change tokens, icon sizes, layout metrics, or
   user-visible copy, change the prototype in the same edit (ADR-016).
3. Read `docs/08-roadmap.md` §7 to see the progress tracker, then compare it
   against what actually exists in the working tree.
4. State which milestone is current and what the next concrete tasks are.
   **Stop there and wait for confirmation.** Do not start writing code in the
   same turn as the plan.

While working:

- Follow `docs/10-conventions.md` for layout, naming, state, and errors.
- Verify your work with `docs/11-verification.md`. Run the gate commands; report
  the real output. Never claim a check passed that was not run.
- Never violate the sync-readiness rules **R1–R9** in `docs/02-architecture.md`
  §6. They are review criteria, not suggestions. See §5 of this file.
- If a document and the code disagree, **the code is wrong.** Fix the code. If
  the document is genuinely wrong, change it in the same commit — never leave a
  document describing something the code does not do.
- Update `docs/08-roadmap.md` §7 in the same commit as the work it describes.
- Commit at the end of each task. Do not push unless explicitly asked.
- Do not re-propose the stack, the layout, or the editor choice. They are
  decided and the reasoning is in `docs/09-decisions.md`.

**Pause and ask the user when:** the plan needs approval · a visual judgement is
needed, since assertions cannot judge taste · a change touches R1–R9 · a frozen
decision would change · a check cannot be run.

### 4.2 The first message — one line

For the first session in a new folder, the whole message is:

```
Chayote. D:\Projects\chayote — read README.md §4 and follow it.
```

If the directory is still named `notes`, that path is `D:\Projects\notes`.
Nothing else is required: §4.1 lives in the file you have just been pointed at.

Once code exists in the tree, even that is unnecessary — `Chayote,
D:\Projects\chayote, continue` is enough. The agent reads `README.md`,
`docs/10-conventions.md`, and whichever documents the request actually touches.

### 4.3 Why a bare "привет, прочитай документы" is not enough

It starts the work, then fails in three predictable ways:

| What goes wrong | Why | Fixed by |
|-----------------|-----|----------|
| The agent never opens `prototype/index.html` | A prototype looks optional next to numbered documents | §4.1 step 2 |
| The agent re-proposes the stack | `README.md` §3 says "decided" without repeating the reasoning | §4.1, "do not re-propose" |
| The agent builds UI from the ASCII wireframes | Diagrams in `docs/05-ui-ux.md` read as specification | §4.1 step 2, ADR-016 |

None of these is an agent failure. A specification does not advertise its own
auxiliary artefacts, which is exactly why §4.1 exists.

### 4.4 If something is stale

Documents and code change together (`docs/10-conventions.md` §12), but they
drift when a session ends abruptly. This applies to the progress tracker in
`docs/08-roadmap.md` §7 in particular, which is the one document that records
state rather than design.

Ask for a report before any repair:

```
Compare docs/08-roadmap.md §7 against the working tree. List every
discrepancy. Report only — change nothing yet.
```

Then fix whichever side is genuinely wrong, and update the other in the same
commit. Never leave the tracker claiming a milestone is done when it is not,
or that it has not started when it has.

---

## 5. The nine sync-readiness rules

The application will gain cloud sync after v1. Every decision in these documents
was filtered through one question: *does this make this harder later?*

These are the rules that answer it. They are stated in full in
[`docs/02-architecture.md`](docs/02-architecture.md) §6 and recorded as ADR-010.
**They are review criteria. A change that breaks one is wrong, and that judgement
belongs to whoever picks this up next — you.**

| | Rule | Prevents |
|---|------|----------|
| **R1** | Primary keys are UUIDv7 generated on the client, never reassigned or reused | Server-assigned IDs, which make offline creation a round trip and risk ID reuse after deletion |
| **R2** | Timestamps are UTC epoch milliseconds | Device clock skew corrupting merge order |
| **R3** | Deletes are soft (`deleted_at`), producing tombstones | Deletions that cannot propagate to other devices |
| **R4** | Every syncable row carries `rev` and a local dirty marker | Being unable to distinguish "unchanged" from "newer than I last saw" |
| **R5** | All writes go through the repository trait in Rust | Non-atomic row-plus-outbox writes, which lose changes on crash |
| **R6** | No UI component ever touches SQLite or Supabase | A UI coupled to SQLite and unreplaceable when sync arrives |
| **R7** | Errors use the stable `AppError` shape with fixed codes | Error handling that breaks when the backend changes |
| **R8** | Migrations are forward-only, versioned, transactional | A device offline across a release being unable to start |
| **R9** | Everything derived is derived, never authoritative | Two devices deriving different values from the same document, permanently |

Cost of compliance: roughly 40 bytes per row of metadata v1 does not use yet,
plus a service layer written to own transactions. That is the insurance premium
on `docs/07-sync-plan.md`, which would otherwise cost a rewrite of the write path.

---

## 6. Repository layout

```
chayote/
├── README.md                  ← you are here; also the agent onboarding doc (§4)
├── LICENSE                    ← MIT
├── docs/                      ← specification, 11 documents
├── prototype/index.html       ← visual source of truth, permanent (ADR-016)
├── src/                       ← React frontend
├── src-tauri/                 ← Rust backend
└── package.json, vite.config.ts, tsconfig.json, src-tauri/Cargo.toml
```

The authoritative layout is `docs/10-conventions.md` §1. This is a summary.

## 7. Manual steps outstanding

**Install the Android toolchain.** Required before M7, and only M7. Details and
the exact commands are in `docs/11-verification.md` §3.5. M0–M6 and M8 are
unaffected.