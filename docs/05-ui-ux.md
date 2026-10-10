# 05 — UI & UX Specification

**Status:** Frozen. Last updated 2026-10-09.

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
| Editor body | 17 px · 400 · 1.7 |
| Editor H1 | 28 px · 650 · 1.25 |
| Editor H2 | 22 px · 600 · 1.3 |
| Editor H3 | 19 px · 600 · 1.4 |
| Note list title | 14 px · 550 · 1.4 |
| Note list excerpt | 13 px · 400 · 1.45, two lines, ellipsis |
| Note list timestamp | 12 px · 400 · 1.3 |
| UI label | 13 px · 500 |
| Sidebar section header | 11 px · 600, uppercase, 0.06 em tracking |

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

**The actions a note row offers are the selection's, not the shell's.** A live list offers exactly one item — *Move to trash*. The trash offers *Restore* and *Delete permanently*, and never *Move to trash* again. Emptiness drives the whole thing: a live note cannot have a "delete permanently" control on it, and a trashed note cannot be moved to the trash a second time. This is the one mistake in this section worth being pedantic about.

**A deleted note's row is menu-keyed, not a boolean.** Opening a menu remembers which note it is for and where; when the note's id, timestamp or available actions change, the key stops matching and the menu is simply not rendered. A boolean would need an effect to close it, and an effect repairs state one render late — showing the wrong note's actions for a frame, in a menu whose whole purpose is destructive actions.

**The note row menu is portalled and positioned against the viewport.** The note list is virtualised, and every row is a transformed, absolutely positioned element — which creates a stacking context, so a menu rendered inside a row cannot be lifted above the rows after it by `z-index`, and the scroll container's `overflow` clips it as well. Measured in the click handler rather than in an effect, because the geometry is available at the click. It opens upward when there is no room below, which is the common case for the last card and not only for the last card.

**The undo toast names the note it deleted**, sits at the bottom of the window rather than inside the sidebar, and moves no focus. A delete can come from `Ctrl/Cmd+Backspace` while the caret is in the editor, so a toast pinned to the sidebar would be off-screen from where the user is looking — and a focus move would break the keystroke in progress. It announces politely rather than assertively, for the same reason: an assertive announcement interrupts whatever a screen reader is reading. A second delete replaces the toast and its timer rather than stacking a second one; two timers racing would restore whichever note each was pointed at.

**`Ctrl/Cmd+Backspace` deletes the open note**, not plain `Backspace` — in a WebView that navigates back, and in the editor that deletes a character.

### 6.3 Folders

Creating a folder is inline: a single text input in place, `Enter` commits, `Esc` cancels, empty input cancels. Renaming is the same. Deleting a folder with children requires confirmation naming the count. Reordering and re-parenting by drag; `position` values are densified in one transaction (`03-data-model.md` §3.2).

**Folder tree collapse state is persisted per folder** in the settings store, so a collapsed branch stays collapsed across launches. On touch, long-press initiates a folder drag; otherwise the gesture scrolls.

**A drop target has three bands.** The outer quarter at each end reorders among siblings, drawn as a 2 px accent rule pinned to that edge; the middle half makes the row the new parent, drawn as a soft accent fill. A quarter rather than a third, because re-parenting is the rarer intent but needs a target big enough to hit, and thirds would have left it under nine pixels on a 26 px row. A rule on the wrong edge would read as re-ordering when the intent was re-parenting, which is the whole distinction.

**A refused drop draws nothing and writes nothing.** Dropping a folder onto itself, into its own descendant, or into the slot it already occupies is resolved before the write — `folders_move` refuses a cycle anyway, but refusing here means the user learns why while the pointer is still down, and no transaction or outbox row is spent on something that cannot succeed. An indicator that promises a reorder which changes nothing is worse than no indicator.

**The dragged row dims to 40 % opacity**, and a row the pointer passes over during a drag does **not** select: a re-parent would otherwise also change which notes the list shows, which is a second unrequested change (§5's single-selection model is about deliberate choices).

**Dragging is unavailable while an editor is open or a menu is showing.** Otherwise a drag begun inside a text input would drag the selected text rather than the folder.

**Keyboard re-parenting has no shortcut, and that is a known gap.** `F2` and `Delete` cover rename and delete, but there is no "move folder under…" command: HTML drag-and-drop has no DOM-level keyboard equivalent, and `aria-dropeffect` is deprecated in ARIA 1.1. Re-parenting from the keyboard is therefore not reachable in v1. It is recorded rather than papered over with a fake ARIA attribute; §6.3's row menu is the partial answer, and a real "move to…" item is the v1.1 candidate.

**A childless folder deletes without a dialog.** The confirmation exists to warn about a subtree; warning about nothing is the interrupt `01-product.md` principle 1 warns against. The dialog names the count of folders that go with it, and says that notes inside are kept and become unfiled — `notes.folder_id` is `ON DELETE SET NULL` (`03-data-model.md` §3.3), so "and its notes" would describe data the app does not delete.

**Folder actions live in a per-row overflow menu**, not in three always-visible controls: a 26 px row has room for the twisty, the folder glyph, the name, and a count, and three more controls would leave the name about forty pixels wide. The menu is `more-horizontal` from the §3.3 inventory, reachable three ways — the row's button on hover at `pointer: fine` (§9), right-click (§2.2), and long-press on touch. Its items are **text, not icons**: the §3.3 inventory is closed and has no edit glyph, and ADR-015 requires adding an icon there before using it. Three distinct English verbs are also §1's "no icons where a word is clearer" applied to a list of rows where a bare verb would be ambiguous about its target.

**`F2` renames and `Delete` removes** the focused folder (§7), and both route through the same handler as the menu items. A second implementation of "delete a folder" is how the confirmation ends up counting descendants in one path only.

**A rejected write keeps the input open** with its text and the reason beneath it (§8, "Keep editing"), and the message clears as soon as the user types again. Losing what was typed on a validation failure is the failure mode `05-ui-ux.md` §8 is written against.

### 6.3a Pinning

`Ctrl/Cmd+D`, or the pin control on a note card and in the editor. Toggling is optimistic in the UI and reconciled by the command response. Pinned notes sort above every other note in every selection, and a pinned indicator appears on the card. The `Pinned` filter shows only pinned notes, combined with the active folder or tag when one is set.

There is no cap on pinned notes. If a user pins 50 notes, the ordering stops being useful, and the right fix is for them to unpin some — not for the app to impose a limit.

**On a card, the pin is the button.** A pinned note shows a visible pin control that unpins; an unpinned one has the same control revealed on hover at `pointer: fine`. A permanently visible pin on every card would make the pinned one stop meaning anything, and a control that appears only on pinned rows is undiscoverable — the user would have to know a note is pinned before they can unpin it. The card is also a click target, so the control stops propagation: a pin that also opened the note would be useless on a row the user was trying to read.

**In the trash the pin is a plain icon, not a disabled button.** The pin of a deleted note is not something the user can act on, and a disabled control reads as one that is broken rather than as one that does not belong here.

**In the editor, `Ctrl/Cmd+D` does not go through the autosave debounce.** `04-editor.md` §5.1 makes the serialised document the comparison, so a write that changes only `isPinned` would be judged unchanged and skipped — the pin would move in the UI and never reach the database. It is a metadata write and goes to `notes_set_pinned` directly. The editor's own autosave target carries `isPinned`, so the value in memory has to change at the same moment or the next keystroke saves the old flag and silently undoes the pin.

**The card toggle is optimistic and the response reconciles.** A pin reorders every list in the app at once, and a row that jumps a moment after the press reads as a dropped interaction. The optimistic patch applies to every cached list, not only the visible one, so switching selection does not briefly show a stale pin; the response then replaces the open note's entry, because it carries the authoritative `updated_at` the ordering depends on.

### 6.4 Tags

A tag is created by typing a new name into the tag editor; existing names complete. Case-insensitive match, normalised to the first-created spelling. Removing a tag from a note never deletes the tag itself; a tag disappears from the sidebar only when its note count reaches zero (`03-data-model.md` §5).

**The editor and the picker are one visual language.** Both are portalled popovers anchored to their status-bar slot, and both are listboxes. They are the same component with different options, because a tag editor that looked different from the folder picker would be two visual languages for "choose a value" in a 28 px row. The picker is portalled rather than rendered in place because the status bar sits at the bottom of a `flex` column with its own stacking contexts: in place, the popover would be clipped by the editor pane and could not be raised above it. Its position is measured in the click handler rather than in an effect — the geometry is in hand at the click, and an effect that reads the DOM and then sets state is a second render for a value already known.

**A `listbox`, not a menu.** Both are choose-one-or-more from a list, and the ARIA pattern for that is a listbox: arrow keys, `Home`/`End` and type-ahead come with it, and the tags listbox is `aria-multiselectable`. The folder picker is a listbox over the tree flattened depth-first, indented by depth — a picker is not a tree, and reusing the folder tree's nested `role="treeitem"` rendering would be neither correct nor reusable.

**Enter toggles rather than duplicating.** A typed name that matches an existing tag exactly (case-insensitively) adds that tag, because `tags_create` normalises to the first-created spelling and asking it to create `Work` again would be asking for a second `work`. A name that matches nothing creates it, and the hint says so rather than leaving an empty list. When nothing matches and the field is empty, nothing happens.

**The status bar shows one tag and a count of the rest.** A note with four tags does not fit in a 28 px row, and truncating the name of the one shown would be worse than saying how many there are. Each slot's `aria-label` names the action ("Change folder", "Choose tags") rather than its value, so a screen reader announcing "Work, button" does not say what pressing it would do.

**A folder or tag change goes through the autosave debounce, not its own command.** `notes_save` is the one write that carries `folderId` and `tagIds` together with the document, and the tag set is a whole-set replacement (`07-sync-plan.md` §5.3) rather than an increment — two commands appending rows would get that wrong. What does not go through the debounce is `isPinned`, which has a command of its own for the reason above.

**The slots show the pending value, not the saved one.** The folder and tags shown are what the next autosave will write. A click that appeared to do nothing for 800 ms would be the same lie the pin had.

**Creating a tag flushes before it refetches.** A new tag's count is zero until the note carrying it is saved, and `tags_list` hides a tag whose notes are all in the trash and any tag with a zero count (`03-data-model.md` §5) — so the tag is genuinely not in the library until the write lands. Flushing the autosave and then invalidating the tag query is what makes the new name appear in the slot at all; without it the note would carry a tag the bar cannot name.

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

A modal dialog with:

| Setting | Control | Default |
|---------|---------|---------|
| Theme | Segmented: Light / Dark / System | System |
| Accent colour | **Six preset swatches plus a custom colour input** | Each theme's own preset 1 |
| Default folder for new notes | Folder picker, "None" allowed | None — everything starts unfiled |
| Reset settings | Destructive button with confirmation | — |

**On accent presets:** six swatches are offered because a raw colour input is an unpleasant way to make a first choice, and picking a preset is one click. The custom input remains, because one person's preset list is not everyone taste. Presets are defined once in `src/styles/tokens.css` as `--accent-preset-1` … `--accent-preset-6`, redefined in the `[data-theme='dark']` block, and mirrored as data in `lib/settings.ts`.

**Each preset has a value per theme, and the reason is contrast.** An accent is used as *text* — the active folder row and the active tag row set `color: var(--accent)` — so it has to clear 4.5:1 against the surface behind it. That surface is `--surface-raised` for the sidebar and `--surface` for the editor, and `--surface-raised` is the harder of the two in **both** themes: darker than `--surface` in light, lighter in dark. One hex therefore cannot serve both themes, and the earlier claim that a single value held 4.5:1 against both surfaces was measured and found false — Violet was 4.23 and 3.96 in the light theme alone.

| Preset | Light | Dark |
|--------|-------|------|
| Default | `#2769ec` | `#4881ef` |
| Green | `#1f7a4d` | `#26975f` |
| Violet | `#814ef5` | `#9469f7` |
| Rust | `#c2410c` | `#ea4f0e` |
| Magenta | `#b91c5c` | `#e44a88` |
| Teal | `#0f766e` | `#13948a` |

Each value is its hue at the lightness that clears **4.5:1 against its own theme's `--surface-raised`**, held in HSL so the hue and saturation are the preset's and only the lightness moves. Four of the six light values are the reviewed palette unchanged; Default and Violet are the two that did not hold. `src/styles/tokens.test.ts` asserts the ratio over both token tables, which is what makes the claim above true rather than aspirational.

**A custom accent is used verbatim, in both themes.** It cannot be a curated pair, and deriving one at runtime was rejected: it puts colour maths and a second rendering of the same colour in the app, for a control that is by definition off the preset list. The custom input therefore shows the colour's contrast against the current theme's surfaces and warns when it is below 4.5:1, so the consequence is visible at the moment of choosing it rather than afterwards. This is the one place the accent can fail the contrast bar, and it is the user's own colour doing it.

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

**The sidebar resize separator is a 1 px rule with a wider hit area.** §3.3 sets
32 × 32 px for icon buttons; a drag handle one pixel wide is correct to look at
and unusable to grab, and it moves as the sidebar resizes, so a narrow target also
loses the pointer mid-drag. It is painted as a 1 px hairline and hit-tested at
9 px, centred on it.

**The top bar is not rendered on the mobile list view.** The Android list view
carries its own bar with a `menu` button, the app name, and a new-note button
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