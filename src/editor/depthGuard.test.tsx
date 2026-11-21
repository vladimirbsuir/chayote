import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EDITOR_EXTENSIONS } from './extensions';
import { MAX_DOC_DEPTH } from './depthGuard';
import type { JsonDoc } from '../types/note';

afterEach(() => {
  cleanup();
});

function Harness({ doc, onEditor }: { doc: JsonDoc; onEditor: (editor: Editor) => void }) {
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: doc, immediatelyRender: false });
  if (editor !== null) onEditor(editor);
  return <EditorContent editor={editor} />;
}

async function mount(doc: JsonDoc): Promise<Editor> {
  let current: Editor | null = null;
  render(
    <Harness
      doc={doc}
      onEditor={(editor) => {
        current = editor;
      }}
    />,
  );
  await waitFor(() => {
    expect(current).not.toBeNull();
  });
  return current as unknown as Editor;
}

function deepest(doc: PMNode): number {
  let max = 0;
  doc.descendants((_node, pos) => {
    max = Math.max(max, doc.resolve(pos).depth + 1);
    return true;
  });
  return max;
}

function bulletItems(count: number): JsonDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: Array.from({ length: count }, (_, i) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `item ${i}` }] }],
        })),
      },
    ],
  };
}

describe('document depth guard', () => {
  it('stops list nesting at the depth the Rust validator accepts', async () => {
    const editor = await mount(bulletItems(12));
    for (let i = 1; i < 12; i++) {
      act(() => {
        let target = 0;
        let seen = 0;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph') {
            if (seen === i) target = pos + 1;
            seen += 1;
          }
          return true;
        });
        editor.commands.setTextSelection(target);
        for (let n = 0; n < i; n++) editor.commands.indent();
      });
    }

    expect(deepest(editor.state.doc)).toBeLessThanOrEqual(MAX_DOC_DEPTH);
    expect(editor.state.doc.textContent).toContain('item 11');
  });

  it('does not register underline, which the validator would reject', async () => {
    const editor = await mount({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
    });

    expect(editor.schema.marks.underline).toBeUndefined();
    act(() => {
      editor.commands.selectAll();
    });
    const marks = Object.keys(editor.schema.marks).sort();
    expect(marks).toEqual(['bold', 'code', 'italic', 'strike']);
  });
});
