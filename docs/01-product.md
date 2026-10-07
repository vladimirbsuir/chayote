# 01 — Product Specification

**Status:** Frozen. Last updated 2026-10-07.

---

## 1. Vision

A fast, quiet place to write. The app disappears while you type: no chrome, no modal dialogs in the writing path, no account prompt on first launch. It opens, your last note is there, you type, it saves.

The product's core promise is **speed to first keystroke**. Every feature that slows down launch, typing, or saving is suspect.

## 2. Positioning

| Aspect | Position |
|--------|----------|
| Category | Personal note-taking |
| Primary user | One person, their own device(s) |
| Deployment | Installable app, not a web page |
| Data ownership | Local file the user can find, back up, and delete |
| Price model | Free and open to modification (no accounts required to use v1) |

## 3. Competitive reference points

We are not trying to be Obsidian, Notion, or Bear. We take one trait from each and drop the rest.

| Take | From | What we keep | What we drop |
|------|------|--------------|--------------|
| Minimalism and writing focus | Bear | Two-pane layout, instant save, keyboard-first | Tagging complexity, export formats, themes |
| Structured rich text | Notion | Real WYSIWYG blocks, proper lists and quotes | Databases, embeds, pages-as-blocks, collaboration |
| Local-first ownership | Obsidian | Local SQLite file, no account required | Wiki links, graph view, plugins, YAML front-matter |

## 4. UX principles

These are ranked. When two principles conflict, the higher number wins.

1. **Zero interruption.** Nothing in the writing path steals focus, animates the caret, or asks a question the user did not initiate.
2. **Saved is the default.** There is no Save button. The document is on disk within a second of the last keystroke.
3. **Structure through the sidebar, not the document.** Folders, tags, and search live outside the text. The document body contains text and simple blocks only.
4. **Keyboard first, mouse always sufficient.** Every action has a shortcut, and every shortcut has a visible, discoverable control.
5. **Restraint over features.** A feature that cannot be justified against principle 1 in one sentence does not ship.
6. **Predictable data.** The user can delete the app and find their notes in a plain SQLite file with readable columns.
7. **Local means local.** No network calls in v1. Nothing works worse offline, because nothing depends on the network.

## 5. v1 scope — IN

Feature set agreed for the first shippable version.

### 5.1 Content

- WYSIWYG block editor based on ProseMirror.
- Text styles: bold, italic, strikethrough, inline code.
- Blocks: paragraph, H1–H3, bullet list, ordered list, task list, blockquote, code block, horizontal rule, hard break.
- Smart typography: automatic curly quotes, dashes, ellipses.
- Markdown input rules: `# `, `## `, `### `, `- `, `* `, `1. `, `> `, ` ``` `, `--- `.
- Paste from any source with HTML sanitisation.
- Title derived automatically from the first line of the note (no separate title field).

### 5.2 Organisation

- **Nested folders.** Unlimited depth, drag-and-drop reordering and re-parenting, reorderable sibling list.
- **Flat tags.** Free-form, case-insensitive unique names. A note may carry any number of tags and live in exactly one folder.
- **Pinning.** Boolean flag per note. Pinned notes sort above everything in the list, in every selection, with a filter view to show only them.
- **Trash.** Soft delete with restore and permanent delete.

### 5.3 Navigation and search

- **Full-text search** over titles and note bodies, SQLite FTS5, `bm25` ranking, matched-term highlighting in results.
- Search is scoped by the active filter (all / pinned / folder / tag) when one is set.
- Single selection model in the sidebar: exactly one of all, pinned, folder, tag, or trash is active at a time.
- **No manual note ordering.** The list sorts pinned first, then by modification date. Folders are manually reorderable; notes are not.

### 5.4 Interface

- Two-pane layout on desktop: sidebar (filters, folder tree, tags, note list) + editor.
- Single pane with stack navigation and push/pop transitions on Android.
- Themes: light, dark, system-following, with a configurable accent colour.
- Keyboard shortcuts for all primary actions.
- Resizable and collapsible sidebar on desktop.

### 5.5 Reliability

- Autosave with debounce and a guaranteed flush on blur, navigation, window close, and app background.
- No data loss on crash: every committed edit is durable before the next idle.
- Settings persisted in a JSON store, not in the notes database.

### 5.6 Platforms

- Desktop: Windows, macOS, Linux.
- Android: arm64 and armeabi-v7a, arm64 the priority device target.

## 6. v1 scope — OUT

Explicitly deferred. Listing these prevents scope drift and documents intent for later milestones.

| Deferred | Rationale | Planned for |
|----------|-----------|-------------|
| Cloud sync | Requires auth and conflict handling; must not delay the writing experience | Post-v1, see `07-sync-plan.md` |
| Real-time collaboration / CRDT | Multiplies editor complexity; not a personal-notes need | Not planned |
| Wiki links `[[..]]` and backlinks | Adds a parsing layer over the document model | v1.1 candidate |
| Slash command menu | Nice, but not required to write; input rules cover the common cases | v1.1 candidate |
| Tables | Rare in personal notes; bloats horizontal scrolling on mobile | v1.1 candidate |
| Images and file attachments | Requires asset storage, thumbnailing, and per-platform file pickers | v1.2 |
| Math / LaTeX | Same | Not planned |
| Command palette (Ctrl+K) | Real value at scale, but v1 keyboard shortcuts are sufficient | v1.1 candidate |
| Export to HTML / Markdown / PDF | Export formats in `04-editor.md` are specified but wiring is deferred | v1.2 |
| Note version history | Requires a revisions table; trash + sync conflicts cover most loss cases | v1.2 |
| Custom themes / user CSS | Breaks visual consistency guarantees | Not planned |
| Plugin system | Contradicts principle 5 | Not planned |
| iOS | Available in Tauri 2, but signing and distribution are a separate project | Not planned |
| Full-text search across more than the local device | Server search is part of the sync phase | Post-v1 |

## 7. Non-goals

1. **Not a team or shared tool.** No sharing, no permissions, no presence.
2. **Not a PKM graph tool.** No backlinks graph, no daily notes automation, no transclusion.
3. **Not a general document editor.** No print layout, no page styles, no headers/footers.
4. **Not an AI product.** No model integration, no assistant, no summarisation.
5. **Not a service.** No subscription, no telemetry, no crash reporting in v1.

## 8. Success criteria for v1

v1 is done when all of the following are true.

- Cold launch to editable caret in the last-opened note on a mid-range laptop, with a 50 MB warm database.
- Sustained typing with no input lag attributable to the app (frame budget: 16 ms).
- Every edit survives a hard process kill within 1.5 seconds of the last keystroke.
- Search returns results in under 50 ms for a 50 MB corpus, without a visible loading state.
- Full keyboard operation: a user can create, organise, find, edit, trash, and restore notes without touching the mouse.
- The app runs correctly on Android with the on-screen keyboard open, in portrait and landscape.
- Zero network requests in v1, verifiable with a proxy or by inspecting logs.

## 9. Terminology

| Term | Meaning |
|------|---------|
| Note | The unit of content. One ProseMirror document. |
| Document | The ProseMirror JSON tree. The only persisted content format. |
| Folder | A nested container. A note belongs to at most one folder. |
| Tag | A flat label. A note may have many tags. |
| Selection | The active sidebar filter determining which notes the list shows. |
| Pin | To mark a note so it sorts above all others in every selection. Not a star, not a colour. |
| Source of truth | The ProseMirror document. HTML and plain text are derived. |
| v1 / v1.1 / v1.2 | Release milestones as defined in §6 and `08-roadmap.md`. |