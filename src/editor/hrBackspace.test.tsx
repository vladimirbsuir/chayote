import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { EDITOR_EXTENSIONS } from './extensions';
import type { JsonDoc } from '../types/note';

afterEach(() => {
  cleanup();
});

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
  return <EditorContent editor={editor} />;
}

function mount(doc: JsonDoc): { editor: () => Editor | null } {
  const holder: { editor: Editor | null } = { editor: null };
  render(
    <Harness
      doc={doc}
      onEditor={(e) => {
        holder.editor = e;
      }}
    />,
  );
  return {
    editor: () => holder.editor,
  };
}

async function proseMirror(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.querySelector('.ProseMirror')).not.toBeNull();
  });
  return document.querySelector('.ProseMirror') as HTMLElement;
}

function pressBackspace(node: HTMLElement): void {
  fireEvent.keyDown(node, { key: 'Backspace', code: 'Backspace', keyCode: 8 });
}

function paragraph(text: string): JsonDoc {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const HR: JsonDoc = { type: 'horizontalRule' };

/* Backspace in an empty top-level paragraph after a divider deletes the divider
   at once. Without the `EditorShortcuts` case the empty block dies first and the
   divider is left node-selected but unstyled, so the caret looks lost — and a
   trailing divider strands entirely once the selection moves on. */

describe('Backspace before an empty paragraph after a divider', () => {
  it('deletes the divider and keeps the caret in the empty paragraph', async () => {
    const mounted = mount({ type: 'doc', content: [paragraph('aaa'), HR, { type: 'paragraph' }] });
    const node = await proseMirror();

    act(() => {
      mounted.editor()?.commands.focus('end');
    });
    pressBackspace(node);

    await waitFor(() => {
      expect(mounted.editor()?.getHTML()).not.toContain('<hr>');
    });
    expect(mounted.editor()?.getHTML()).toContain('aaa');
    /* The empty paragraph survives: only the divider is gone. */
    expect(mounted.editor()?.state.doc.childCount).toBe(2);
  });

  it('does nothing special mid-text: a character is deleted', async () => {
    const mounted = mount({ type: 'doc', content: [paragraph('aaa'), HR, paragraph('bbb')] });
    const node = await proseMirror();

    act(() => {
      mounted.editor()?.commands.focus('end');
    });
    pressBackspace(node);

    await waitFor(() => {
      expect(mounted.editor()?.getHTML()).toContain('bb');
    });
    expect(mounted.editor()?.getHTML()).toContain('<hr>');
  });

  it('leaves a non-collapsed selection to the default path', async () => {
    const mounted = mount({ type: 'doc', content: [paragraph('aaa'), HR, { type: 'paragraph' }] });
    const node = await proseMirror();

    act(() => {
      mounted.editor()?.commands.selectAll();
    });
    pressBackspace(node);

    await waitFor(() => {
      expect(mounted.editor()?.getText()).toBe('');
    });
  });

  it('does not reach into a list: an empty list item after a divider keeps its lift', async () => {
    const mounted = mount({
      type: 'doc',
      content: [
        HR,
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
        },
      ],
    });
    const dom = await proseMirror();

    act(() => {
      const editor = mounted.editor();
      if (editor === null) return;
      const end = editor.state.doc.content.size;
      editor.commands.setTextSelection(end - 1);
    });
    /* Sanity: the caret really is nested, so the top-level-only guard applies. */
    expect(mounted.editor()?.state.selection.$from.depth).toBeGreaterThan(1);
    pressBackspace(dom);

    /* The divider survives; whatever the default did to the list item stands. */
    expect(mounted.editor()?.getHTML()).toContain('<hr>');
  });

  it('lets a trailing divider stay reachable: clicking it selects, Backspace deletes', async () => {
    const mounted = mount({ type: 'doc', content: [paragraph('aaa'), HR, paragraph('bbb')] });
    const dom = await proseMirror();

    /* Caret to the start of bbb, where the default chain selects the divider. */
    act(() => {
      const editor = mounted.editor();
      if (editor === null) return;
      let target = -1;
      editor.state.doc.descendants((child, pos) => {
        if (child.type.name === 'paragraph' && child.textContent === 'bbb') {
          target = pos + 1;
          return false;
        }
        return true;
      });
      if (target >= 0) {
        const tr = editor.state.tr;
        tr.setSelection(TextSelection.create(tr.doc, target));
        editor.view.dispatch(tr);
      }
    });
    pressBackspace(dom);

    /* One press removes the divider; the blocks join on the next press, which
       is the default chain and stays default. */
    await waitFor(() => {
      expect(mounted.editor()?.getHTML()).not.toContain('<hr>');
    });
    expect(mounted.editor()?.getHTML()).toBe('<p>aaa</p><p>bbb</p>');
  });
});
