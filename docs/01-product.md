# 01 — Product Specification

**Status:** Frozen. Last updated 2026-10-07.

---

## 1. Vision

A fast, quiet place to write. The app disappears while you type: no chrome, no modal dialogs in the writing path, no account prompt on first launch. It opens, your last note is there, you type, it saves.

## 2. Positioning

| Aspect | Position |
|--------|----------|
| Category | Personal note-taking |
| Primary user | One person, their own device(s) |
| Deployment | Installable app |
| Data ownership | Local file the user can find, back up, and delete |
| Price model | Free and open to modification (no accounts required to use) |

## 3. UX principles

These are ranked. When two principles conflict, the higher number wins.

1. **Zero interruption.** Nothing in the writing path steals focus, animates the caret, or asks a question the user did not initiate.
2. **Saved is the default.** There is no Save button. The document is on disk within a second of the last keystroke.
3. **Structure through the sidebar, not the document.** Folders, tags, and search live outside the text. The document body contains text and simple blocks only.
4. **Keyboard first, mouse always sufficient.** Every action has a shortcut, and every shortcut has a visible, discoverable control.
5. **Restraint over features.** A feature that cannot be justified against principle 1 in one sentence does not ship.
6. **Predictable data.** The user can delete the app and find their notes in a plain SQLite file with readable columns.
7. **Local means local.** No network calls in v1. Nothing works worse offline, because nothing depends on the network.

## 4. v1 scope — IN

Feature set agreed for the first shippable version.

### 4.1 Content

- WYSIWYG block editor based on ProseMirror.
- Text styles: bold, italic, strikethrough, inline code.
- Blocks: paragraph, H1–H3, bullet list, ordered list, task list, blockquote, code block, horizontal rule, hard break.
- Smart typography: automatic curly quotes, dashes, ellipses.
- Markdown input rules: `# `, `## `, `### `, `- `, `* `, `1. `, `> `, ` ``` `, `--- `.
- Paste from any source with HTML sanitisation.
- **A title field of its own** above the text, with the note's last-changed date beneath it, in the reader's own date format (ADR-023). Left blank, the title is derived from the first line of the body exactly as before, so a note that is never named still gets a sensible name in the list.

### 4.2 Organisation

- **Nested folders.** Unlimited depth, drag-and-drop reordering and re-parenting, reorderable sibling list.
- **Flat tags.** Free-form, case-insensitive unique names. A note may carry any number of tags and live in exactly one folder.
- **Pinning.** Boolean flag per note. Pinned notes sort above everything in the list, in every selection, with a filter view to show only them.
- **Trash.** Soft delete with restore and permanent delete.

### 4.3 Navigation and search

- **Full-text search** over titles and note bodies, SQLite FTS5, `bm25` ranking, matched-term highlighting in results.
- Search is scoped by the active filter (all / pinned / folder / tag) when one is set.
- Single selection model in the sidebar: exactly one of all, pinned, folder, tag, or trash is active at a time.
- **No manual note ordering.** The list sorts pinned first, then by modification date. Folders are manually reorderable; notes are not.

### 4.4 Interface

- Two-pane layout on desktop: sidebar (filters, folder tree, tags, note list) + editor.
- Single pane with stack navigation and push/pop transitions on Android.
- Themes: light, dark, system-following, with a configurable accent colour.
- Keyboard shortcuts for all primary actions.
- Resizable and collapsible sidebar on desktop.

### 4.5 Reliability

- Autosave with debounce and a guaranteed flush on blur, navigation, window close, and app background.
- No data loss on crash: every committed edit is durable before the next idle.
- Settings persisted in a JSON store, not in the notes database.

### 4.6 Platforms

- Desktop: Windows, macOS, Linux.
- Android: arm64 and armeabi-v7a, arm64 the priority device target.

## 5. Non-goals

1. **Not a team or shared tool.** No sharing, no permissions, no presence.
2. **Not a PKM graph tool.** No backlinks graph, no daily notes automation, no transclusion.
3. **Not a general document editor.** No print layout, no page styles, no headers/footers.
4. **Not an AI product.** No model integration, no assistant, no summarisation.
5. **Not a service.** No subscription, no telemetry, no crash reporting in v1.

## 6. Success criteria for v1

v1 is done when all of the following are true.

- Cold launch to editable caret in the last-opened note on a mid-range laptop, with a 50 MB warm database.
- Sustained typing with no input lag attributable to the app (frame budget: 16 ms).
- Every edit survives a hard process kill within 1.5 seconds of the last keystroke.
- Search returns results in under 50 ms for a 50 MB corpus, without a visible loading state.
- Full keyboard operation: a user can create, organise, find, edit, trash, and restore notes without touching the mouse.
- The app runs correctly on Android with the on-screen keyboard open, in portrait and landscape.