# 05 — UI & UX Specification

**Status:** Frozen. Last updated 2026-10-10.

---

## 1. Design intent

Minimalist does not mean sparse. It means **nothing present that is not currently doing work**. A screen with fewer elements is easier to make obvious, but an empty screen that hides structure is harder to use than a slightly denser one.

The concrete consequence: no decoration, no gradients, no shadows for depth, no icons where a word is clearer. Hierarchy comes from spacing, weight, and a neutral palette.

## 2. Layout

### 2.1 Desktop (≥ 1024 px)

The sidebar is three stacked regions, not three columns. Filters, then structure, then the list, separated by hairlines. Only one is interactive at a time.

### 2.2 Sidebar anatomy

| Region | Height | Content | Behaviour |
|--------|--------|---------|-----------|
| Filters | auto | All notes, Pinned | Segmented control |
| Folders | max 40 % of pane, scroll | Tree | Collapsible per branch and as a whole section, drag to re-parent and reorder |
| Tags | max 25 % of pane, scroll | Flat list with counts | Collapsible as a whole section |
| List header | 32 px | Active selection name + count | |
| Note list | remainder | Virtualised cards | Click to open, right-click for menu, long-press for menu on touch |

### 2.3 Tablet (768–1023 px)

Sidebar overlays the editor as a drawer, 320 px, with a scrim. `Esc` or scrim tap closes it. Toggle in the top bar. The editor goes full width.

### 2.4 Android (< 768 px)

Single pane. One view visible at a time; navigation pushes a view onto an in-app stack.

Back behaviour: the Android system back button pops the view stack. At the root it moves the task to the background. The list → editor transition is a horizontal slide matching the platform convention. Leaving the editor closes the note with the view: the list shows no open marker, because on a single pane there is no open note once the editor is gone — a marker there reads as a stuck selection.

The list view's bar carries a settings gear, the app name, and a new-note button. The gear opens the settings dialog directly: the bar has no room for the desktop's overflow menu, and the slot previously held a `menu` "Open sidebar" button that did nothing — the sidebar content *is* the list view, so there was nothing to open. A hamburger that opens settings would be the same control wearing the wrong icon, so the gear says what it does.

The editor view has its own top bar because it needs a back affordance and a delete action. It does not reuse the desktop top bar. **It no longer carries the title** (ADR-023): the title is the field in the body below, where it can be edited, and a bar that repeats it is a second place to read a stale name from. The bar is back and the actions now.

**The editor's status bar is a different row on mobile, and M7 measured what the desktop one costs at 360 px.** `04-editor.md` §9's five-element row is the *desktop* row. Rendered unchanged on a phone, every one of them failed at once: the title truncated to an ellipsis, the folder to a single letter, and `342 words` wrapped onto a second line that pushed the save state out of the row. Nothing was missing; everything was unreadable, and no DOM assertion could have caught it.

So below 768 px the row carries **folder, tags, `342 w`, and Saved** — what `prototype/index.html` §3 already drew. The pin is absent because §2.4 gives the editor its own bar for actions and the pin goes in that bar's overflow menu, beside the delete action. The title is absent on both widths now, for the reason above rather than for space.

The row is also **44 px tall on mobile rather than 28**, because §9 requires 44 × 44 px touch targets on Android and a 28 px row cannot contain one. The bar grows rather than the target overflowing a row too short to hold it, which would look wrong to someone who can see exactly where the tap lands.

**Tapping empty space under short content puts the caret at the end of the document.** The editable element fills the pane, so the tap lands inside it and resolves natively; taps in the surrounding padding fall back to the same place. Tapping text puts the caret exactly there, as everywhere. Found on a phone, where the dead area under a short note simply swallowed the tap.

### 2.5 Editor measure

Body text is constrained to a 720 px column, centred in the editor pane, with 32 px minimum padding. This is a deliberate readability limit. ProseMirror's default `white-space: pre-wrap` plus `word-break: break-word` handles long unbroken strings and long words without horizontal scrolling.

### 2.6 The note's heading block

Above the text, inside the same 720 px column: the note's name, and under it the moment it was last changed (ADR-023). `NoteHeader` draws both, and `prototype/index.html` §1 and §3 show them.

- **The title is a field, not a heading.** 28 px / 650 / 1.2 on desktop, 24 px on mobile. It grows to fit and scrolls past four lines, which is where the 120-character cap arrives (`04-editor.md` §7).
- **The date is 12 px in `--text-subtle`,** omitted rather than faked when a note has no saved state. It is the smallest thing on the screen because it is the least: a note's name and its text matter, and when it was last touched is metadata about them.
- **The block is inside the editor's scroll area,** so it scrolls away with the text. A sticky title is a different decision and would have to be argued for separately — at 720 px a long title already takes the first two lines.
- **It is chrome on the top bar's terms, not body text:** the field keeps `select-text` even though everything around it is `select-none` (§9), because it is a field the user types in.

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
| `--text-muted` | `#54545c` | Secondary, timestamps |
| `--text-subtle` | `#70707d` | Placeholders |
| `--accent` | user-configurable, default `#2769ec` | Selection, focus ring, active state |
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
| `--text-muted` | `#a7a7af` |
| `--text-subtle` | `#84848e` |

Rules: the dark palette is not a mechanical inversion — contrast is verified per theme. **Every text token clears 4.5:1 against both `--surface` and `--surface-raised` in both themes**, and `--text` reaches 7:1. Focus rings use `--accent` at 2 px with a 2 px offset and must be visible in both themes. No colour carries meaning alone; the accent never appears as the sole indicator of state.

**Text is a four-step ladder, and the bottom step used to be broken.** `--text-subtle` is not decorative — it carries note-list timestamps and the "Untitled" title — and at the values this table originally held it sat at **2.60:1** on `--surface-raised` in the light theme and 3.33:1 in the dark, against the 4.5:1 §10 requires of body text. Nothing asserted any of it, so it shipped through M5. Lifting it alone would have put it within 0.04:1 of `--text-muted` and collapsed the hierarchy into two steps, so `--text-muted` deepens to 7:1 in both themes to keep a step between them. The ladder is now 17.7 / 7.5 / 4.9 on `--surface` and 16.6 / 7.0 / 4.6 on `--surface-raised`, light; 15.3 / 7.6 / 4.9 and 14.3 / 7.0 / 4.5, dark. `src/styles/tokens.test.ts` asserts every ratio, so the next silent edit of a text token fails the build.

**The accent is also per-theme.** `--accent` resolves from `--accent-preset-1`, and the `[data-theme='dark']` block redefines the six `--accent-preset-N` variables, so each theme's default accent is its own value rather than one hex used twice. This was a defect until M6: the frontend wrote `--accent` as an **inline** custom property on `document.documentElement`, which is the same element carrying `data-theme`, and an inline value beats the dark block whatever its specificity — so the dark accent was unreachable and every user saw the light one. The rule that follows from it: **nothing writes `--accent` inline unless the user has chosen a colour of their own**, and `05-ui-ux.md` §6.6 explains what happens then.

### 3.2 Spacing, radius, type

| Token | Scale |
|-------|-------|
| Spacing | 4 / 8 / 12 / 16 / 20 / 24 / 32 px |
| Radius | 6 px (inputs, list items) · 10 px (cards, modals) · 999 px (pills) |
| Shadows | None. Depth comes from `--surface` elevation. One exception: modals and popovers get `0 8px 24px rgb(0 0 0 / 0.12)` |

| Role | Size / weight / line height |
|-------|---------------------------|
| Note title field | 28 px desktop · 24 px mobile · 650 · 1.2 |
| Note last-changed | 12 px · 400 |
| Editor body | 17 px · 400 · **1.5**, 10 px between paragraphs |
| Editor H1 | 28 px · 650 · 1.25 |
| Editor H2 | 22 px · 600 · 1.3 |
| Editor H3 | 19 px · 600 · 1.4 |
| Note list title | 14 px · 550 · 1.4 |
| Note list excerpt | 13 px · 400 · 1.45, two lines, ellipsis |
| Note list timestamp | 12 px · 400 · 1.3 |
| UI label | 13 px · 500 |
| Sidebar section header | 11 px · 600, uppercase, 0.06 em tracking |

**The body's line height is 1.5, and the gap between paragraphs is 10 px** (ADR-023). It
ran at 1.7 with a 14 px gap from M2, which is generous enough that a screen of ordinary
prose showed four lines — at 17 px the reader was paying for air between lines that a
screen at that size does not need. Every value moved with it, so paragraphs and lists
share one rhythm rather than two. The title field is deliberately *tighter* at 1.2: it is
a heading, and a heading with body leading looks like an accident.

The sidebar resize separator is painted as a 1 px rule in `--border`, hovering or
focused in `--accent`, and is hit-tested at 9 px rather than 1 px. See §9 for why.

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
- `fill: currentColor` is permitted for one exception: the checked task-list box, where a filled state reads faster than an outline at 12 px. This is why the task checkbox is a node view rather than a native `input`: the native control ignores the border, the radius, and the accent token, and renders blue in every theme. The input stays in the DOM, hidden and focusable, so the item remains keyboard-operable — see `04-editor.md` §2.

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
| `menu` | Tablet drawer toggle (§2.3) — deliberately absent from the mobile list bar, where there is no drawer to open |
| `arrow-left` | Android back |
| `chevron-down` | Expanded tree branch, expanded section header |
| `chevron-right` | Collapsed tree branch, collapsed section header |
| `more-horizontal` | Overflow menus |
| `settings` | Settings dialog |
| `palette` | Accent colour control |
| `check` | Checked task list item |
| `x` | Clear search, dismiss |
| `alert-circle` | Error and warning states, sync conflicts |
| `rotate-cw` | Retry a failed save, reset settings, Sync now, Check for updates |
| `download` | Install an update |
| `inbox` | Empty state for a selection with no notes |
| `bold` | Formatting toolbar: bold mark |
| `italic` | Formatting toolbar: italic mark |
| `strikethrough` | Formatting toolbar: strikethrough mark |
| `code` | Formatting toolbar: inline code mark |
| `heading-1` | Formatting toolbar: heading level 1 |
| `heading-2` | Formatting toolbar: heading level 2 |
| `heading-3` | Formatting toolbar: heading level 3 |
| `list` | Formatting toolbar: bullet list |
| `list-ordered` | Formatting toolbar: ordered list |
| `list-todo` | Formatting toolbar: task list |
| `indent-increase` | Formatting toolbar: increase indent (nests lists, indents prose and quotes) |
| `indent-decrease` | Formatting toolbar: decrease indent (unnests lists, outdents prose and quotes) |
| `quote` | Formatting toolbar: blockquote |
| `square-code` | Formatting toolbar: code block |
| `separator-horizontal` | Formatting toolbar: horizontal rule |
| `undo-2` | Formatting toolbar: undo |
| `redo-2` | Formatting toolbar: redo |

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
| `TopBar` | Search field, new note, theme toggle, overflow menu. Present on desktop; variant `Mobile` on the Android list carries a settings gear, the app name and a new-note button, with the search field below the bar. |
| `Sidebar` | Filters, tag rows with counts and menus, `NoteList`. The tag list renders here; there is no `TagList.tsx`. Owns selection state. |
| `FolderTree`, `folderRows.ts` | Recursive tree. Keyboard navigable. Drag to re-parent and reorder. |
| `NoteList` | Virtualised list. Renders `NoteSummary`, never loads full documents. |
| `NoteCard` | Title, excerpt, timestamp, pinned indicator. Optional folder name when the selection is All or Pinned. Every card carries its own border and surface with an 8 px gap, so adjacent notes read as separate cards; the open card's border is the accent. |
| `EditorOverflowMenu` | Mobile three-dots menu: pin and trash for the open note. |
| `EditorPane` | Owns the TipTap instance, autosave state machine, status bar. |
| `FormattingToolbar` | Static formatting row above the editor content (desktop and mobile): the four marks, H1–H3, bullet / ordered / task lists, increase / decrease indent, blockquote, code block, horizontal rule, undo / redo. Horizontally scrollable; 32 px targets on desktop, 44 px on Android. No paragraph button: pressing an active block button toggles it back to a paragraph, so a dedicated control would duplicate every one of them. The indent buttons are context-sensitive: inside a list they nest / unnest (a nested ordered list restarts at 1), elsewhere they indent / outdent the paragraph, heading, or whole blockquote in 24 px steps up to 7 levels (`04-editor.md` §1.2). |
| `EditorStatusBar` | Folder, tags, pin, word count, save state (`04-editor.md` §9). It no longer carries the title (ADR-023). |
| `NoteHeader` | The note's heading block: the title field and the last-changed date under it (§2.6). |
| `StatusPopovers` | One listbox component behind both popovers: `TagEditor` for adding and removing tags, `FolderPicker` for changing a note's folder. |
| `ConfirmDialog` | Destructive confirmation only. Used by permanent delete and empty trash. Never for save or navigation. |
| `ThemeToggle` | Light / Dark / System cycle. |
| `SettingsDialog` | Theme, accent, default folder, reset. |
| `EmptyState` | All empty states (§8). |

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

**The actions a note row offers are the selection's, not the shell's.** A live list offers *Pin note*/*Unpin note* and *Move to trash*. The trash offers *Restore* and *Delete permanently*, and never *Move to trash* again. Emptiness drives the whole thing: a live note cannot have a "delete permanently" control on it, and a trashed note cannot be moved to the trash a second time. This is the one mistake in this section worth being pedantic about. The pin lives in the row menu deliberately: on touch there is no hover, so without it a phone could only pin from inside the editor.

**A deleted note's row is menu-keyed, not a boolean.** Opening a menu remembers which note it is for and where; when the note's id or the actions on offer change, the key stops matching and the menu is simply not rendered. A boolean would need an effect to close it, and an effect repairs state one render late — showing the wrong note's actions for a frame, in a menu whose whole purpose is destructive actions. **One menu is open at a time, and choosing an item closes it.** The state lives in the list, not the row — per-card state let two holds open two menus at once — and the close happens in the item press, because a permanent delete opens its confirmation before the note changes and the menu would sit under its own dialog.

**The key is deliberately not the note's timestamp, and finding that out cost a flaky CI test.** `updatedAt` moves on *every* write, so keying on it made any write close an open menu — including the write the menu itself triggers (a pin, which re-sorts the list) and including a background write the menu had nothing to do with. On CI a menu opened by a hold on a freshly pinned row vanished between the hold and the read that followed, because the pin's own response landed after the key was taken: a menu a person can watch disappear under their finger. The timestamp was never what the guard was for. The id lookup covers the case that matters — a note that leaves the list takes its menu with it — the item press covers choosing, and `Esc` and an outside press cover the rest. What is left is a menu that stays up over a note that merely *changed*, which is right: its own label follows the live row (`Pin note` ↔ `Unpin note`, the note's own title), so it never shows a stale verb.

**The note row menu is portalled and positioned against the viewport.** The note list is virtualised, and every row is a transformed, absolutely positioned element — which creates a stacking context, so a menu rendered inside a row cannot be lifted above the rows after it by `z-index`, and the scroll container's `overflow` clips it as well. Measured in the handler that opens it rather than in an effect, because the geometry is available at the event. It opens upward when there is no room below, which is the common case for the last card and not only for the last card. It opens three ways — right-click (§2.2), long-press on touch, and the application key (§7). There is no menu button on the card: right-click is sufficient, and one fewer hover control is one fewer thing moving under the cursor. A hold fires `contextmenu` on the device; the row is not selectable, because a hold over selectable text becomes a selection gesture and no `contextmenu` fires at all. The row eats the click a release synthesises rather than opening the note under the menu — on this WebView a prevented hold synthesises nothing and the menu simply stays open, and the guard is for engines that do.

**The folder row menu is portalled the same way.** The tree scrolls inside its own `overflow` container, and the in-row menu was clipped by it — the long-press menu on a phone arrived as a sliver showing only Rename. Same contract: measured by the opener, flipped upward with no room below, closed by `Esc` and outside press.

**The undo toast names the note it deleted**, sits at the bottom of the window rather than inside the sidebar, and moves no focus. A delete can come from `Ctrl/Cmd+Backspace` while the caret is in the editor, so a toast pinned to the sidebar would be off-screen from where the user is looking — and a focus move would break the keystroke in progress. It announces politely rather than assertively, for the same reason: an assertive announcement interrupts whatever a screen reader is reading. A second delete replaces the toast and its timer rather than stacking a second one; two timers racing would restore whichever note each was pointed at.

**`Ctrl/Cmd+Backspace` deletes the open note**, not plain `Backspace` — in a WebView that navigates back, and in the editor that deletes a character.

### 6.3 Folders

Creating a folder is inline: a single text input in place, `Enter` commits, `Esc` cancels, empty input cancels. Renaming is the same. Deleting a folder with children requires confirmation naming the count. Reordering and re-parenting by drag; `position` values are densified in one transaction (`03-data-model.md` §3.2).

**Folder tree collapse state is persisted per folder** in the settings store, so a collapsed branch stays collapsed across launches. A tap on the twisty collapses on touch exactly as a click does on desktop. On touch, long-press opens the row's menu; otherwise the gesture scrolls. Drag to re-parent is mouse-only in v1 — rows are not draggable on a coarse pointer at all — so on a phone re-parenting waits on the v1.1 "move to…" menu item, like keyboard re-parenting does. The gate is load-bearing: on this WebView a hold on a draggable row can start a touch drag that no `dragend` ever ends, leaving the row dimmed and untappable — found on a phone — and opening the menu ends any drag UI, for the same reason. The Folders and Tags sections collapse as a whole from a chevron in their headers, for top-level lists the per-folder twisty cannot shorten; that state is persisted in the settings store too, and creating a folder from a collapsed section expands it first so the input it opens is on screen. Top-level rows hang under their section header in shared columns — the twisty under the header chevron, the glyph under the header glyph — with 16 px per nesting level; the base indent is rem-based so the columns hold at any root size, while the per-level offset stays in pixels.

**A drop target has three bands.** The outer quarter at each end reorders among siblings, drawn as a 2 px accent rule pinned to that edge; the middle half makes the row the new parent, drawn as a soft accent fill. A quarter rather than a third, because re-parenting is the rarer intent but needs a target big enough to hit, and thirds would have left it under nine pixels on a 26 px row. A rule on the wrong edge would read as re-ordering when the intent was re-parenting, which is the whole distinction.

**A refused drop draws nothing and writes nothing.** Dropping a folder onto itself, into its own descendant, or into the slot it already occupies is resolved before the write — `folders_move` refuses a cycle anyway, but refusing here means the user learns why while the pointer is still down, and no transaction or outbox row is spent on something that cannot succeed. An indicator that promises a reorder which changes nothing is worse than no indicator.

**The dragged row dims to 40 % opacity**, and a row the pointer passes over during a drag does **not** select: a re-parent would otherwise also change which notes the list shows, which is a second unrequested change (§5's single-selection model is about deliberate choices).

**Dragging is unavailable while an editor is open or a menu is showing.** Otherwise a drag begun inside a text input would drag the selected text rather than the folder.

**Keyboard re-parenting has no shortcut, and that is a known gap.** `F2` and `Delete` cover rename and delete, but there is no "move folder under…" command: HTML drag-and-drop has no DOM-level keyboard equivalent, and `aria-dropeffect` is deprecated in ARIA 1.1. Re-parenting from the keyboard is therefore not reachable in v1. It is recorded rather than papered over with a fake ARIA attribute; §6.3's row menu is the partial answer, and a real "move to…" item is the v1.1 candidate.

**A childless folder deletes without a dialog.** The confirmation exists to warn about a subtree; warning about nothing is the interrupt `01-product.md` principle 1 warns against. The dialog names the count of folders that go with it, and says that notes inside are kept and become unfiled — `notes.folder_id` is `ON DELETE SET NULL` (`03-data-model.md` §3.3), so "and its notes" would describe data the app does not delete.

**Folder actions live in a per-row overflow menu**, not in three always-visible controls: a 26 px row has room for the twisty, the folder glyph, the name, and a count, and three more controls would leave the name about forty pixels wide. The menu is `more-horizontal` from the §3.3 inventory, reachable three ways — the row's button on hover at `pointer: fine` (§9), right-click (§2.2), and long-press on touch. Its items are **text, not icons**: the §3.3 inventory is closed and has no edit glyph, and ADR-015 requires adding an icon there before using it. Three distinct English verbs are also §1's "no icons where a word is clearer" applied to a list of rows where a bare verb would be ambiguous about its target. Like the note rows, a folder or tag row swallows the release click after a hold that opened its menu, so the menu never arrives over a changed selection. Like the note rows, the folder rows are not selectable either: a hold over the name must reach the row's `contextmenu`, not the platform's text selection — on the device the name selected instead and no menu opened.

**`F2` renames and `Delete` removes** the focused folder (§7), and both route through the same handler as the menu items. A second implementation of "delete a folder" is how the confirmation ends up counting descendants in one path only.

**A rejected write keeps the input open** with its text and the reason beneath it (§8, "Keep editing"), and the message clears as soon as the user types again. Losing what was typed on a validation failure is the failure mode `05-ui-ux.md` §8 is written against.

### 6.3a Pinning

`Ctrl/Cmd+D`, or the pin control on a note card and in the editor. Toggling is optimistic in the UI and reconciled by the command response. Pinned notes sort above every other note in every selection, and a pinned indicator appears on the card. The `Pinned` filter shows only pinned notes, combined with the active folder or tag when one is set.

There is no cap on pinned notes. If a user pins 50 notes, the ordering stops being useful, and the right fix is for them to unpin some — not for the app to impose a limit.

**On a card, the pin is the button — on pinned notes only.** A pinned note shows a visible pin control that unpins; an unpinned one carries no pin at all, and pinning runs from the row menu, the editor and the shortcut instead. A permanently visible pin on every card would make the pinned one stop meaning anything. The card is also a click target, so the control stops propagation: a pin that also opened the note would be useless on a row the user was trying to read.

**In the trash the pin is a plain icon, not a disabled button.** The pin of a deleted note is not something the user can act on, and a disabled control reads as one that is broken rather than as one that does not belong here.

**In the editor, `Ctrl/Cmd+D` does not go through the autosave debounce.** `04-editor.md` §5.1 makes the serialised document the comparison, so a write that changes only `isPinned` would be judged unchanged and skipped — the pin would move in the UI and never reach the database. It is a metadata write and goes to `notes_set_pinned` directly. The editor's own autosave target carries `isPinned`, so the value in memory has to change at the same moment or the next keystroke saves the old flag and silently undoes the pin.

**The card toggle is optimistic and the response reconciles.** A pin reorders every list in the app at once, and a row that jumps a moment after the press reads as a dropped interaction. The optimistic patch applies to every cached list, not only the visible one, so switching selection does not briefly show a stale pin; the response then replaces the open note's entry, because it carries the authoritative `updated_at` the ordering depends on.

### 6.4 Tags

A tag is created from the sidebar's `+` — an inline input like the folder one, committed with `Enter` — or by typing a new name into the tag editor; existing names complete. Case-insensitive match, normalised to the first-created spelling. Removing a tag from a note never deletes the tag itself; the tag stays in the sidebar with a zero count until it is deleted outright (`03-data-model.md` §5, ADR-021).

**Tag actions live in a per-row overflow menu**, like the folder rows': the row's button on hover at `pointer: fine` (§9), right-click (§2.2), and long-press on touch. Its items are **Rename** and **Delete**, text rather than icons for the inventory's reason. Renaming is the same inline input as creating; deleting confirms with the note count and detaches the tag from every note carrying it while the notes themselves survive, returning the selection to All.

**The editor and the picker are one visual language.** Both are portalled popovers anchored to the control that opened them — a status-bar slot or the settings dialog's default-folder button — and both are listboxes. They are the same component with different options, because a tag editor that looked different from the folder picker would be two visual languages for "choose a value" in a 28 px row. The picker is portalled rather than rendered in place because the status bar sits at the bottom of a `flex` column with its own stacking contexts: in place, the popover would be clipped by the editor pane and could not be raised above it. Its position is measured in the click handler rather than in an effect — the geometry is in hand at the click, and an effect that reads the DOM and then sets state is a second render for a value already known. The panel never covers its own anchor, so pressing the button again always dismisses the list; the list scrolls internally rather than growing over it.

**A `listbox`, not a menu.** Both are choose-one-or-more from a list, and the ARIA pattern for that is a listbox: arrow keys, `Home`/`End` and type-ahead come with it, and the tags listbox is `aria-multiselectable`. The folder picker is a listbox over the tree flattened depth-first, indented by depth — a picker is not a tree, and reusing the folder tree's nested `role="treeitem"` rendering would be neither correct nor reusable. The "None" choice sits at the same indent as a top-level folder with no icon, exactly like one. Both pickers carry a filter field for large libraries; the folder one filters only, while the tag one also creates — folder creation stays in the sidebar behind `+`, and a picker that created folders would be a second implementation of it.

**Enter toggles rather than duplicating.** A typed name that matches an existing tag exactly (case-insensitively) adds that tag, because `tags_create` normalises to the first-created spelling and asking it to create `Work` again would be asking for a second `work`. A name that matches nothing creates it, and the hint says so rather than leaving an empty list. When nothing matches and the field is empty, nothing happens.

**The status bar shows one tag and a count of the rest.** A note with four tags does not fit in a 28 px row, and truncating the name of the one shown would be worse than saying how many there are. Each slot's `aria-label` names the action ("Change folder", "Choose tags") rather than its value, so a screen reader announcing "Work, button" does not say what pressing it would do.

**A folder or tag change goes through the autosave debounce, not its own command.** `notes_save` is the one write that carries `folderId` and `tagIds` together with the document, and the tag set is a whole-set replacement (`07-sync-plan.md` §5.3) rather than an increment — two commands appending rows would get that wrong. What does not go through the debounce is `isPinned`, which has a command of its own for the reason above.

**The slots show the pending value, not the saved one.** The folder and tags shown are what the next autosave will write. A click that appeared to do nothing for 800 ms would be the same lie the pin had.

**Creating a tag flushes before it refetches.** Attaching the tag is the debounced write, so the save is flushed here rather than leaving the new name unattached for 800 ms; invalidating the tag query then refreshes the cached list the slot resolves names from, so the bar never carries a tag it cannot name.

### 6.5 Search

Focus with `Ctrl/Cmd+F`, or click the field. Results replace the note list; the sidebar structure stays visible so the search can be scoped. A search with an active folder or tag filter narrows within it. Query length ≥ 2, or the last query is restored. `Esc` clears and restores the previous list.

Search results are ordered by `bm25` relevance, **not** by the pinned/updated ordering of the normal list. Mixing the two produces a confusing result set; a user who searches wants the best match at the top. Pinned notes are not boosted in search.

**Search covers all five selections, including the trash.** `01-product.md` §5.3 lists
the scope as "all / pinned / folder / tag" and omits `trash`, but `trash` is a
selection like any other and the Rust service already answered for it. Making it
the one selection where the field silently does nothing would need a rule, a copy
and a test to explain an exception that has no reason to exist. Resolved at M5.

**"The last query is restored" means within the session.** The field's text is
shell state, and dropping below two characters puts the selection's own list back
— that is the restore. Nothing is written to the settings store, so a relaunch
opens an empty field. A persisted query would mean the search box is populated at
every startup, and search is not in `06-platform.md` §2's restored state.

**The highlight is backend markup, and the frontend does not trust it.** Rust's
`snippet()` returns `<mark>`-wrapped HTML (`03-data-model.md` §3.6), and so does
the browser mock. `lib/sanitize.ts` has a second allowlist holding exactly `mark`
and no attributes, separate from the paste list on purpose: adding a node to the
editor must never widen what search markup may contain. `plain_text` is whatever
the user typed and FTS5 escapes none of it, so a note containing `<script>`
produces a snippet containing one.

**The result list pages, and the header says so.** A two-character query matches
more notes than one page holds. The header names the *applied* query — the
debounced one, not the field's text, which may be a keystroke newer than the rows
on screen — and the count reads `3 of 4,123 results` while a second page exists. A
header reporting only the loaded rows tells someone searching for a common word
that they had finished. `Show more` sits below the scroll container rather than
inside it, so it stays reachable without scrolling past the loaded results.

**A search has no loading state.** The previous result set stays on screen while
the next one loads (`01-product.md` §8). A list that blanks and refills on every
keystroke is the visible loading state whatever it is called.

**The mobile list view carries its own field, below its bar.** The prototype puts
a 40 px field under the Android bar rather than inside it: at 360 px the bar's
three controls and a usable field do not fit on one row, which is the same reason
§9 keeps the desktop bar off this view entirely.

**The field's focus ring is its container's.** The visible control is the rounded
box; the `<input>` inside it draws nothing. Both halves need a literal in
`base.css` — `outline-none` loses to the unlayered `:focus-visible` rule, and
`type="search"` otherwise draws Chromium's own cancel button beside the field's
`x`.

### 6.5a Timestamps in the note list

Relative by default: `now`, `2 min`, `3 h`, `yesterday`, then a short absolute date once older than a week (`3 Feb`). **No tooltip on desktop** — the relative form is what matters, and a hover state on every row is visual noise. The exact timestamp is visible in the editor's detail area when the note is open, where there is room for it.

This settles what `08-roadmap.md` §6 Q4 left open. The question asked whether a
`Updated 3 Feb` affordance should appear on hover and recorded the default as
"relative only, no tooltip" — the two halves of that sentence disagreed. The rule
here is the second half, and **Q4 is answered: relative only, no tooltip.**

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

A modal dialog with **three tabs**, in this order: **General**, **Sync**, **Updates**. The order is by how often each is touched — the things a user changes while writing come first, and the once-a-month chore last. One tab stop across the strip; `ArrowLeft` / `ArrowRight` move between tabs and wrap, `Home` / `End` jump to the ends. Wrapping and the end keys arrived with the third tab: with two, the handler was a pair-flip, which is why `Home` and `End` did nothing and nothing noticed.

Only the selected panel is mounted, so a hidden panel holds no state and a hidden conflict resolver keeps no poll running.

**General**

| Setting | Control | Default |
|---------|---------|---------|
| Theme | Segmented: Light / Dark / System | System |
| Accent colour | **Six preset swatches plus a custom colour editor behind the palette swatch** | Each theme's own preset 1 |
| Default folder for new notes | Folder picker, "None" allowed | None — everything starts unfiled |
| Reset settings | Destructive button with confirmation | — |

**Updates** (ADR-024)

| Field | Control | Default |
|-------|---------|---------|
| Version | Read-only text, `Chayote 0.1.0` | — |
| Check for updates | Button (`rotate-cw`), disabled while a request is in flight | — |
| Result | One sentence: up to date, or a version is available | Nothing |
| Install and restart | Button (`download`), only when a newer version exists | — |
| Progress | A bar with a percentage, only while bytes are moving | — |
| Last checked | The reader's own locale, so it survives a relaunch | Never |

Four rules this tab holds to, each of which is a screen someone could get wrong:

- **Nothing is claimed that was not measured.** "Chayote is up to date." appears only after a check that came back empty, never as the resting state; a tab that says so before it has asked is asserting something about a version it does not know. This is why the result line is driven by *this tab's* check completing and not by the persisted timestamp — the silent daily tick writes that timestamp without reporting anything into the tab, and a tab that inherited its conclusion would be reporting a result it never saw.
- **A platform that cannot update gets a disabled button and a sentence, not a working button that fails.** macOS and Android are named and told what to do instead (`06-platform.md` §3.8), the same shape as the existing "Sync is unavailable here." fallback.
- **One action at a time.** Checking and installing are both round trips against the same manifest, and the second replaces the running process.
- **Release notes are plain text.** `latest.json` carries them as untrusted text from a remote file and the app has no Markdown renderer, so they are never rendered as markup — the paste-sanitizer problem (`04-editor.md` §5) in a place nobody thought to check.

**Sync** carries the connection string, an enable switch, an explicit Save (the only field in the dialog that does not apply on change, because it is secret text the user may still be editing), Sync now, Re-upload everything, status, and the conflict resolver; `07-sync-plan.md` §6 is the recovery story behind it.

**On accent presets:** six swatches are offered because a raw colour input is an unpleasant way to make a first choice, and picking a preset is one click. The custom input remains, because one person's preset list is not everyone taste. Presets are defined once in `src/styles/tokens.css` as `--accent-preset-1` … `--accent-preset-6`, redefined in the `[data-theme='dark']` block, and mirrored as data in `lib/settings.ts`.

**Each preset has a value per theme, and the reason is contrast.** An accent is used as *text* — the active folder row and the active tag row set `color: var(--accent)` — so it has to clear 4.5:1 against the surface behind it. That surface is `--surface-raised` for the sidebar and `--surface` for the editor, and `--surface-raised` is the harder of the two in **both** themes: darker than `--surface` in light, lighter in dark. One hex therefore cannot serve both themes, and the earlier claim that a single value held 4.5:1 against both surfaces was measured and found false — Violet was 4.23 and 3.96 in the light theme alone.

| Preset | Light | Dark |
|--------|-------|------|
| Blue | `#2769ec` | `#4881ef` |
| Green | `#1f7a4d` | `#26975f` |
| Violet | `#814ef5` | `#9469f7` |
| Rust | `#c2410c` | `#ea4f0e` |
| Magenta | `#b91c5c` | `#e44a88` |
| Teal | `#0f766e` | `#13948a` |

Each value is its hue at the lightness that clears **4.5:1 against its own theme's `--surface-raised`**, held in HSL so the hue and saturation are the preset's and only the lightness moves. Four of the six light values are the reviewed palette unchanged; Blue and Violet are the two that did not hold. `src/styles/tokens.test.ts` asserts the ratio over both token tables, which is what makes the claim above true rather than aspirational.

**A custom accent is used verbatim, in both themes.** It cannot be a curated pair, and deriving one at runtime was rejected: it puts colour maths and a second rendering of the same colour in the app, for a control that is by definition off the preset list. A custom colour shows no readout and no contrast warning. This is the one place the accent can fail the contrast bar, and it is the user's own colour doing it.

Reached from the top-bar overflow menu on desktop and tablet, and from the gear on the mobile list bar (§2.4) — every breakpoint has a path to it, which mobile lacked until the dead hamburger became the gear.

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
| Delete folder | `Delete` (confirms when it has children) |
| Toggle pin | `Ctrl/Cmd+D` |
| Toggle task complete | `Ctrl/Cmd+Enter` |
| Undo / redo | `Ctrl/Cmd+Z` · `Ctrl/Cmd+Shift+Z` |
| Bold / italic / strike / code | `Ctrl/Cmd+B` · `I` · `Shift+X` · `E` |
| Increase / decrease indent | `Ctrl/Cmd+]` · `Ctrl/Cmd+[` |
| Move focus: sidebar → editor | `Ctrl/Cmd+Enter` (from the list) |
| Dismiss: search, dialog, sidebar | `Esc` |

Inside the editor, `Tab` inserts two spaces inside `codeBlock` and indents list items; `Shift+Tab` outdents; `Tab` in a paragraph inserts two spaces, which keeps focus inside the editor and never cycles focus rings. Paragraph, heading and blockquote indent is on the toolbar's increase / decrease buttons and on `Ctrl/Cmd+]` / `Ctrl/Cmd+[` — `Tab` deliberately stays as spaces so prose editing never changes a block's indent by accident. Escape is deliberately unbound in the editor. Standard text navigation keys are untouched, including `Ctrl/Cmd+A`, `Ctrl/Cmd+C`, `Ctrl/Cmd+V`, `Ctrl/Cmd+X`.

**Strike is `Ctrl/Cmd+Shift+X`, not `Ctrl/Cmd+S`.** An earlier revision of this
table assigned `Ctrl/Cmd+S` to both *Save now* and *strike*. Save now wins: it is
a deliberate escape hatch from the 800 ms debounce (`04-editor.md` §5.1), and
binding it to a formatting mark would make it unreachable. `Shift+X` is also what
Google Docs uses for the same mark, so the muscle memory is the same.

The four mark shortcuts need editor commands rather than raw keystrokes, so they
live in the `EditorShortcuts` extension in `src/editor/extensions.ts` and not in
`editorProps` (`04-editor.md` §2.1). TipTap 3 ships no default keymap for bold,
italic, or strike, so all four are bound explicitly. The indent shortcuts live
in the `Indent` extension in `src/editor/indent.ts` for the same reason.

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

**On Android the single pane holds in both orientations.** The width bands above govern desktop windows. A phone in landscape widens past 768 px, and width alone would flip the navigation model: the tablet band always renders the editor, so rotating on the list yanked the user into the last-opened note with desktop chrome. The navigation model is a device property (ADR-006) — `01-product.md` §8 requires the Android UI in portrait and landscape alike — so the breakpoint answers `mobile` for any Android WebView regardless of width. Narrow desktop windows keep the width bands.

The sidebar is **collapsible on desktop and dismissible as a drawer on tablet**, and
the two are different affordances:

| Range | Visible control | Shortcut |
|-------|-----------------|----------|
| ≥ 1024 px | **None.** The sidebar is always shown; `Ctrl/Cmd+\` collapses it. | `Ctrl/Cmd+\` |
| 768–1023 px | A `menu` icon button in the top bar, plus the `Ctrl/Cmd+\` shortcut | both |

The desktop bar has no toggle button deliberately. A control whose only effect
would be to hide something that must be visible at that width is a button that
changes nothing, and `prototype/index.html`'s desktop top bar has none — ADR-016
makes the prototype authoritative for appearance. Collapsing the desktop sidebar
is a power-user action with a shortcut, not something the chrome advertises.

The collapsed state and the width are **two separate settings**, so collapsing and
expanding restores the width the user chose rather than snapping back to the
default.

Hover styling exists only at `pointer: fine`. Every hover affordance has a tap equivalent. Touch targets are at least 44 × 44 px on Android. Long-press opens the context menu on Android; hover shows it on desktop.

**Chrome text is not selectable — only text inputs and the editor content are.** A hold anywhere in the UI is therefore always a gesture (open, menu, edit) and never a text selection: rows, menus, popovers, bars, dialogs, toasts and empty states all carry `select-none`, while text inputs opt back in with `select-text` so they keep their selection toolbar. Copying happens in the editor, not in the chrome around it.

**The sidebar resize separator is a 1 px rule with a wider hit area.** §3.3 sets
32 × 32 px for icon buttons; a drag handle one pixel wide is correct to look at
and unusable to grab, and it moves as the sidebar resizes, so a narrow target also
loses the pointer mid-drag. It is painted as a 1 px hairline and hit-tested at
9 px, centred on it.

**The top bar is not rendered on the mobile list view.** The Android list view
carries its own bar with a `settings` gear button, the app name, and a new-note button
(§2.4); the desktop bar would be a second bar above it.

## 10. Accessibility

| Concern | Requirement |
|---------|-------------|
| Keyboard operation | Every action reachable by keyboard. `FolderTree` implements the tree pattern (§10.1) and folder actions are context-menu-driven, with `F2` and `Delete` as the shortcuts that reach the same actions (§7). |
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

### 10.1 The folder tree keyboard pattern

The WAI-ARIA tree pattern, in full. `FolderTree` is **one tab stop**, not one per row: a depth-10 tree would otherwise put ten-plus stops between the sidebar and the note list, and the acceptance bar in `08-roadmap.md` §2 M4 is a depth-10 tree navigated by keyboard alone. Exactly one row carries `tabIndex={0}` and it follows focus.

| Key | Behaviour |
|-----|-----------|
| `ArrowDown` / `ArrowUp` | Next / previous **visible** row. A collapsed branch's descendants are not visible, so they are not reachable — the same fact that hides them on screen. |
| `ArrowRight` | Collapsed branch: expand it. Expanded branch: move to its first child. Leaf: nothing. |
| `ArrowLeft` | Expanded branch: collapse it. Leaf or collapsed branch: move to the parent. A root has nothing above it, so nothing happens. |
| `Home` / `End` | First / last visible row |
| `Enter` / `Space` | Select the folder — the note list narrows to it |
| `ContextMenu` | Open the focused row's overflow menu. The "application key" on a Windows keyboard, and the standard way to ask for a menu |
| `F2` | Rename the focused folder, in place (§6.3) |
| `Delete` | Delete the focused folder, confirming first when it has children (§6.3) |

Two details that are not obvious:

- **Climbing out of a deep chain takes two presses per level.** `ArrowLeft` on an expanded branch collapses it; only the *next* press climbs to the parent. This is the standard behaviour, not a bug, and the second press is resolved against the row list as it stands *after* the collapse.
- **The collapse twisty is out of the tab order** (`tabIndex={-1}`). The arrows do its job, and a mouse click still reaches it.

`aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded` carry the structure to assistive technology, because a nested `role="group"` tree and a flat list of `treeitem`s are indistinguishable to a screen reader otherwise.