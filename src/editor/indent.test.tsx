import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { FormattingToolbar } from '../components/FormattingToolbar';
import { EDITOR_EXTENSIONS } from './extensions';
import { MAX_INDENT } from './indent';
import type { JsonDoc } from '../types/note';

afterEach(() => {
  cleanup();
});

function para(text: string): JsonDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function Harness({
  doc,
  onEditor,
}: {
  doc: JsonDoc;
  onEditor?: (editor: Editor) => void;
}): React.ReactElement {
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: doc,
    immediatelyRender: false,
  });
  if (editor !== null) onEditor?.(editor);
  return (
    <>
      <FormattingToolbar editor={editor} />
      <EditorContent editor={editor} />
    </>
  );
}

async function ready(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByTestId('formatting-toolbar')).not.toBeNull();
  });
}

/* `editor` is assigned from inside a render callback, so TypeScript keeps its
   `= null` narrowing at every direct read in the test body. Every touch of it
   therefore happens inside a closure (where the narrowing resets) and hands
   plain values back out — the same reason the neighbouring toolbar tests only
   read `editor?.getHTML()` from inside `waitFor`. */
function htmlOf(current: Editor | null): string {
  let html = '';
  act(() => {
    html = current?.getHTML() ?? '';
  });
  return html;
}

function runIndent(current: Editor | null): boolean {
  let result = false;
  act(() => {
    result = current?.commands.indent() ?? false;
  });
  return result;
}

function runOutdent(current: Editor | null): boolean {
  let result = false;
  act(() => {
    result = current?.commands.outdent() ?? false;
  });
  return result;
}

function canIndent(current: Editor | null): boolean {
  let result = false;
  act(() => {
    result = current?.can().indent() ?? false;
  });
  return result;
}

function canOutdent(current: Editor | null): boolean {
  let result = false;
  act(() => {
    result = current?.can().outdent() ?? false;
  });
  return result;
}

function caretIntoFirstBlock(current: Editor | null): void {
  act(() => {
    current?.commands.focus();
    current?.commands.setTextSelection(1);
  });
}

function caretAtEnd(current: Editor | null): void {
  act(() => {
    current?.commands.focus('end');
  });
}

function indentButton(name: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name });
}

describe('indent extension', () => {
  it('registers indent and outdent commands', async () => {
    let editor: Editor | null = null;
    render(<Harness doc={para('hello')} onEditor={(e) => (editor = e)} />);
    await ready();

    await waitFor(() => {
      expect(typeof editor?.commands.indent).toBe('function');
      expect(typeof editor?.commands.outdent).toBe('function');
    });
  });

  it('indents a paragraph in 24px steps and removes the style at zero', async () => {
    let editor: Editor | null = null;
    render(<Harness doc={para('indented')} onEditor={(e) => (editor = e)} />);
    await ready();
    caretIntoFirstBlock(editor);

    runIndent(editor);
    await waitFor(() => {
      expect(htmlOf(editor)).toContain('margin-left: 24px');
    });

    runIndent(editor);
    await waitFor(() => {
      expect(htmlOf(editor)).toContain('margin-left: 48px');
    });

    runOutdent(editor);
    await waitFor(() => {
      expect(htmlOf(editor)).toContain('margin-left: 24px');
    });

    runOutdent(editor);
    await waitFor(() => {
      expect(htmlOf(editor)).not.toContain('margin-left');
    });
  });

  it('clamps paragraph indent at seven levels', async () => {
    let editor: Editor | null = null;
    render(<Harness doc={para('deep')} onEditor={(e) => (editor = e)} />);
    await ready();
    caretIntoFirstBlock(editor);

    act(() => {
      for (let i = 0; i < MAX_INDENT + 3; i += 1) editor?.commands.indent();
    });
    await waitFor(() => {
      expect(htmlOf(editor)).toContain('margin-left: 168px');
    });
    expect(htmlOf(editor)).not.toContain('margin-left: 192px');
    expect(canIndent(editor)).toBe(false);
  });

  it('refuses to outdent a paragraph already at zero', async () => {
    let editor: Editor | null = null;
    render(<Harness doc={para('flat')} onEditor={(e) => (editor = e)} />);
    await ready();
    caretIntoFirstBlock(editor);

    expect(runOutdent(editor)).toBe(false);
    expect(canOutdent(editor)).toBe(false);
  });

  it('indents a heading', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={{
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titled' }] },
          ],
        }}
        onEditor={(e) => (editor = e)}
      />,
    );
    await ready();
    caretIntoFirstBlock(editor);

    runIndent(editor);
    await waitFor(() => {
      expect(htmlOf(editor)).toContain('<h2');
      expect(htmlOf(editor)).toContain('margin-left: 24px');
    });
  });

  it('indents the whole blockquote, not the paragraph inside it', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={{
          type: 'doc',
          content: [
            {
              type: 'blockquote',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
            },
          ],
        }}
        onEditor={(e) => (editor = e)}
      />,
    );
    await ready();
    caretIntoFirstBlock(editor);

    runIndent(editor);
    await waitFor(() => {
      expect(htmlOf(editor)).toContain('<blockquote');
      expect(htmlOf(editor)).toContain('margin-left: 24px');
    });
    /* The margin sits on the quote element; the inner paragraph stays flat. */
    const inner = htmlOf(editor).match(/<p[^>]*>quoted<\/p>/)?.[0] ?? '';
    expect(inner).not.toContain('margin-left');
  });

  it('nests list items instead of adding a margin', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={{
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
                },
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
                },
              ],
            },
          ],
        }}
        onEditor={(e) => (editor = e)}
      />,
    );
    await ready();

    /* Caret at the end of the second item, then indent: sink nests it. */
    caretAtEnd(editor);
    runIndent(editor);
    await waitFor(() => {
      const html = htmlOf(editor);
      expect(html.match(/<ul>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(html).not.toContain('margin-left');
    });

    runOutdent(editor);
    await waitFor(() => {
      expect((htmlOf(editor).match(/<ul>/g) ?? []).length).toBe(1);
    });
  });

  it('nests an ordered list with the inner list restarting at one', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={{
          type: 'doc',
          content: [
            {
              type: 'orderedList',
              attrs: { start: 1 },
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hb' }] }],
                },
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Jehe' }] }],
                },
              ],
            },
          ],
        }}
        onEditor={(e) => (editor = e)}
      />,
    );
    await ready();

    caretAtEnd(editor);
    runIndent(editor);
    await waitFor(() => {
      expect((htmlOf(editor).match(/<ol>/g) ?? []).length).toBe(2);
    });
    /* The nested list carries no explicit start: it counts from one. */
    expect(htmlOf(editor)).toContain('Jehe');
    expect(htmlOf(editor)).not.toContain('margin-left');
  });

  it('does nothing in a code block', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={{
          type: 'doc',
          content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'code' }] }],
        }}
        onEditor={(e) => (editor = e)}
      />,
    );
    await ready();
    caretIntoFirstBlock(editor);

    expect(canIndent(editor)).toBe(false);
    expect(canOutdent(editor)).toBe(false);
    const before = htmlOf(editor);
    expect(runIndent(editor)).toBe(false);
    expect(htmlOf(editor)).toBe(before);
  });

  it('exposes an enabled increase button and a disabled decrease button on a flat paragraph', async () => {
    let editor: Editor | null = null;
    render(<Harness doc={para('buttons')} onEditor={(e) => (editor = e)} />);
    await ready();
    act(() => {
      editor?.commands.focus();
      editor?.commands.selectAll();
    });

    await waitFor(() => {
      expect(indentButton('Increase indent').disabled).toBe(false);
    });
    /* At zero there is nothing to outdent: in a list the lift path applies,
       in prose the button correctly disables. */
    expect(indentButton('Decrease indent').disabled).toBe(true);
  });
});
