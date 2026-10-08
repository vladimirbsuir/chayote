import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { NoteEditor } from './NoteEditor';
import type { JsonDoc } from '../types/note';

/* `10-conventions.md` §10 required test 9: switching notes resets undo history.
   It exists because `setContent` does not clear history, so the bug it catches is
   one note's text reappearing in another after Ctrl+Z. The fix is structural — a
   new editor instance per note — so the test asserts the structure.

   Input rules and smart typography are deliberately absent here: both fire on
   typed input, which `insertContent` does not produce. They are checked with real
   keystrokes in `e2e/editor.spec.ts`, where a WebView actually types. */

type Mounted = { editor: Editor | null; unmount: () => void };

function docOf(text: string): JsonDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function mount(doc: JsonDoc): Mounted {
  const mounted: Mounted = { editor: null, unmount: () => {} };
  const view = render(
    <NoteEditor
      doc={doc}
      editable
      onChange={() => {}}
      onReady={(editor) => {
        mounted.editor = editor;
      }}
      onDispose={() => {}}
    />,
  );
  mounted.unmount = view.unmount;
  return mounted;
}

async function waitForEditor(): Promise<HTMLElement> {
  const selector = '[data-testid="note-editor"]';
  await waitFor(() => {
    expect(document.querySelector(selector)).not.toBeNull();
  });
  return document.querySelector(selector) as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe('NoteEditor', () => {
  it('mounts the document it is given', async () => {
    mount(docOf('first note'));

    expect((await waitForEditor()).textContent).toBe('first note');
  });

  it('carries the accessibility attributes from 05-ui-ux.md §10', async () => {
    mount(docOf('a11y'));
    const node = await waitForEditor();

    expect(node.getAttribute('role')).toBe('textbox');
    expect(node.getAttribute('aria-multiline')).toBe('true');
    expect(node.getAttribute('aria-label')).toBe('Note content');
    expect(node.getAttribute('contenteditable')).toBe('true');
    expect(node.getAttribute('spellcheck')).toBe('true');
  });

  it('gives undo history to exactly one note', async () => {
    const first = mount(docOf('note one'));
    await waitForEditor();
    act(() => {
      first.editor?.commands.insertContentAt(1, ' edited');
    });
    expect(first.editor?.can().undo()).toBe(true);
    first.unmount();

    const second = mount(docOf('note two'));
    await waitForEditor();

    expect(second.editor?.getText()).toBe('note two');
    expect(second.editor?.can().undo()).toBe(false);

    act(() => {
      second.editor?.commands.undo();
    });
    expect(second.editor?.getText()).toBe('note two');
  });

  it('renders the four marks and never a link, because v1 has no link mark', async () => {
    const { container } = render(
      <NoteEditor
        doc={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'kept' },
                { type: 'text', marks: [{ type: 'italic' }], text: 'styles' },
                { type: 'text', marks: [{ type: 'strike' }], text: 'only' },
                { type: 'text', marks: [{ type: 'code' }], text: 'here' },
              ],
            },
          ],
        }}
        editable
        onChange={() => {}}
        onReady={() => {}}
        onDispose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('strong')?.textContent).toBe('kept');
    });
    expect(container.querySelector('em')?.textContent).toBe('styles');
    expect(container.querySelector('s, strike, del')?.textContent).toBe('only');
    expect(container.querySelector('code')?.textContent).toBe('here');
    expect(container.querySelector('a')).toBeNull();
  });

  it('caps heading levels at three and normalises a deeper one', async () => {
    const { container } = render(
      <NoteEditor
        doc={{
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'deep' }] },
          ],
        }}
        editable
        onChange={() => {}}
        onReady={() => {}}
        onDispose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain('deep');
    });
    expect(container.querySelector('h4')).toBeNull();
  });

  it('shows the paragraph placeholder on the current empty block', async () => {
    render(
      <NoteEditor
        doc={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        editable
        onChange={() => {}}
        onReady={() => {}}
        onDispose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe(
        'Write something…',
      );
    });
    expect(document.querySelectorAll('[data-placeholder]')).toHaveLength(1);
  });

  it('shows the heading placeholder on a heading', async () => {
    const { container } = render(
      <NoteEditor
        doc={{ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 } }] }}
        editable
        onChange={() => {}}
        onReady={() => {}}
        onDispose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('h2')?.getAttribute('data-placeholder')).toBe('Heading');
    });
  });
});
