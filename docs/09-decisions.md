# 09 — Architecture Decision Log

**Status:** Active. Last updated 2026-10-07.

Format: context → decision → alternatives rejected with reasons → consequences. An ADR is superseded by a new entry, never edited in place, except to correct a factual error.

Status values: **Accepted** · **Superseded by ADR-NNN** · **Reversed**

| ADR | Subject | Status |
|-----|---------|--------|
| 001 | Application shell: Tauri 2 | Accepted |
| 002 | Document format: ProseMirror JSON | Accepted |
| 003 | Data access: `rusqlite` behind repository traits | Accepted |
| 004 | Search: FTS5 locally, `tsvector` remotely | Accepted |
| 005 | Sync direction: Supabase / Postgres | Accepted |
| 006 | Layout: two panes desktop, single pane mobile | Accepted |
| 007 | v1 feature set | Accepted |
| 008 | Styling: Tailwind v4 with CSS custom properties | Accepted |
| 009 | Native window decorations in v1 | Accepted |
| 010 | The nine sync-readiness rules | Accepted |
| 011 | Pinning replaces favourites; no manual note ordering | Accepted |
| 012 | Product name: Chayote, MIT licence | Accepted |
| 013 | A clickable HTML prototype precedes M0 | Accepted |
| 014 | First launch creates no folders or tags | Accepted |
| 015 | Icons are Lucide vectors; emoji are banned from the UI | Accepted |
| 016 | The prototype is a permanent visual reference, not a disposable mockup | Accepted |
| 017 | README.md is the agent onboarding document | Accepted |
| 018 | The frontend runs without Tauri, so the UI is testable in a browser | Accepted |
| 019 | The accent is per-theme; custom accents are used verbatim | Accepted |
| 020 | The Android back button is handled in Kotlin, and window insets in CSS | Accepted |
| 021 | Tags stay listed at a zero count; the sidebar creates them | Accepted |

---

## ADR-021 — Tags stay listed at a zero count; the sidebar creates them

**Status:** Accepted · **Date:** 2026-10-11

**Context.** Since M4 `tags_list` carried `HAVING count > 0`: a tag with no live
notes was hidden on both backends, and `05-ui-ux.md` §6.4 built on it — no add
control in the Tags section, because creating one there would appear to do
nothing, and the M8 removal of the dead `+` cited the same rule. The user
rejected the rule itself: hiding makes tags second-class — they cannot be
prepared before any note carries them — and "appears to do nothing" is a
property of the hiding, not of the button.

**Decision.** Zero-count tags stay listed with `count: 0`, on both backends, and
the Tags section regains its `+` with an inline create like the Folders
section's. Removing a tag from a note still never deletes the tag; deletion is
an explicit act from the tag's own row menu, confirmed with the note count.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Keep hiding, restore `+` anyway | Recreates the M8 defect verbatim: the new tag is invisible until a note carries it. |
| Show never-used tags but keep hiding all-trashed ones | Two rules where one sufficed, needing a second count to tell them apart; a tag whose notes are all trashed selects into the existing "No notes with this tag" state, which is already honest. |
| Show zero-count tags only in the picker, not the sidebar | Two visibilities for one library; the sidebar and the picker would disagree about what exists. |

**Consequences.**

- Unused tags accumulate until deleted; the row menu's Delete is the cleanup.
- The "No notes with this tag" empty state now also serves never-used tags, not
  just emptied ones.
- `03-data-model.md` §5 loses its `HAVING` clause; `05-ui-ux.md` §6.4 loses the
  no-add-control sentence and gains the menu; the `tag_counts_…` Rust test is
  rewritten around visibility rather than hiding.

---

## ADR-020 — The Android back button is handled in Kotlin, and window insets in CSS

**Status:** Accepted · **Date:** 2026-10-10

**Context.** M7 ran the runtime half on a physical device and found that the mobile
editor was wrong in four ways, none of them visible in a browser. Two of the four were
platform behaviour rather than styling, and both had a prescribed solution in the
specification that turned out to be unbuildable or misplaced.

`06-platform.md` §4.4 said: *"Implement with a Tauri back-button handler, not by
listening for `popstate`."* Tauri 2.12 has no such handler reachable from JavaScript:

- `AppPlugin.kt` registers a `back-button` event whose callback **replaces** its default
  — which is the behaviour §4.4 wants — but `hasListener()` reads `Plugin.kt`'s private
  Java map, populated only by the plugin's own `registerListener`. A JavaScript
  `listen()` goes through Rust's event system and never appears there.
- `Plugin.trigger()` sends only to those same Java channels, so a listener that did
  register would not receive the event either.
- `WryActivity.handleBackNavigation` is the other native hook. `TauriActivity` sets it
  `false`, and `true` installs wry's `goBack`-or-finish callback — never reaching the
  web layer.

Measured on the device with a JavaScript listener in place: the press fell through to
`webView.goBack()`, the WebView had no history, and back in the editor did nothing.

Separately, `enableEdgeToEdge()` in the generated `MainActivity` means the app draws
under the system status and navigation bars, and nothing consumed the insets.

**Decision.** Two different layers, for two different reasons.

**The back button is Kotlin**, in `MainActivity.onWebViewCreate` — the hook
`WryActivity.setWebView` calls once the real WebView exists, which is why it cannot be
done in `onCreate`. It evaluates one expression and, if the web layer did not consume
the press, disables itself and re-dispatches so `AppPlugin` applies the platform
default. The JS side is one function installed by `ipc.ts`; **it lives there because R6
makes that the only module permitted to touch the platform**, and a `window` property
assigned anywhere else would be a second path to it.

**Window insets are CSS** — `viewport-fit=cover` plus `env(safe-area-inset-*)` on
`#root`.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| `history.pushState` per view, driven by `popstate` | Pure JS and no generated code, but §4.4 rejects it explicitly and the rejection is right: popstate is unreliable under gesture navigation. The device runs the three-button nav bar, so this path would have passed here and failed on a gesture device — the worst possible outcome for a test that cannot see the difference. |
| A Tauri plugin in Rust registering `back-button` | `registerListener` is a plugin command, and `trigger` only reaches channels that plugin registered. Plausible, but it is a second event path for one button, and the activity already owns the back dispatcher. |
| A JS `popstate` listener *and* a Kotlin fallback | Two implementations of one rule, which is exactly how the pin reached two implementations and drifted. |
| Kotlin `WindowInsetsCompat` for the insets | Works, but `gen/android/` is generated code a Tauri version bump overwrites, and this is a layout concern the prototype already describes. CSS also keeps it inert on desktop, where the values are 0. |
| Removing `enableEdgeToEdge()` | One line, and it fixes this device — but edge-to-edge is *enforced* on Android 15+ for `targetSdk` 35+, so the defect returns on a newer phone. The CSS is future-proof. |

**Consequences.**

- §4.4 keeps its substance and loses its mechanism. The rule that survives is the one
  that was always the point: **back walks the view stack, and at the root the platform
  decides.** Whether the app can pop is a question for the web layer; whether the task
  backgrounds is not.
- The web layer returns "consumed" or not, so a root press needs no special case in
  Kotlin and no `exit` call. The app never decides when to quit.
- A handler that throws returns `false` rather than swallowing the press. A bridge
  that swallowed it would make back do nothing at all, which is the failure the whole
  path exists to remove.
- The insets live in `base.css` next to the rest of the token layer, and
  `viewport-fit=cover` is load-bearing rather than decorative: without it both `env()`
  values are `0` on Android and the rule silently does nothing.

**A note on what this cost.** Three of the four mobile defects were found by looking at
a real phone, and the fourth — the pin never reaching the list cache — had been wrong on
**desktop since M4** and was found only because the same code was exercised on Android.
No browser test could have caught it: the bug is that a cache was not invalidated, and
a cache is not rendered.

## ADR-001 — Application shell: Tauri 2

**Status:** Accepted · **Date:** 2026-10-07

**Context.** One codebase must ship a real desktop application on Windows, macOS, and Linux, plus a real Android application. The hardest requirement is a mature WYSIWYG editor, and the second is that neither platform should feel like a wrapped web page.

**Decision.** Tauri 2 (Rust) hosting a React 19 + TypeScript frontend.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Flutter | WYSIWYG editor maturity is the binding constraint. There is no ProseMirror equivalent; a Flutter rich-text package would mean building an editor on top of an editor. |
| Kotlin Multiplatform + Compose | Same editor problem, at a higher cost: Compose's rich-text story is a few experimental libraries. |
| Electron | 150 MB+ bundle, ~300 MB resident memory, and no Android story. |
| Web + Capacitor | Acceptable for Android, weak for desktop. Electron packaging on the desktop would reintroduce the cost we just rejected. |
| Native SwiftUI / WinUI | Two or three codebases. Not compatible with a single WYSIWYG editor implementation. |

**Consequences.** Rust is a required language for a first-class contributor. Bundle size stays around 10–20 MB. The WebView version is outside our control, so the frontend must target the oldest supported WebView as a *constraint* — though M6 dropped the obligation to *test* on it, see `06-platform.md` §1. Android release requires the NDK and a signing key.

---

## ADR-002 — Document format: ProseMirror JSON

**Status:** Accepted · **Date:** 2026-10-07

**Context.** The content model must survive sync, support structural conflict handling, and not be hostage to a rendering format.

**Decision.** The ProseMirror JSON tree is the single source of truth. HTML is generated on export and clipboard-out. Markdown is not stored.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| HTML as storage | Loses structure HTML cannot express. Round-tripping through a sanitiser on every sync merge is lossy. XSS surface on every read. |
| Markdown as storage | The rich text model is strictly more capable, and Markdown cannot represent the task list state, code block language, or heading structure without ambiguity. Round-tripping loses formatting. |
| CRDT (Yjs) | Correct merge semantics, but changes the storage model from a JSON document to an update log, which breaks FTS5 over `plain_text` and roughly doubles editor complexity. Revisit only if real-time collaboration becomes a requirement. |

**Consequences.** The schema in `04-editor.md` §1.2 is frozen; changing it is a migration affecting every note. `title` and `plain_text` are derived and must be recomputed deterministically so that any device can reproduce them (**R9**). Export formats are implemented on demand and are never a source of truth.

---

## ADR-003 — Data access: `rusqlite` behind repository traits

**Status:** Accepted · **Date:** 2026-10-07

**Context.** FTS5 must stay consistent with the notes table, derived columns must be atomic with the row write, and the storage layer must be replaceable when sync arrives.

**Decision.** `rusqlite` (bundled SQLite) in Rust. Traits `NotesRepo`, `FoldersRepo`, `TagsRepo`. The frontend calls Tauri commands and never sees SQL.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| `tauri-plugin-sql` for the app's data | Derived columns and the FTS index need multi-statement transactions. The frontend would hold the transaction, which pushes schema decisions into the UI. |
| `sqlx` | Async, but there are no concurrent queries worth the async complexity at this scale. `rusqlite` with a single connection behind a mutex is simpler. |
| Direct SQL from the frontend | No transaction control, no atomic outbox write, and schema leaks into components. The single change that would make sync hardest. |
| An ORM (Diesel, SeaORM) | Migrations and types are well served by hand-written SQL here. The schema is eleven tables. An ORM adds a layer with no leverage. |

**Consequences.** The remote implementation of each trait is a Supabase-backed struct. The trait is the seam that makes ADR-010 possible. Slight boilerplate cost, paid back once per entity type.

---

## ADR-004 — Search: FTS5 locally, `tsvector` remotely

**Status:** Accepted · **Date:** 2026-10-07

**Context.** Search must be instant and work offline. It will later also need to search across devices.

**Decision.** Local search uses SQLite FTS5 with `bm25` and external-content triggers. Remote search, in the sync phase, uses Postgres full-text search with `tsvector` and `ts_headline`.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Postgres full-text search locally | Not available. SQLite has no `tsvector` equivalent. |
| A search engine (Tantivy, Meilisearch) | A second persistence technology and an index to keep consistent with SQLite, for a 10 000 note corpus where FTS5 is already sub-50 ms. |
| `LIKE '%term%'` | Full table scan on every keystroke. Correctness is fine, performance is not. |
| One engine for both | Impossible. FTS5 does not exist in Postgres and `tsvector` does not exist in SQLite. |

**Consequences.** Two ranking implementations must be kept behaviourally consistent. The local one is authoritative for the offline experience; the remote one only widens the result set. Accepted asymmetry, documented in `03-data-model.md` §7.

---

## ADR-005 — Sync direction: Supabase / Postgres

**Status:** Accepted · **Date:** 2026-10-07

**Context.** Sync will arrive after v1. The architecture must accommodate it without an account gate in front of the writing experience.

**Decision.** Local-first. Sync is a later phase against Supabase (Postgres, Auth, RLS), with every v1 row carrying the fields it needs: client-generated UUIDv7, epoch-ms timestamps, `deleted_at`, `rev`, `dirty`, and an outbox.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Supabase from day one | Every read and write would depend on a network round trip, breaking principle 1 and the offline guarantee. |
| Self-hosted sync server | Full operational burden: hosting, TLS, backups, patching. Not the point of this project. |
| CouchDB / PouchDB | Correct replication, but a second persistence technology in a Rust-first app, with no natural Postgres host. |
| Firebase Firestore | Works, but a closed document model and no clean fit with a relational hierarchy of folders and tags. |

**Consequences.** v1 carries the cost of fields it does not yet use — roughly 40 bytes per row. v1 gains the freedom to ship without auth, and sync becomes additive rather than architectural.

---

## ADR-006 — Layout: two panes on desktop, single pane on mobile

**Status:** Accepted · **Date:** 2026-10-07

**Context.** The app is about writing. Chrome must not compete with text.

**Decision.** Two panes on desktop (sidebar 320 px + editor). Overlay drawer at 768–1023 px. Single pane with an in-app view stack below 768 px, driven by the Android back button.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Three panes (folders / list / editor) | Too tight at 13″. Folder and tag navigation collapse into one scrollable region inside the sidebar instead. |
| One pane with overlay lists | Maximum room for text, but navigation becomes a modal overlay, which costs a tap on every note switch. |
| Separate mobile app | Two codebases. Defeats ADR-001. |
| Editor-only, sidebar hidden by default | Nothing indicates a note exists. |

**Consequences.** The sidebar carries three stacked regions: filters, structure, list. It needs a fixed width and a max-height per region. The editor's readable column is capped at 720 px regardless of pane width.

---

## ADR-007 — v1 feature set

**Status:** Accepted · **Date:** 2026-10-07

**Context.** Feature requests accumulate. A personal notes app is judged on whether writing feels immediate, and every feature that touches the writing path is a tax on that.

**Decision.** v1 ships: nested folders, flat tags, pinning, trash, FTS5 search, light/dark/system themes, and the block set in `01-product.md` §5.1. Explicitly out: sync, wiki links, tables, images, attachments, slash menu, command palette, exports, version history, plugins.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Include attachments in v1 | Asset storage, thumbnailing, per-platform pickers, and Android storage permissions. Roughly 8 days, and it puts file-system failure modes in the writing path. |
| Include wiki links | Needs a reference index and a second parsing layer over the document. |
| Include the command palette | v1's shortcuts are sufficient; the palette earns its cost only past a certain number of actions. |
| Include syntax highlighting | Nice, but it pulls in a tokenizer and a second colour theme to maintain. |
| Include sync | See ADR-005. |

**Consequences.** v1 is roughly 24 days and ships a coherent, complete app. The full candidate queue with estimates is in `08-roadmap.md` §3, so nothing is lost by deferring.

## ADR-008 — Styling: Tailwind CSS v4 with CSS custom properties

**Status:** Accepted · **Date:** 2026-10-07

**Context.** Themes must switch instantly without a re-render, and both WebViews must render identically.

**Decision.** Tailwind v4 for layout and utilities. All colour, spacing, and type values live as CSS custom properties on `:root`, switched by `[data-theme]`. Tailwind tokens reference those variables.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| CSS Modules | No design-token discipline by default; easy to end up with one-off colours. |
| Plain CSS | Same problem, plus more boilerplate. |
| CSS-in-JS | Runtime cost in the editor's hot path, and a dependency to keep current. |
| Theme object in JS | Theme switching would re-render the ProseMirror subtree. CSS variables switch the theme with no re-render. |

**Consequences.** No raw colour literals in components. Adding a theme is a token block, not a code change. ProseMirror must be configured to consume the variables rather than emit its own colours — TipTap's default `class` attributes are stripped in `04-editor.md` §4.1, and the editor stylesheet reads the tokens.

---

## ADR-009 — Native window decorations in v1

**Status:** Accepted · **Date:** 2026-10-07

**Context.** A custom title bar looks more minimalist than a native one.

**Decision.** Keep native decorations. Custom title bar only if the user asks for it later.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| `decorations: false` plus a custom bar | Loses native window snapping on Windows, the macOS traffic-light conventions, and Wayland compatibility. Requires a drag-region implementation and per-OS layout work. |
| Native on desktop, hidden on Android | Android already has no decorations, so this is the status quo. |

**Consequences.** A few pixels of chrome the app does not draw. In exchange, window management works correctly on all three desktop platforms.

---

## ADR-010 — The nine sync-readiness rules

**Status:** Accepted · **Date:** 2026-10-07

**Context.** Sync arrives after v1 and will touch the schema, the write path, and the error contract. Retrofitting those is far more expensive than honouring them now.

**Decision.** Adopt the nine rules in `02-architecture.md` §6 as review criteria. The most consequential:

| Rule | Prevents |
|------|----------|
| R1 client-generated UUIDv7 | Server-assigned IDs, which would make offline creation a round trip and risk ID reuse after deletion |
| R2 UTC epoch ms | Device clock skew corrupting merge order |
| R3 soft deletes only | Deletions that cannot propagate to other devices |
| R4 `rev` plus `dirty` | No way to distinguish "unchanged" from "newer than I last saw" |
| R5 all writes via the repository | Non-atomic row + outbox writes, which lose changes on crash |
| R6 no storage access in UI | A UI coupled to SQLite, unreplaceable when sync arrives |
| R7 stable error codes | Error handling that breaks when the backend changes |
| R8 forward-only migrations | A device offline across a release being unable to start |
| R9 everything derived | Two devices deriving different values from the same document, permanently |

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Add sync-friendly fields later, in one migration | The rules are only cheap while the schema is small. Retrofitting atomic outbox writes into a service layer that was not designed for transactions is a rewrite. |
| Ignore sync readiness | The user has stated sync as a goal. Designing against it is the point. |

**Consequences.** Roughly 40 bytes per row of currently-unused metadata, plus a slightly more disciplined service layer. Cheap insurance. A reviewer must reject any change that breaks a rule; that is a review process, not a technical constraint, and it depends on whoever picks this up next knowing the rules exist.

---

## ADR-011 — Pinning replaces favourites; notes are not manually ordered

**Status:** Accepted · **Date:** 2026-10-07

**Context.** The draft schema had both `is_favorite` and `is_pinned` on `notes`, plus a `position` column intended for drag-reordering the note list. Three flags for two ideas, two of which overlap.

**Decision.** One flag, `is_pinned`. Pinned notes sort above everything in every selection, and a "Pinned" filter shows only them. `notes.position` is removed; the list sorts `is_pinned DESC, updated_at DESC`. Folders keep `position` and remain drag-reorderable.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Keep both flags | A user cannot explain the difference between "favourited" and "pinned" to themselves. Two filters over one mental model. `is_pinned` already means the more useful of the two. |
| Keep `is_favorite`, drop `is_pinned` | Favourites do not imply position. "Sort by date, but show my favourites at the top anyway" is the actual behaviour people want, and it is what pinning does. |
| Keep both, rename to "Star" and "Flag" | Naming two flags differently does not make them different. |
| Keep manual note ordering | Long-press drag versus scroll on Android, with no keyboard equivalent. See `03-data-model.md` §5.4 for the full reasoning. |
| Drop pinning entirely | Recency alone buries an important note within days. |

**Consequences.** Two columns removed from the schema, one IPC field renamed, three query clauses simplified. The note list has no drag interaction, which also removes a class of touch-conflict bugs. Folders are unaffected — the drag interaction there is already required for re-parenting, so ordering costs nothing extra.

---

## ADR-012 — Product name: Chayote; licence MIT

**Status:** Accepted · **Date:** 2026-10-07

**Context.** The product needed a name, a reverse-DNS identifier that cannot be changed after the Android keystore is generated, a database filename, and a licence.

**Decision.** Name **Chayote**, identifier **`com.chayote.app`**, database **`chayote.db`**, licence **MIT**.

| Reason | Detail |
|--------|--------|
| A chayote (*Sechium edule*) is a mild, faintly sweet, edible fruit, unusual rather than showy | Fits a product that stays out of the way |
| Reads identically in Spanish, Portuguese, English, and Russian transliteration | No per-market localisation of the name |
| Low visual identity | Matches the minimal design intent |
| Short enough for a window title bar and a 48 px launcher icon | No truncation anywhere it appears |
| Distinctive enough to remember, and to allow a `chayote.app` domain later | Leaves room for a public identity |

MIT was chosen over AGPL-3.0 because the intent is personal use with the option to publish later, and MIT places no obligation on that transition. MIT over an explicit public-domain dedication because an explicit grant is easier to rely on.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| `app.chayote` | Not a valid Android applicationId; Android requires at least two segments. |
| `com.chayote.notes` | Redundant. The app *is* Chayote; the identifier should not restate the category. |
| `com.vovab.chayote` | A personal identifier is hard to hand off. `com.chayote.app` is the better long-term brand. |
| AGPL-3.0 | Requires source disclosure for anyone who distributes a build, which is a decision the user has not made. |
| No licence | Legally ambiguous. Explicitly permissive is the safer default. |

**Consequences.** `com.chayote.app` is now frozen. Changing it later requires a new Android package name and a new macOS bundle ID — possible, but it invalidates every installed build and breaks update paths. Any future iOS release must reuse it exactly.

---

## ADR-013 — A clickable HTML prototype precedes M0

**Status:** Accepted · **Date:** 2026-10-07

**Context.** "Minimalist" is subjective and cannot be verified against a written specification. The colour tokens, spacing scale, and type scale in `05-ui-ux.md` §3 constrain the design but do not demonstrate it. Reviewing a real interface costs less than rewriting a component tree after it is built.

**Decision.** A single-file HTML prototype at `prototype/index.html`. Vanilla CSS with the real design tokens, no framework, no build step, no real editor. It covers the desktop layout, the Android layouts, both themes, a representative note list, the folder tree, the tag list, the editor with real content, the status bar, the empty states, and one dialog.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Skip the prototype, build M0-M6 and review at the end | Cheapest in calendar time, but design changes after M3 mean rewriting components rather than adjusting them. |
| Sketch tools (Figma) | Not in the toolchain, not diffable, and not runnable next to the specification. The prototype lives in the repo and stays accurate. |
| Full React prototype | Reuses nothing. A throwaway React app costs more to maintain than a throwaway HTML file and hides the tokens behind JSX. |
| Prototype only, no spec | Design without written rules drifts. The specification is the durable artefact. |

**Consequences.** Roughly 40 minutes of work. Anything in it that contradicts `05-ui-ux.md` is a bug in one or the other, and the disagreement is resolved by updating a document, per `10-conventions.md` §12. Its continued role as a visual reference is settled in ADR-016.

---

## ADR-014 — First launch creates no folders or tags

**Status:** Accepted · **Date:** 2026-10-07

**Context.** Notes apps commonly seed a default folder on first launch — "Notes", "Inbox", "Getting Started" — so the sidebar is not empty.

**Decision.** The first launch starts with an empty database: zero folders, zero tags, zero notes. The first note is unfiled. There is no onboarding tour and no first-run dialog.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Seed an "Inbox" or "Notes" folder | A folder the user did not create and did not ask for. It appears empty until they use it, and they will delete it. |
| Seed a welcome note explaining the app | Violates principle 1, zero interruption. The empty state in `05-ui-ux.md` §8 already says everything that matters. |
| First-run dialog asking for a preference | An account-style gate in front of a notes app. Rejected for the same reason sync is deferred (ADR-005). |
| Seed folder, marked as non-deletable | Worse: a permanent structure the user cannot remove. |

**Consequences.** The empty state must be genuinely good, because it is the first thing every user sees. The sidebar must handle zero folders without looking broken - the Folders and Tags sections collapse to their headers with an inline add affordance. `Q2` in `08-roadmap.md` §6 is closed by this decision.

---

## ADR-015 - Icons are Lucide vectors; emoji are banned from the UI

**Status:** Accepted · **Date:** 2026-10-07

**Context.** The UI prototype used emoji (a pin, a folder glyph) as a fast way to represent icons. The user rejected that and required vector icons throughout, from a unified set so the style stays consistent.

**Decision.** Lucide, via `lucide-react`, bundled at build time. 24 x 24 grid, stroke only, round caps and joins. Sizes are fixed at 16 / 18 / 20 / 24 px with stroke stepping 2 / 2 / 1.75 / 1.5. Icons inherit `currentColor`. The complete inventory is 22 icons, listed in `05-ui-ux.md` §3.3. **No emoji anywhere in the application UI** - not in empty states, not in error states, not in documentation diagrams.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Keep emoji | Rendering, metrics, colour, and meaning all vary by OS and by the user's font settings. A pin emoji looks different on Windows, macOS, and Android, can be missing in a WebView with an unusual font set, cannot inherit a theme colour, is unreadable at 12 px, and is announced by screen readers as its Unicode description. A polished application cannot ship on them. |
| Icon font (Font Awesome, Material Icons) | Requires a webfont fetch or a bundled font file, produces a flash of missing glyphs, breaks under a strict CSP, and weighs more than the ~22 inline SVGs actually needed. |
| Material Symbols / Material Icons | The filled style conflicts with an outline-based minimal UI, and its variable-font machinery is heavier than needed. |
| Heroicons | Equivalent quality and licence. Rejected only because Lucide's optical weight sits slightly lighter, closer to this design. |
| Tabler Icons | Also equivalent. Same reason - Lucide was the reference set while building the prototype. |
| Hand-drawn one-off SVGs | No shared grid, no shared stroke weight, no shared corner radius. The result reads as assembled rather than designed, which is the exact problem a unified set exists to solve. |

**Consequences.**

- `lucide-react` becomes a frontend dependency (`02-architecture.md` §1.1), imported per-icon so Vite tree-shakes it. No barrel-namespace imports.
- The offline guarantee in `06-platform.md` §1 now covers assets: no font, sprite-sheet, or icon CDN request at startup. Icons are compiled into the bundle.
- The four size classes are a constraint. A fifth size is a design decision requiring an ADR amendment, not a per-callsite choice.
- Stroke width decreasing with size is the detail that makes the set feel coherent. A constant 2 px stroke reads heavy at 24 px and hairline at 16 px.
- `05-ui-ux.md` §3.3 holds the closed inventory. Adding an icon to the UI means adding it there first, which keeps the total small and prevents a slow drift toward a generic icon dump.
- The prototype inlines Lucide paths as `<symbol>` elements to stay a single file with no network. That is a prototype convenience; the app renders React components.

---

## ADR-016 - The prototype is a permanent visual reference, not a disposable mockup

**Status:** Accepted · **Date:** 2026-10-07

**Context.** ADR-013 originally described the prototype as a review tool to be deleted after M3. On seeing it, the user made the opposite assessment: it is the thing an AI or a new contributor should look at when building UI, because it demonstrates "minimalist" far better than the token tables and ASCII wireframes can.

**Decision.** `prototype/index.html` is kept in the repository for the life of the project and is treated as the **visual source of truth**. It sits alongside `docs/05-ui-ux.md`, which remains the written source of truth for rules.

The two have different jobs and neither is derived from the other:

| Artefact | Authority over |
|----------|-----------------|
| `prototype/index.html` | How it looks. Colour, spacing, type, icon size and weight, density, proportion. |
| `docs/05-ui-ux.md` | Why it is that way. Rules, constraints, rationale, interaction behaviour, accessibility. |

When building a component, copy the visual values from the prototype and the behaviour from `05-ui-ux.md`. When they disagree, the prototype is correct for appearance and the document is correct for behaviour, so the disagreement is resolved by fixing whichever one is actually wrong — never by silently ignoring either.

The prototype is a single file with no build step, no framework, and no network access. It opens by double-clicking.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Delete after M3, as ADR-013 originally said | Loses the only artefact that shows what "minimalist" means here. A contributor reading the documents alone would rebuild something competent and subtly wrong. |
| Convert the prototype into the real app | Then it stops being a reference and becomes code that was never reviewed. The value is precisely that it is not the implementation. |
| Keep it as an image or a screenshot | Not diffable, not reviewable in a pull request, goes stale the moment a token changes. |
| Keep it and let it drift freely | A stale reference is worse than none. Drift is the failure mode this ADR exists to prevent. |

**Consequences.**

- Every change to tokens, icon sizes, layout metrics, or copy in `docs/05-ui-ux.md` must be mirrored in `prototype/index.html` in the same change, and vice versa. This is the `10-conventions.md` §12 documentation rule extended to the prototype.
- The prototype stays dependency-free. Adding a build step, a framework, or a CSS import to it destroys the property that makes it useful: it opens anywhere, forever, with nothing installed.
- It shows representative content, not every state. Empty states, one dialog, and both platforms are covered; the full component set is not, and grows as components are built.
- It will fall behind the implementation. That is expected. When a component lands, the prototype is updated to match reality — not the other way around. A prototype that blocks a good implementation decision is the wrong kind of reference.

---

## ADR-017 - README.md is the agent onboarding document

**Status:** Accepted · **Date:** 2026-10-07

**Context.** Sessions end when context fills or attention shifts, and a new session starts with none of that. The specification had to survive the handoff. The first attempt put a 25-line copy-paste prompt into README.md §4 instructing the agent to read README.md and the ten documents — text sitting inside the very file it told the agent to read.

**Decision.** README.md is itself the onboarding document. It opens with the project state, the frozen decisions, and a section (§4.1) that instructs any agent reading it to read the remaining documents, read the prototype, determine the current milestone, present a plan, and stop. The user's only input is the folder path, which a session cannot discover on its own:

```
Chayote. D:\Projects\chayote - read README.md and follow it.
```

The one thing no session can infer is where the repository is, because the session may open anywhere. That single fact is all the prompt needs to carry.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Long copy-paste prompt | Duplicates what the file already says, inside the file being read. Two copies drift apart, and the reader pays for both. |
| Bare "привет, прочитай документы" | Fails in three predictable ways: skips the prototype, re-proposes decided choices, rebuilds the UI from the ASCII diagrams. `README.md` §4.3 tabulates them. |
| External file such as `PROMPT.md` or a wiki page | A new artefact to keep in sync, and one more thing a session must be told about. The README is read regardless of context. |
| Rely on the agent discovering the repository | It cannot if the session opened elsewhere. |
| Exporting the full transcript between sessions | Does not compose with a context budget, and reintroduces exactly the staleness the documents exist to prevent. |

**Consequences.**

- The cost of a cold start is one line of user input and one file read. Every other instruction is in the file, so it cannot be forgotten and cannot go stale.
- README.md carries a second audience. It must stay short enough that a human skimming it is not bored, which is why §1 and §3 are tables of pointers rather than restatements. The reasoning lives once, in `docs/`.
- §4.1 ends with "state the plan and wait for confirmation." The agent proposes, the human approves. Autonomy is not granted implicitly.
- The document set is now load-bearing for the workflow, not only for the design. Editing them carelessly degrades the handoff, which raises the bar for changing them — which `10-conventions.md` §12 already required.
- The prototype is load-bearing in a second way, beyond visual reference: it is step 2 of onboarding, and skipping it is the most common failure mode.

---

## ADR-018 - The frontend runs without Tauri, so the UI is testable in a browser

**Status:** Accepted · **Date:** 2026-10-07

**Context.** The user wants an agent that can check its own work rather than asking a human to open the app at every step. A Tauri window cannot be driven by Playwright - it is a native window, not a page. Naively that would mean every UI change waits for human review, which is the failure mode this project is trying to avoid.

**Decision.** The frontend must run standalone in a browser. All IPC goes through one module, `src/lib/ipc.ts`, which detects the Tauri runtime and falls back to a mock adapter backed by in-memory fixtures when it is absent.

```ts
const isTauri = '__TAURI_INTERNALS__' in window
export const ipc = isTauri ? tauriAdapter : mockAdapter
```

`mockAdapter` implements the same command names as `02-architecture.md` §7, seeded with realistic fixture data — nested folders, ~10 000 generated notes for scroll testing, both themes, notes with and without tags.

**Consequences.**

- Playwright drives the real component tree at every breakpoint in both themes. Layout, focus, keyboard navigation, empty states, and full user flows become automated checks rather than human inspections.
- R6 is enforced structurally, not by convention: one module owns IPC, so the frontend cannot accidentally grow a second path to storage.
- The mock must not leak into production. The `isTauri` branch is the only environment check, and a build without Tauri should fail loudly rather than silently ship a mock.
- `docs/11-verification.md` §3.4 covers the complementary case: native capture of the real window for IPC and database behaviour that a browser cannot prove.
- Android remains unverifiable until the SDK is installed, because there is no equivalent trick for a native WebView. This is stated plainly rather than worked around.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| Human reviews every UI change | The user's attention is the scarcest resource in the process. Spend it on judgement, not on regression hunting. |
| Playwright against the packaged app via WebDriver | Tauri WebDriver support requires `tauri-driver`, is Linux-centric, and adds a JVM dependency for a benefit the mock already provides. |
| Test only React logic, never layout | Layout bugs are exactly what a visual test catches and what unit tests miss. |
| Screenshot the native window only | Requires a display, cannot run headless in CI, and is far slower than a browser test. |
| Stub IPC in tests only, not in dev | Duplicates the adapter and leaves `npm run dev` broken in a browser, so the mock would rot untested. |

---

## ADR-019 - The accent is per-theme; a custom accent is used verbatim

**Status:** Accepted · **Date:** 2026-10-10

**Context.** M6 found a defect that had been present since M3. `applyAccent` wrote `--accent` as an inline custom property on `document.documentElement` — the same element that carries `data-theme` — so the value it wrote beat the `[data-theme='dark']` block whatever its specificity. The dark theme's accent was unreachable, and every user, on the default settings, saw the light accent on a dark surface. `05-ui-ux.md` §3.1 and `prototype/index.html` both defined a dark accent, so the code was wrong rather than the documents.

Fixing the cascade exposed the question it had been hiding. The accent is used as *text* on the active folder and tag rows, so it needs 4.5:1 against the surface behind it. Measuring the six presets settled it: **no single value holds 4.5:1 against both themes.** In the light theme alone, Default was 4.25 against `--surface-raised` and Violet was 4.23 — so the sentence in §6.6 claiming the presets each held 4.5:1 against both surfaces was false as written, before dark was considered at all. In the dark theme the same six ranged from 4.27 down to 2.71.

**Decision.** Each preset carries a value per theme, in `--accent-preset-1` … `--accent-preset-6`, redefined by the `[data-theme='dark']` block. `--accent` resolves from preset 1 and nothing writes it inline unless the user has chosen a colour of their own. Each value is its hue at the lightness that clears 4.5:1 against its own theme's `--surface-raised`, adjusted in HSL so hue and saturation are unchanged.

**Alternatives rejected.**

| Option | Rejected because |
|--------|------------------|
| One accent value in both themes | Fails 4.5:1 in one of them. Every option here is a way of not having to choose; the measurement is the reason this one is gone. |
| Derive the dark value from the hue at runtime | Correct for arbitrary custom colours, and it puts colour maths plus a second rendering of the same colour in the app, to serve a control that is by definition off the preset list. The dialog instead shows a custom colour's measured ratio and warns below 4.5:1. |
| Keep the single value and exempt the accent from the contrast rule | Makes active-row text 2.7:1 for Magenta in dark. §10 says colour is never the only signal, and here the colour is also the only label. |
| Curate twelve values and stop there, leaving custom unaddressed | Leaves the one input that can fail the bar unexplained. The warning is what makes "used verbatim" an honest default rather than a gap. |

**Consequences.**

- Four of the six light values are the reviewed palette unchanged; Default and Violet move. The prototype was updated in the same commit (ADR-016).
- The dark default moves from `#6f9bff` to `#4881ef`, because the old value was chosen for feel rather than measured against the raised surface, and the six now share one rule.
- A stored accent equal to any current *or retired* preset value reads back as "the default", so a settings file written before M6 does not silently become a custom accent and reintroduce the bug.
- `src/styles/tokens.test.ts` asserts the ratio over both token tables. That test is what makes the §6.6 table a fact rather than a claim, and it is the automated contrast check M6's "Done when" requires.
- The rule is one sentence and one number, which is the point: the previous rule was one sentence and one wrong number.
