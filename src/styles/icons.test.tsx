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
  Download,
  FilePlus,
  Folder,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Inbox,
  IndentDecrease,
  IndentIncrease,
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
  download: Download,
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
  'indent-increase': IndentIncrease,
  'indent-decrease': IndentDecrease,
  quote: Quote,
  'square-code': SquareCode,
  'separator-horizontal': SeparatorHorizontal,
  'undo-2': Undo2,
  'redo-2': Redo2,
};

const SIZES = ['i-16', 'i-18', 'i-20', 'i-24'] as const;

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
    expect([...documented].sort()).toEqual([...Object.keys(ICONS)].sort());
  });

  it('renders each one at all four sizes', () => {
    for (const [name, Icon] of Object.entries(ICONS)) {
      for (const size of SIZES) {
        const { container, unmount } = render(<Icon className={`icon ${size}`} aria-hidden="true" />);
        const svg = container.querySelector('svg');
        expect(svg, `${name} at ${size}`).not.toBeNull();
        expect(svg?.getAttribute('class'), `${name} at ${size}`).toContain(`icon ${size}`);
        expect(svg?.getAttribute('aria-hidden'), `${name} at ${size}`).toBe('true');
        unmount();
      }
    }
  });

  it('draws nothing itself: no colour, no caller-set size', () => {
    for (const [name, Icon] of Object.entries(ICONS)) {
      const { container, unmount } = render(<Icon className="icon i-20" aria-hidden="true" />);
      const svg = container.querySelector('svg');
      expect(svg?.hasAttribute('style'), `${name} carries a style`).toBe(false);
      expect(svg?.getAttribute('stroke'), `${name} stroke`).toBe('currentColor');
      expect(svg?.getAttribute('fill'), `${name} fill`).toBe('none');
      unmount();
    }
  });

  it('has the four size classes defined with the stepping stroke widths', () => {
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

      const token = /stroke-width:\s*var\((--icon-stroke-[a-z]+)\)/.exec(rule)?.[1];
      expect(token, `.${size} takes its stroke from a token`).toBeDefined();
      strokes.push(new RegExp(`${token}:\\s*([\\d.]+)`).exec(tokens)?.[1] ?? '');
    }

    expect(strokes).toEqual(['2', '2', '1.75', '1.5']);
  });

  it('keeps every icon colourless by construction', () => {
    const css = readFileSync(STYLES, 'utf8');
    const base = /\.icon\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/stroke:\s*currentColor/);
    expect(base).toMatch(/fill:\s*none/);
  });

  it('uses no emoji anywhere in the application source or the specification', () => {
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

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2B50}\u{274C}\u{2757}]|\u{FE0F}/gu;

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
