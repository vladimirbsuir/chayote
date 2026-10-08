# 05 — UI & UX Specification

**Status:** Frozen. Last updated 2026-10-07.

---

## 1. Design intent

Minimalist does not mean sparse. It means **nothing present that is not currently doing work**. A screen with fewer elements is easier to make obvious, but an empty screen that hides structure is harder to use than a slightly denser one.

The concrete consequence: no decoration, no gradients, no shadows for depth, no icons where a word is clearer. Hierarchy comes from spacing, weight, and a neutral palette.

## 2. Layout

### 2.1 Desktop (≥ 1024 px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Chayote     [icon-search Search notes…         ]      [+] [sun] [···] │  52 px
├────────────────────────────┬─────────────────────────────────────────┤
│  All   [pin] Pinned         │                                         │
│  ──────────────────────    │   Meeting notes                          │
│  [folder] Folders      [+]  │                                         │
│    ▸ [folder] Work          │   Discussed the launch date with the    │
│       [folder] Projects     │   team. Action items below.              │
│       [folder] Personal     │                                         │
│    ▸ [folder] Reading       │   ☐ Draft the announcement              │
│  ──────────────────────    │   ☐ Prepare the demo build              │
│  [hash] Tags            [+] │                                         │
│    [hash] work      14       │                                         │
│    [hash] ideas      3       │                                         │
│  ──────────────────────    │                                         │
│  12 notes                  │                                         │
│  ┌──────────────────────┐  │                                         │
│  │ [pin] Meeting notes  │  │                                         │
│  │ Discussed the launch…│  │  ← note list (virtualised)              │
│  │ 2 min ago            │  │                                         │
│  ├──────────────────────┤  │                                         │
│  │ Reading list         │  │                                         │
│  │ Books for the quarte…│  │                                         │
│  │ yesterday            │  │                                         │
│  └──────────────────────┘  │                                         │
├────────────────────────────┴─────────────────────────────────────────┤
│  Personal · #work #ideas                          342 words  Saved   │  28 px
└──────────────────────────────────────────────────────────────────────┘
     320 px                        flex                          max 720 px
```

`[folder]`, `[pin]`, `[hash]` denote icons, per §3.3. The 720 px editor column is the readable measure; the pane itself is fluid.

The sidebar is three stacked regions, not three columns. Filters, then structure, then the list, separated by hairlines. Only one is interactive at a time.

### 2.2 Sidebar anatomy

| Region | Height | Content | Behaviour |
|--------|--------|---------|-----------|
| Filters | auto | All notes, Pinned | Segmented control |
| Folders | max 40 % of pane, scroll | Tree | Collapsible, drag to re-parent and reorder |
| Tags | max 25 % of pane, scroll | Flat list with counts | Collapsible |
| List header | 32 px | Active selection name + count | |
| Note list | remainder | Virtualised cards | Click to open, right-click for menu |

### 2.3 Tablet (768–1023 px)

Sidebar overlays the editor as a drawer, 320 px, with a scrim. `Esc` or scrim tap closes it. Toggle in the top bar. The editor goes full width.

### 2.4 Android (< 768 px)

Single pane. One view visible at a time; navigation pushes a view onto an in-app stack.

```
  Desktop layout      Android: list view         Android: editor view
┌─────────┬────────┐  ┌──────────────────────┐   ┌──────────────────────┐
│ sidebar │ editor │  │[menu] Chayote    [+] │   │[back] Chayote    [···]│
└─────────┴────────┘  │[search] Search…      │   │                      │
                      │ All   [pin] Pinned    │   │  Meeting notes       │
                      │ [folder] Folders      │   │                      │
                      │ 12 notes              │   │  Discussed the…      │
                      │ [note list]           │   │                      │
                      └──────────────────────┘   │  ☐ Draft…            │
                                                   │                      │
                                                   │  Personal #work     │
                                                   │  342 w  Saved       │
                                                   └──────────────────────┘
```

Back behaviour: the Android system back button pops the view stack. At the root it moves the task to the background. The list → editor transition is a horizontal slide matching the platform convention.

The editor view has its own top bar because it needs a back affordance, the note title, and a delete action. It does not reuse the desktop top bar.

### 2.5 Editor measure

Body text is constrained to a 720 px column, centred in the editor pane, with 32 px minimum padding. This is a deliberate readability limit. ProseMirror's default `white-space: pre-wrap` plus `word-break: break-word` handles long unbroken strings and long words without horizontal scrolling.

## 3. Design tokens

CSS custom properties on `:root`, overridden by `[data-theme='dark']`. Tailwind utilities map to these; no raw colour values in components.

### 3.1 Colour

Light:

| Token | Value | Use |
|-------|-------|-----|
| `--surface` | `#ffffff` | App background |
| `--surface-raised` | `#f7f7f8` | Sidebar, status bar, list hover |
| `--surface-sunken` | `#ededef` | Inset areas, code blocks |
| `--border` | `#e3e3e6` | Hairlines |
| `--border-strong` | `#c9c9cf` | Input borders |
| `--text` | `#18181b` | Primary |
| `--text-muted` | `#6b6b76` | Secondary, timestamps |
| `--text-subtle` | `#9a9aa4` | Placeholders |
| `--accent` | user-configurable, default `#2f6fed` | Selection, focus ring, active state |
| `--accent-soft` | accent at 12 % | Active row background |
| `--danger` | `#c0392b` | Delete, error |
| `--warning` | `#b26a00` | Unsaved state |
| `--success` | `#1f7a4d` | Saved state |

Dark:

| Token | Value |
|-------|-------|
| `--surface` | `#161618` |
| `--surface-raised` | `#1d1d20` |
| `--surface-sunken` | `#101012` |
| `--border` | `#2a2a2f` |
| `--border-strong` | `#3d3d44` |
| `--text` | `#ececef` |
| `--text-muted` | `#9b9ba4` |
| `--text-subtle` | `#6e6e78` |

Rules: the dark palette is not a mechanical inversion — contrast is verified per theme. Text on `--surface` must reach 7:1 and on `--surface-raised` 4.5:1. Focus rings use `--accent` at 2 px with a 2 px offset and must be visible in both themes. No colour carries meaning alone; the accent never appears as the sole indicator of state.

### 3.2 Spacing, radius, type

| Token | Scale |
|-------|-------|
| Spacing | 4 / 8 / 12 / 16 / 20 / 24 / 32 px |
| Radius | 6 px (inputs, list items) · 10 px (cards, modals) · 999 px (pills) |
| Shadows | None. Depth comes from `--surface` elevation. One exception: modals and popovers get `0 8px 24px rgb(0 0 0 / 0.12)` |

| Role | Size / weight / line height |
|-------|---------------------------|
| Editor body | 17 px · 400 · 1.7 |
| Editor H1 | 28 px · 650 · 1.25 |
| Editor H2 | 22 px · 600 · 1.3 |
| Editor H3 | 19 px · 600 · 1.4 |
| Note list title | 14 px · 550 · 1.4 |
| Note list excerpt | 13 px · 400 · 1.45, two lines, ellipsis |
| Note list timestamp | 12 px · 400 · 1.3 |
| UI label | 13 px · 500 |
| Sidebar section header | 11 px · 600, uppercase, 0.06 em tracking |

Font: `Inter` bundled locally via `@fontsource`, falling back to the system UI stack. Bundling avoids a network fetch and a FOUT. Code blocks use `ui-monospace, SFMono-Regular, Menlo, monospace` at 15 px.

### 3.3 Icons

**No emoji in the application UI. Ever.** Icons are vector only. This is recorded as ADR-015.

#### Icon set

**Lucide**, via `lucide-react`. MIT licensed, 24 × 24 grid, 2 px stroke, round caps and joins, ~1 500 icons, tree-shakeable so the bundle only contains what is imported.

Alternatives considered are in ADR-015. In short: not an icon *font* (a font request at startup, FOUT, and it breaks under a restrictive CSP), not Material Symbols (filled style, does not match the outline aesthetic), not Heroicons or Tabler (also fine, Lucide's geometry is the closest to the neutral, unfussy look here).

#### Size scale

| Class | Size | Stroke | Used for |
|-------|------|--------|----------|
| `.i-16` | 16 px | 2 | Inline in text, tag chips, tree rows, small indicators |
| `.i-18` | 18 px | 2 | Buttons and controls, search fields |
| `.i-20` | 20 px | 1.75 | Top bar actions, section headers, empty-state headings |
| `.i-24` | 24 px | 1.5 | Mobile top bar only |

Stroke **decreases** as size increases. A constant 2 px stroke looks heavy at 24 px and hairline at 16 px; stepping the weight keeps the perceived density uniform, which is what makes an icon set feel designed rather than assembled.

Four sizes only. Not a free-form `size` prop. A fifth size is a design decision, not a per-callsite choice.

#### Colour and fill

- Icons are `fill: none; stroke: currentColor` and inherit text colour. **Never** a hard-coded colour value.
- Icons are never the only signal. A pinned note shows a pin icon *and* sorts first. An error shows an icon *and* text. This is also the accessibility requirement in §10.
- `fill: currentColor` is permitted for one exception: the checked task-list box, where a filled state reads faster than an outline at 12 px.

#### Inventory

Every icon used in v1, and nothing else. Adding an icon to the UI means adding it here first.

| Lucide name | Purpose |
|-------------|---------|
| `search` | Search field, search empty state |
| `file-plus` | New note (top bar, empty states) |
| `plus` | New folder, new tag |
| `pin` | Pinned indicator, Pinned filter, pinned empty state |
| `folder` | Folder rows, folder section header, Folders filter chip |
| `hash` | Tag rows, tag chips, Tags section header |
| `trash` | Trash selection, trash empty state, permanent delete |
| `sun` | Light theme |
| `moon` | Dark theme |
| `monitor` | System theme |
| `menu` | Android sidebar toggle |
| `arrow-left` | Android back |
| `chevron-down` | Expanded tree branch, collapsed section header |
| `chevron-right` | Collapsed tree branch |
| `more-horizontal` | Overflow menus |
| `settings` | Settings dialog |
| `palette` | Accent colour control |
| `check` | Checked task list item |
| `x` | Clear search, dismiss |
| `alert-circle` | Error and warning states |
| `rotate-cw` | Retry a failed save, reset settings |
| `inbox` | Empty state for a selection with no notes |

#### Bundle and rendering

- Icons are **bundled at build time**, never fetched at runtime. The offline guarantee in `06-platform.md` §1 extends to assets: no font, sprite sheet, or icon CDN request at startup.
- Rendered as React components from `lucide-react`, imported individually — `import { Search } from 'lucide-react'` is tree-shaken by Vite. Do not import the barrel namespace.
- All icon components must set `aria-hidden="true"`, since the accompanying text already carries the meaning. An icon-only button gets `aria-label` instead.
- Prototype only: `prototype/index.html` inlines the Lucide paths as `<symbol>` elements so the file stays single and self-contained. That is a prototype convenience, not the app pattern.

#### Spacing around icons

Icons sit on a 2 px optical gap from adjacent text and are vertically centred with the text baseline, not the box. An icon in a button is centred in its hit area; the hit area is 32 × 32 on desktop and at least 44 × 44 on Android.

## 4. Components

| Component | Responsibility |
|-----------|----------------|
| `TopBar` | Search field, new note, theme toggle, overflow menu. Present on desktop; variant `Mobile` on Android list. |
| `Sidebar` | Filters, `FolderTree`, `TagList`, `NoteList`. Owns selection state. |
| `FolderTree` | Recursive tree. Keyboard navigable. Drag to re-parent and reorder. |
| `TagList` | Flat list with counts. Inline rename on double-click. |
| `NoteList` | Virtualised list. Renders `NoteSummary`, never loads full documents. |
| `NoteCard` | Title, excerpt, timestamp, pinned indicator. Optional folder name when the selection is All or Pinned. |
| `EditorPane` | Owns the TipTap instance, autosave state machine, status bar. |
| `EditorStatusBar` | Folder, tags, word count, save state (`04-editor.md` §9). |
| `TagEditor` | Popover for adding and removing tags on the current note. |
| `FolderPicker` | Popover for changing a note's folder. |
| `ConfirmDialog` | Destructive confirmation only. Used by permanent delete and empty trash. Never for save or navigation. |
| `ThemeToggle` | Light / Dark / System cycle. |
| `SettingsDialog` | Theme, accent, default folder, reset. |
| `SearchEmpty`, `NoteListEmpty` | Empty states (§8). |

Icons are never components of their own. They are imported from `lucide-react` at the point of use, sized by the `.i-*` classes in §3.3, and wrapped only when a control needs a hit area — `IconButton`, which renders an icon plus an optional `aria-label` and enforces the 32/44 px minimum. There is no `AppIcon.tsx` indirection.

## 5. Navigation model

Single source of truth in Zustand: `selection: { kind, id }`.

| `kind` | Notes shown |
|--------|-------------|
| `all` | Every live note |
| `pinned` | `is_pinned = 1` |
| `folder` | Notes whose `folder_id` matches, **excluding** the subtree |
| `tag` | Notes carrying the tag |
| `trash` | Soft-deleted notes |

Ordering within every selection except `trash` is `is_pinned DESC, updated_at DESC`. **The note list is not manually reorderable in v1** — there is no drag interaction and no `position` column (`09-decisions.md` ADR-011, reasoning in `03-data-model.md` §5.4). Folder drag-reordering *is* implemented, because the same drag gesture already exists there for re-parenting.

A note open in the editor that is removed from the current selection keeps rendering until the user acts. Switching selection does not move focus or selection in the open note. Closing the editor is a separate explicit action.

Selecting a folder in the tree is exclusive with selecting a tag or filter: exactly one selection at a time. A subtree toggle on a folder controls whether its children are visible in the tree; it does not change the selection.

Deep links (`notes://note/<uuid>`) are out of scope for v1 but reserved: note IDs being stable and globally unique means they can be added later without a schema change.

## 6. Behaviour specifications

### 6.1 New note

`+`, or `Ctrl/Cmd+N`. Creates an untitled note, opens it, focuses the editor caret. Never prompts.

The new note's folder is resolved in this order:

1. The current selection, if it is a folder.
2. The configured default folder, if one is set.
3. Unfiled (`folder_id IS NULL`).

**On first launch there is no default folder and nothing is pre-created.** The database starts with zero folders and zero tags; the first note is unfiled. Creating a seed folder such as "Notes" or "Inbox" was considered and rejected: it is a decision made on the user's behalf, it shows up as an empty folder they must delete, and the sidebar already handles an empty structure without it.

### 6.2 Delete and restore

Delete moves the note to trash with an **undo toast** for 6 seconds offering "Undo". The soft delete is already persisted; undo simply restores. Permanent delete and empty trash require `ConfirmDialog`.

### 6.3 Folders

Creating a folder is inline: a single text input in place, `Enter` commits, `Esc` cancels, empty input cancels. Renaming is the same. Deleting a folder with children requires confirmation naming the count. Reordering and re-parenting by drag; `position` values are densified in one transaction (`03-data-model.md` §3.2).

**Folder tree collapse state is persisted per folder** in the settings store, so a collapsed branch stays collapsed across launches. On touch, long-press initiates a folder drag; otherwise the gesture scrolls.

### 6.3a Pinning

`Ctrl/Cmd+D`, or the pin control on a note card and in the editor. Toggling is optimistic in the UI and reconciled by the command response. Pinned notes sort above every other note in every selection, and a pinned indicator appears on the card. The `Pinned` filter shows only pinned notes, combined with the active folder or tag when one is set.

There is no cap on pinned notes. If a user pins 50 notes, the ordering stops being useful, and the right fix is for them to unpin some — not for the app to impose a limit.

### 6.4 Tags

A tag is created by typing a new name into the tag editor; existing names complete. Case-insensitive match, normalised to the first-created spelling. Removing a tag from a note never deletes the tag itself; a tag disappears from the sidebar only when its note count reaches zero (`03-data-model.md` §5).

### 6.5 Search

Focus with `Ctrl/Cmd+F`, or click the field. Results replace the note list; the sidebar structure stays visible so the search can be scoped. A search with an active folder or tag filter narrows within it. Query length ≥ 2, or the last query is restored. `Esc` clears and restores the previous list.

Search results are ordered by `bm25` relevance, **not** by the pinned/updated ordering of the normal list. Mixing the two produces a confusing result set; a user who searches wants the best match at the top. Pinned notes are not boosted in search.

### 6.5a Timestamps in the note list

Relative by default: `now`, `2 min`, `3 h`, `yesterday`, then a short absolute date once older than a week (`3 Feb`). No tooltip on desktop — the relative form is what matters, and a hover state on every row is visual noise. The exact timestamp is visible in the editor's detail area when the note is open, where there is room for it.

| Age | Shown |
|------|-------|
| < 60 s | `now` |
| < 60 min | `N min` |
| < 24 h | `N h` |
| yesterday | `yesterday` |
| < 7 d | `N d` |
| older | `3 Feb` |

Timestamps are computed from `updated_at` (epoch ms) at render time and recomputed on a 60 s interval so a list left open stays accurate. Editing a note moves it to the top immediately, without waiting for the interval.

### 6.6 Settings

A modal dialog with:

| Setting | Control | Default |
|---------|---------|---------|
| Theme | Segmented: Light / Dark / System | System |
| Accent colour | **Six preset swatches plus a custom colour input** | `#2f6fed` |
| Default folder for new notes | Folder picker, "None" allowed | None — everything starts unfiled |
| Reset settings | Destructive button with confirmation | — |

**On accent presets:** six swatches are offered because a raw colour input is an unpleasant way to make a first choice, and picking a preset is one click. The custom input remains, because one person's preset list is not everyone taste. Presets are defined once in `src/styles/tokens.css` as `--accent-preset-1` … `--accent-preset-6`, each chosen to hold 4.5:1 contrast against both `--surface` and `--surface-raised`.

Settings live in the Tauri store, never in the notes database, so resetting or syncing settings can never touch notes.

## 7. Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| New note | `Ctrl/Cmd+N` |
| Search | `Ctrl/Cmd+F` |
| Save now | `Ctrl/Cmd+S` |
| Toggle sidebar | `Ctrl/Cmd+\` |
| Toggle theme | `Ctrl/Cmd+Shift+L` |
| Delete note | `Ctrl/Cmd+Backspace` |
| Rename folder / note | `F2` |
| Toggle pin | `Ctrl/Cmd+D` |
| Toggle task complete | `Ctrl/Cmd+Enter` |
| Undo / redo | `Ctrl/Cmd+Z` · `Ctrl/Cmd+Shift+Z` |
| Bold / italic / strike / code | `Ctrl/Cmd+B` · `I` · `Shift+X` · `E` |
| Move focus: sidebar → editor | `Ctrl/Cmd+Enter` (from the list) |
| Dismiss: search, dialog, sidebar | `Esc` |

Inside the editor, `Tab` inserts two spaces inside `codeBlock` and indents list items; `Shift+Tab` outdents; `Tab` in a paragraph inserts two spaces, which keeps focus inside the editor and never cycles focus rings. Escape is deliberately unbound in the editor. Standard text navigation keys are untouched, including `Ctrl/Cmd+A`, `Ctrl/Cmd+C`, `Ctrl/Cmd+V`, `Ctrl/Cmd+X`.

**Strike is `Ctrl/Cmd+Shift+X`, not `Ctrl/Cmd+S`.** An earlier revision of this
table assigned `Ctrl/Cmd+S` to both *Save now* and *strike*. Save now wins: it is
a deliberate escape hatch from the 800 ms debounce (`04-editor.md` §5.1), and
binding it to a formatting mark would make it unreachable. `Shift+X` is also what
Google Docs uses for the same mark, so the muscle memory is the same.

The four mark shortcuts need editor commands rather than raw keystrokes, so they
live in the `EditorShortcuts` extension in `src/editor/extensions.ts` and not in
`editorProps` (`04-editor.md` §2.1). TipTap 3 ships no default keymap for bold,
italic, or strike, so all four are bound explicitly.

On Android, external keyboards should work. The software keyboard shows a `done` action that closes it rather than a newline, since the editor's block behaviour makes a return key less useful than on desktop.

## 8. Empty and error states

| Situation | Content | Action |
|-----------|---------|--------|
| No notes at all | "No notes yet" · "Your notes are stored on this device and never leave it." | New note button |
| Selection has no notes | "Nothing here" | Clear filter or new note |
| Pinned filter, nothing pinned | "Nothing pinned" · "Pin a note with Ctrl+D to keep it at the top." | New note button |
| Search, no results | "No results for “query”" | Clear search |
| Search, no query, selection empty | Same as "Selection has no notes" | |
| Trash empty | "Trash is empty" | None |
| Note failed to load | "This note could not be opened" | Recovery screen (`04-editor.md` §8.4) |
| Save failing | Inline in status bar, persistent | Automatic retry |
| Folder rename conflict | Inline, "A folder with that name exists" | Keep editing |

Every empty state explains the cause, not just the fact. No illustration, no mascot, no pun.

## 9. Responsive rules

| Range | Behaviour |
|-------|-----------|
| ≥ 1280 px | Two panes, sidebar default 320 px, resizable 240–480 px |
| 1024–1279 px | Two panes, sidebar default 280 px |
| 768–1023 px | Sidebar as overlay drawer, editor full width |
| < 768 px | Single pane, view stack, no hover states |

Hover styling exists only at `pointer: fine`. Every hover affordance has a tap equivalent. Touch targets are at least 44 × 44 px on Android. Long-press opens the context menu on Android; hover shows it on desktop.

## 10. Accessibility

| Concern | Requirement |
|---------|-------------|
| Keyboard operation | Every action reachable by keyboard. `FolderTree` implements the tree pattern: arrows move, `Right` expands, `Left` collapses, `Enter` selects. |
| Focus visibility | 2 px accent ring, 2 px offset, never removed without a replacement |
| Focus management | Opening a dialog moves focus in and traps it; `Esc` closes and restores focus to the trigger |
| Labels | Icon-only buttons carry `aria-label`. Inputs have associated labels. |
| Live regions | Search results announce the count via `aria-live="polite"`; save state announces `Saved` / `Saving…` |
| Semantics | `role="tree"`, `role="listbox"` on the note list, `aria-selected` on the open note, `role="dialog"` with `aria-modal` |
| Contrast | 4.5:1 body text, 3:1 UI components and focus indicators, both themes |
| Icons | `aria-hidden="true"` on every decorative icon; `aria-label` on icon-only buttons |
| Motion | Transitions ≤ 150 ms, `prefers-reduced-motion` honoured |
| Zoom | Usable at 200 % desktop zoom; Android ignores `user-scalable=no` |
| Editor | `role="textbox"`, `aria-multiline="true"`, `aria-label="Note content"` |

ProseMirror's editable region is not fully accessible by default. `role="textbox"` plus `aria-multiline` is the minimum for v1, and this is a known limitation to revisit if the app grows.