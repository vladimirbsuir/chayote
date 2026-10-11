import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { FormattingToolbar } from './FormattingToolbar';
import { EDITOR_EXTENSIONS } from '../editor/extensions';
import type { JsonDoc } from '../types/note';

afterEach(() => {
  cleanup();
});

function docOf(text: string): JsonDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function Harness({
  doc,
  variant,
  onEditor,
}: {
  doc: JsonDoc;
  variant?: 'desktop' | 'mobile';
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
      <FormattingToolbar editor={editor} variant={variant} />
      <EditorContent editor={editor} />
    </>
  );
}

async function toolbar(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.queryByTestId('formatting-toolbar')).not.toBeNull();
  });
  return screen.getByTestId('formatting-toolbar');
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name });
}

describe('FormattingToolbar', () => {
  it('renders one button per v1 style and block, plus undo and redo', async () => {
    render(<Harness doc={docOf('hello')} />);
    await toolbar();

    for (const name of [
      'Bold',
      'Italic',
      'Strikethrough',
      'Inline code',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bullet list',
      'Ordered list',
      'Task list',
      'Blockquote',
      'Code block',
      'Horizontal rule',
      'Undo',
      'Redo',
    ]) {
      expect(screen.queryByRole('button', { name }), `missing ${name}`).not.toBeNull();
    }
  });

  it('disables every button when there is no editor', () => {
    render(<FormattingToolbar editor={null} />);
    for (const element of screen.getAllByRole('button')) {
      expect((element as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('applies bold to the selection when its button is pressed', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={docOf('hello')}
        onEditor={(e) => {
          editor = e;
        }}
      />,
    );
    await toolbar();

    act(() => {
      editor?.commands.focus();
      editor?.commands.selectAll();
    });
    fireEvent.click(button('Bold'));

    await waitFor(() => {
      expect(editor?.getHTML()).toContain('<strong>');
    });
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles a heading level and reports it as pressed', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={docOf('titled')}
        onEditor={(e) => {
          editor = e;
        }}
      />,
    );
    await toolbar();

    act(() => {
      editor?.commands.focus();
      editor?.commands.selectAll();
    });
    fireEvent.click(button('Heading 1'));

    await waitFor(() => {
      expect(editor?.getHTML()).toContain('<h1>');
    });
    expect(button('Heading 1').getAttribute('aria-pressed')).toBe('true');
  });

  it('turns a paragraph into a bullet list', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={docOf('item')}
        onEditor={(e) => {
          editor = e;
        }}
      />,
    );
    await toolbar();

    act(() => {
      editor?.commands.focus();
      editor?.commands.selectAll();
    });
    fireEvent.click(button('Bullet list'));

    await waitFor(() => {
      expect(editor?.getHTML()).toContain('<ul>');
    });
  });

  it('turns a paragraph into a task list', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={docOf('task')}
        onEditor={(e) => {
          editor = e;
        }}
      />,
    );
    await toolbar();

    act(() => {
      editor?.commands.focus();
      editor?.commands.selectAll();
    });
    fireEvent.click(button('Task list'));

    await waitFor(() => {
      expect(editor?.getHTML()).toContain('taskList');
    });
  });

  it('enables undo after a change and undoes through the button', async () => {
    let editor: Editor | null = null;
    render(
      <Harness
        doc={docOf('hello')}
        onEditor={(e) => {
          editor = e;
        }}
      />,
    );
    await toolbar();

    expect(button('Undo').disabled).toBe(true);

    act(() => {
      editor?.commands.focus();
      editor?.commands.selectAll();
    });
    fireEvent.click(button('Bold'));
    await waitFor(() => {
      expect(editor?.getHTML()).toContain('<strong>');
    });

    const undo = button('Undo');
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    await waitFor(() => {
      expect(editor?.getHTML()).not.toContain('<strong>');
    });
  });

  it('uses 44 px targets on mobile and 32 px on desktop', async () => {
    const { unmount } = render(<Harness doc={docOf('hello')} variant="mobile" />);
    await toolbar();
    expect(button('Bold').className).toContain('h-11 w-11');
    unmount();
    cleanup();

    render(<Harness doc={docOf('hello')} variant="desktop" />);
    await toolbar();
    expect(button('Bold').className).toContain('h-8 w-8');
  });
});
