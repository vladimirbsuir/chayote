import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';
import { useSelectionStore } from '../stores/selection';
import type { NoteRow } from '../types/ipc';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';

const FOLDERS: FolderNode[] = [
  {
    id: 'f-work',
    name: 'Work',
    parentId: null,
    position: 0,
    children: [
      { id: 'f-projects', name: 'Projects', parentId: 'f-work', position: 0, children: [] },
    ],
  },
];

const TAGS: TagWithCount[] = [{ id: 't-work', name: 'work', count: 2 }];

function note(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: 'n-1',
    title: 'Meeting notes',
    excerpt: 'Discussed the launch date with the team.',
    folderId: 'f-work',
    folderName: 'Work',
    isPinned: false,
    wordCount: 12,
    updatedAt: Date.now(),
    tags: [],
    ...overrides,
  };
}

/* Resolved rather than rejected: the tests here assert on layout and copy, and an
   unhandled rejection in a test that never triggers a write would be noise. */
const noWrite = (): Promise<void> => Promise.resolve();
const noMove = (): Promise<void> => Promise.resolve();

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}): void {
  const props: React.ComponentProps<typeof Sidebar> = {
    selection: { kind: 'all' },
    width: 320,
    folders: FOLDERS,
    tags: TAGS,
    notes: [note()],
    search: null,
    onClearSearch: () => {},
    isPending: false,
    now: Date.now(),
    folderNames: new Map([['f-work', 'Work']]),
    folderCounts: new Map([['f-work', 1]]),
    collapsedFolders: [],
    openNoteId: null,
    firstLaunch: false,
    onSelect: () => {},
    onOpenNote: () => {},
    onNewNote: () => {},
    onToggleFolder: () => {},
    onCreateFolder: noWrite,
onRenameFolder: noWrite,
    onDeleteFolder: noWrite,
    onMoveFolder: noMove,
    ...overrides,
  };
  render(<Sidebar {...props} />);
}

describe('Sidebar', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
  });

  it('renders the three stacked regions of §2.2 with the selection name', () => {
    renderSidebar();

    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeDefined();
    expect(screen.getByTestId('list-header').textContent).toBe('All notes');
    expect(screen.getByTestId('list-count').textContent).toBe('1 note');
  });

  it('pluralises the count rather than hard-coding a label', () => {
    renderSidebar({ notes: [note(), note({ id: 'n-2' })] });
    expect(screen.getByTestId('list-count').textContent).toBe('2 notes');
  });

  it('names the folder in the list header once a folder is selected', () => {
    renderSidebar({ selection: { kind: 'folder', id: 'f-work' } });
    expect(screen.getByTestId('list-header').textContent).toBe('Work');
  });

  it('shows the first-launch empty state with no seeded folders or tags', () => {
    renderSidebar({ firstLaunch: true, notes: [], folders: [], tags: [] });

    expect(screen.getByText('No notes yet')).toBeDefined();
    expect(screen.getByText('No folders yet')).toBeDefined();
    expect(screen.getByText('No tags yet')).toBeDefined();
  });

  it('offers no add control for tags, which are created from a note instead', () => {
    /* A tag with no notes is invisible by the `tags_list` count rule, so a
       sidebar create control would appear to do nothing. Creation lives in the
       note's tag editor (§6.4); the section header carries no button. */
    renderSidebar();

    expect(screen.getByRole('button', { name: 'New folder' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New tag' })).toBeNull();
  });

  it('distinguishes an empty pinned filter from an empty all-notes view', () => {
    renderSidebar({ selection: { kind: 'pinned' }, notes: [] });
    expect(screen.getByText('Nothing pinned')).toBeDefined();
  });

  it('says the trash is empty rather than claiming nothing exists', () => {
    renderSidebar({ selection: { kind: 'trash' }, notes: [] });
    expect(screen.getByText('Trash is empty')).toBeDefined();
  });

  it('renders nested folder rows and marks the active one', () => {
    const { container } = render(
      <Sidebar
        selection={{ kind: 'folder', id: 'f-projects' }}
        width={320}
        folders={FOLDERS}
        tags={TAGS}
        notes={[note()]}
        search={null}
        onClearSearch={() => {}}
        isPending={false}
        now={Date.now()}
        folderNames={new Map([['f-work', 'Work']])}
        folderCounts={new Map([['f-work', 1]])}
        collapsedFolders={[]}
        openNoteId={null}
        firstLaunch={false}
        onSelect={() => {}}
        onOpenNote={() => {}}
        onNewNote={() => {}}
        onToggleFolder={() => {}}
        onCreateFolder={noWrite}
        onRenameFolder={noWrite}
        onDeleteFolder={noWrite}
        onMoveFolder={noMove}
      />,
    );

    const rows = container.querySelectorAll('[data-testid="folder-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('hides a collapsed branch but keeps its row', () => {
    const { container } = render(
      <Sidebar
        selection={{ kind: 'all' }}
        width={320}
        folders={FOLDERS}
        tags={TAGS}
        notes={[note()]}
        search={null}
        onClearSearch={() => {}}
        isPending={false}
        now={Date.now()}
        folderNames={new Map([['f-work', 'Work']])}
        folderCounts={new Map([['f-work', 1]])}
        collapsedFolders={['f-work']}
        openNoteId={null}
        firstLaunch={false}
        onSelect={() => {}}
        onOpenNote={() => {}}
        onNewNote={() => {}}
        onToggleFolder={() => {}}
        onCreateFolder={noWrite}
        onRenameFolder={noWrite}
        onDeleteFolder={noWrite}
        onMoveFolder={noMove}
      />,
    );

    expect(container.querySelectorAll('[data-testid="folder-row"]')).toHaveLength(1);
  });

  it('collapses the whole Folders list from its header, keeping the header and the notes', () => {
    /* The twisty hides one branch; the section toggle hides the high-level list
       itself, which is what a long top-level list needs. */
    renderSidebar();

    expect(screen.getByRole('tree', { name: /folder/i })).toBeDefined();
    fireEvent.click(screen.getByTestId('section-toggle-folders'));

    expect(screen.queryByRole('tree', { name: /folder/i })).toBeNull();
    expect(screen.getByTestId('section-toggle-folders')).toBeDefined();
    expect(screen.getByTestId('note-list')).toBeDefined();
    expect(screen.getAllByTestId('tag-row')).toHaveLength(1);
  });

  it('collapses the whole Tags list from its header', () => {
    renderSidebar();

    expect(screen.getAllByTestId('tag-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('section-toggle-tags'));

    expect(screen.queryByTestId('tag-row')).toBeNull();
    expect(screen.getByTestId('section-toggle-tags')).toBeDefined();
    expect(screen.getByTestId('note-list')).toBeDefined();
  });

  it('expands a collapsed section on a second press', () => {
    renderSidebar();

    const toggle = screen.getByTestId('section-toggle-folders');
    fireEvent.click(toggle);
    expect(screen.queryByRole('tree', { name: /folder/i })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('tree', { name: /folder/i })).toBeDefined();
  });

  it('announces the section toggle state for assistive technology', () => {
    renderSidebar();

    const toggle = screen.getByTestId('section-toggle-folders');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('sidebar-folders');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('honours controlled section props and reports the toggle', () => {
    let toggled = 0;
    renderSidebar({
      foldersCollapsed: true,
      onToggleFoldersCollapsed: () => {
        toggled += 1;
      },
    });

    expect(screen.queryByRole('tree', { name: /folder/i })).toBeNull();
    fireEvent.click(screen.getByTestId('section-toggle-folders'));
    expect(toggled).toBe(1);
  });

  it('expands a collapsed Folders section when a folder is added from its header', () => {
    /* `+` opens an input inside the tree, so from a collapsed section it expands
       first — otherwise it would open an input nobody can see. */
    renderSidebar();

    fireEvent.click(screen.getByTestId('section-toggle-folders'));
    expect(screen.queryByRole('tree', { name: /folder/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('tree', { name: /folder/i })).toBeDefined();
  });

  it('marks the active filter tab for assistive technology', () => {
    renderSidebar({ selection: { kind: 'pinned' } });
    expect(screen.getByTestId('filter-pinned').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('filter-all').getAttribute('aria-selected')).toBe('false');
  });

  it('emits no emoji and no raw colour values', () => {
    /* ADR-015: icons are Lucide vectors and colour comes from tokens only. */
    const html = renderToStaticMarkup(
      <Sidebar
        selection={{ kind: 'all' }}
        width={320}
        folders={FOLDERS}
        tags={TAGS}
        notes={[note()]}
        search={null}
        onClearSearch={() => {}}
        isPending={false}
        now={Date.now()}
        folderNames={new Map([['f-work', 'Work']])}
        folderCounts={new Map([['f-work', 1]])}
        collapsedFolders={[]}
        openNoteId={null}
        firstLaunch={false}
        onSelect={() => {}}
        onOpenNote={() => {}}
        onNewNote={() => {}}
        onToggleFolder={() => {}}
        onCreateFolder={noWrite}
        onRenameFolder={noWrite}
        onDeleteFolder={noWrite}
        onMoveFolder={noMove}
      />,
    );

    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/\brgb\(/);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

/* `05-ui-ux.md` §6.5 and §8. A search changes what the third region is showing and
   nothing else, so these are about the sidebar keeping the other two regions — and
   its own honesty about how much of the result set is on screen. */
describe('Sidebar while searching', () => {
  const query = { query: 'roadmap', total: 1 };

  it('names the query rather than the selection in the list header', () => {
    renderSidebar({ search: query, notes: [note()] });

    expect(screen.getByTestId('list-header').textContent).toBe('Results for “roadmap”');
    expect(screen.getByTestId('list-count').textContent).toBe('1 result');
  });

  it('counts every match, not only the loaded pages', () => {
    renderSidebar({
      search: { query: 'the', total: 4_123 },
      notes: [note(), note({ id: 'n-2' }), note({ id: 'n-3' })],
    });

    /* A header reporting the loaded rows alone would tell someone searching for
       a common word that they had found everything. */
    expect(screen.getByTestId('list-count').textContent).toBe('3 of 4123 results');
  });

  it('shows the whole set once every page is loaded', () => {
    renderSidebar({
      search: { query: 'the', total: 2 },
      notes: [note(), note({ id: 'n-2' })],
    });

    expect(screen.getByTestId('list-count').textContent).toBe('2 results');
  });

  it('names the query that found nothing and explains what search covers', () => {
    renderSidebar({ search: { query: 'kumquat', total: 0 }, notes: [] });

    expect(screen.getByText('No results for “kumquat”')).toBeDefined();
    expect(screen.getByText('Search covers titles and the full text of every note in this view.')).toBeDefined();
  });

  it('clears from the empty state, so the way out is on the screen that has no results', () => {
    let cleared = 0;
    renderSidebar({
      search: { query: 'kumquat', total: 0 },
      notes: [],
      onClearSearch: () => {
        cleared += 1;
      },
    });

    fireEvent.click(screen.getByTestId('sidebar').querySelector('button.mt-1') as Element);
    expect(cleared).toBe(1);
  });

  it('does not claim the device is empty while a search has no hits', () => {
    /* ADR-014's first-launch state is a fact about the database, not about the
       list. Reaching it with the field full would say the opposite of what the
       user just saw. */
    renderSidebar({ search: { query: 'kumquat', total: 0 }, notes: [], firstLaunch: true });

    expect(screen.queryByText('No notes yet')).toBeNull();
    expect(screen.getByText('No results for “kumquat”')).toBeDefined();
  });

  it('announces the count politely, as §10 requires', () => {
    renderSidebar({ search: query, notes: [note()] });

    /* A live region added to the page already holding the value announces
       nothing, so the count is always one rather than only during a search. */
    expect(screen.getByTestId('list-count').getAttribute('aria-live')).toBe('polite');
  });

  it('keeps the folder tree and the tags on screen so the search can be scoped', () => {
    renderSidebar({ search: query, notes: [note()] });

    expect(screen.getByRole('tree', { name: /folder/i })).toBeDefined();
    expect(screen.getAllByTestId('tag-row').length).toBeGreaterThan(0);
  });

  it('renders the marked snippet in the result row instead of the excerpt', () => {
    renderSidebar({
      search: query,
      notes: [note({ snippet: 'Rough outline of the <mark>roadmap</mark> draft.' })],
    });

    const marked = screen.getByTestId('sidebar').querySelector('[data-testid="note-snippet"] mark');
    expect(marked?.textContent).toBe('roadmap');
  });

  it('fills the column with no divider when the width is null (mobile list view)', () => {
    /* Found on a phone: the desktop width ended the list early with a stray
       border at the viewport edge (`05-ui-ux.md` §2.4 draws no divider there).
       jsdom computes no layout, so this asserts the classes and the style the
       layout comes from rather than any geometry; `e2e/mobile.spec.ts` measures
       the real box at 360 px. */
    renderSidebar({ width: null });

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar.style.width).toBe('');
    expect(sidebar.className).toContain('flex-1');
    expect(sidebar.className).not.toContain('border-r');
    expect(sidebar.className).not.toContain('flex-none');
  });

  it('keeps the sized pane with its divider on desktop', () => {
    renderSidebar({ width: 320 });

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar.style.width).toBe('320px');
    expect(sidebar.className).toContain('border-r');
  });
});

afterEach(() => {
  useSelectionStore.setState({ selection: { kind: 'all' }, openNoteId: null });
});
