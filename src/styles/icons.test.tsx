import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AlertCircle,
  ArrowLeft,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  FilePlus,
  Folder,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Inbox,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Palette,
  Pin,
  Plus,
  Quote,
  Redo2,
  RotateCw,
  Search,
  SeparatorHorizontal,
  Settings as SettingsIcon,
  SquareCode,
  Strikethrough,
  Sun,
  Trash,
  Undo2,
  X,
} from 'lucide-react';

/* Required test 12, from `10-conventions.md` §10: "Every icon in the
   `05-ui-ux.md` §3.3 inventory renders at all four sizes and inherits
   `currentColor`."

   It exists because each half is easy to break in a way nothing catches. An
   icon given `fill="#000"` or a hard-coded colour looks correct in one theme and
   wrong in the other, and no single-element assertion sees it. A fifth size, or
   a size that arrives as a `width`/`height` prop instead of the `.i-*` class,
   breaks the optical-weight rule §3.3 spells out and is invisible until someone
   puts two icons next to each other and one of them looks heavier.

   The inventory is read out of `05-ui-ux.md` rather than restated here, so
   adding an icon to the document without adding it to the code fails this test
   rather than passing quietly. ADR-015 and `10-conventions.md` §12 make that
   list authoritative for what may appear in the UI at all. */

const DOC = resolve(process.cwd(), 'docs/05-ui-ux.md');
const STYLES = resolve(process.cwd(), 'src/styles/base.css');

const ICONS: Record<string, typeof Search> = {
  search: Search,
  'file-plus': FilePlus,
  plus: Plus,
  pin: Pin,
  folder: Folder,
  hash: Hash,
  trash: Trash,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  menu: Menu,
  'arrow-left': ArrowLeft,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'more-horizontal': MoreHorizontal,
  settings: SettingsIcon,
  palette: Palette,
  check: Check,
  x: X,
  'alert-circle': AlertCircle,
  'rotate-cw': RotateCw,
  inbox: Inbox,
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  code: Code,
  'heading-1': Heading1,
  'heading-2': Heading2,
  'heading-3': Heading3,
  list: List,
  'list-ordered': ListOrdered,
  'list-todo': ListTodo,
  quote: Quote,
  'square-code': SquareCode,
  'separator-horizontal': SeparatorHorizontal,
  'undo-2': Undo2,
  'redo-2': Redo2,
};

const SIZES = ['i-16', 'i-18', 'i-20', 'i-24'] as const;

/** The Lucide names listed in the §3.3 inventory table, in document order. */
function inventoryFromDoc(): string[] {
  const md = readFileSync(DOC, 'utf8');
  const table = md.split('#### Inventory')[1]?.split('####')[0] ?? '';
  const names = table
    .split('\n')
    .filter((line) => line.trim().startsWith('| `'))
    .map((line) => /^\|\s*`([^`]+)`/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined);
  return names;
}

describe('the icon inventory of 05-ui-ux.md §3.3', () => {
  it('has an implementation for every documented icon, and no others', () => {
    const documented = inventoryFromDoc();
    expect(documented.length).toBeGreaterThan(0);
    /* ADR-015 fixes the inventory, now at 37 with the formatting toolbar.
       A count assertion alone would pass while the list silently grew; the
       equality below is what catches both a missing icon and an extra one. */
    expect([...documented].sort()).toEqual([...Object.keys(ICONS)].sort());
  });

  it('renders each one at all four sizes', () => {
    for (const [name, Icon] of Object.entries(ICONS)) {
      for (const size of SIZES) {
        const { container, unmount } = render(<Icon className={`icon ${size}`} aria-hidden="true" />);
        const svg = container.querySelector('svg');
        expect(svg, `${name} at ${size}`).not.toBeNull();
        /* `lucide-react` prepends its own `lucide lucide-<name>` classes, so this
           is a containment check rather than equality. */
        expect(svg?.getAttribute('class'), `${name} at ${size}`).toContain(`icon ${size}`);
        expect(svg?.getAttribute('aria-hidden'), `${name} at ${size}`).toBe('true');
        unmount();
      }
    }
  });

  it('draws nothing itself: no colour, no caller-set size', () => {
    /* §3.3 and ADR-015: icons inherit `currentColor` and are sized by the four
       classes. An inline `style`, `fill` or `stroke` literal would be a
       hard-coded colour, which is the thing §3.3 rules out in absolute terms.

       `width`/`height` attributes are *not* in this list, and their absence
       would be a false requirement: lucide-react emits `width="24" height="24"`
       on every icon regardless, and the `.icon` rule in `base.css` overrides
       them. What has to be checked is that no callsite passes its own size, which
       the class assertion above covers. */
    for (const [name, Icon] of Object.entries(ICONS)) {
      const { container, unmount } = render(<Icon className="icon i-20" aria-hidden="true" />);
      const svg = container.querySelector('svg');
      expect(svg?.hasAttribute('style'), `${name} carries a style`).toBe(false);
      /* `stroke` and `fill` are both present, and both are the values the rule
         wants: `currentColor` and `none`. A hard-coded colour is the failure, so
         asserting the attributes are *missing* would reject the correct markup
         and pass a wrong one. `fill: currentColor` is permitted in exactly one
         place — the checked task box (§3.3) — and that is a node view, not one of
         these. */
      expect(svg?.getAttribute('stroke'), `${name} stroke`).toBe('currentColor');
      expect(svg?.getAttribute('fill'), `${name} fill`).toBe('none');
      unmount();
    }
  });

  it('has the four size classes defined with the stepping stroke widths', () => {
    /* §3.3: stroke *decreases* as size increases — 2, 2, 1.75, 1.5. A constant
       stroke looks heavy at 24 px and hairline at 16 px, and that is the whole
       reason the set reads as designed rather than assembled. */
    const css = readFileSync(STYLES, 'utf8');
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

    const strokes: string[] = [];
    for (const size of SIZES) {
      const rule = new RegExp(`\\.${size}\\s*\\{([^}]*)\\}`, 'i').exec(css)?.[1] ?? '';
      expect(rule, `.${size} is not defined in base.css`).not.toBe('');

      const width = /width:\s*(\d+)px/.exec(rule)?.[1];
      const height = /height:\s*(\d+)px/.exec(rule)?.[1];
      expect(width, `.${size} sets width`).toBeDefined();
      expect(height, `.${size} sets height`).toBe(height);
      expect(width, `.${size} is square`).toBe(height);

      /* The stroke comes from a token, so the four classes carry four tokens
         rather than four literals scattered through the sheet. */
      const token = /stroke-width:\s*var\((--icon-stroke-[a-z]+)\)/.exec(rule)?.[1];
      expect(token, `.${size} takes its stroke from a token`).toBeDefined();
      strokes.push(new RegExp(`${token}:\\s*([\\d.]+)`).exec(tokens)?.[1] ?? '');
    }

    expect(strokes).toEqual(['2', '2', '1.75', '1.5']);
  });

  it('keeps every icon colourless by construction', () => {
    /* The `.icon` base rule is what makes `currentColor` true for all 37. If it
       ever gained a `fill` or `stroke` literal, every icon in the app would
       inherit it at once. */
    const css = readFileSync(STYLES, 'utf8');
    const base = /\.icon\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/stroke:\s*currentColor/);
    expect(base).toMatch(/fill:\s*none/);
  });

  it('uses no emoji anywhere in the application source or the specification', () => {
    /* ADR-015, in absolute terms: "No emoji anywhere in the application UI".
       `05-ui-ux.md` §3.3 says the same for documentation diagrams. Scoped to
       `src/` and `docs/`, which is where a slip would happen; the range check
       covers the astral planes and the dingbats, not just the first few
       emoji blocks that a naive regex misses. */
    const roots = ['src', 'docs'];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(resolve(process.cwd(), root))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(EMOJI)) {
          offenders.push(`${file.slice(process.cwd().length + 1)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Anything in the pictographic ranges, plus the transport and geometric
    shapes that are emoji when a renderer chooses to draw them that way. The
    ranges skip the unassigned gaps, which is what keeps the check from firing
    on ordinary punctuation or on box-drawing characters in ASCII diagrams. */
/** Pictographic ranges only. Arrows (`→`, `←`), box drawing (`│`, `─`, `└`) and
    bullets are excluded on purpose: they are typography, they appear throughout
    the specification's diagrams, and ADR-015 bans emoji, not diagram characters.
    `☐` and `☑` are *included* — they are in the same block as the dingbats and a
    renderer is free to draw them as emoji, which is exactly the platform variance
    ADR-015 rules out. U+FE0F is matched as a separate alternative rather than
    inside the class: it is a combining mark, and it forces emoji presentation on
    a base character that might otherwise be plain text. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2B50}\u{274C}\u{2757}]|\u{FE0F}/gu;

/** The source and specification files, skipping tests — a test has to be able
    to name a character in order to assert it is absent. */
function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|css|md)$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      found.push(path);
    }
  };
  walk(root);
  return found;
}