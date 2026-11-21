import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { JsonDoc } from '../types/note';
import { CLIPBOARD_CORE_OPTIONS } from './clipboardSerializer';
import { buildEditorProps } from './editorProps';
import { EDITOR_EXTENSIONS } from './extensions';

type NoteEditorProps = {
  doc: JsonDoc;
  editable: boolean;
  onChange: (editor: Editor) => void;
  onFlush: () => void;
  onReady: (editor: Editor) => void;
  onDispose: () => void;
};

const EDITOR_PROPS = buildEditorProps();

export function NoteEditor({
  doc,
  editable,
  onChange,
  onFlush,
  onReady,
  onDispose,
}: NoteEditorProps) {
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: doc,
    editable,
    autofocus: 'end',
    immediatelyRender: false,
    editorProps: EDITOR_PROPS,
    ...CLIPBOARD_CORE_OPTIONS,
    onUpdate: ({ editor: current }) => {
      onChange(current);
    },
    onBlur: () => {
      onFlush();
    },
  });

  useEffect(() => {
    if (editor === null) return;
    onReady(editor);
    return () => {
      onDispose();
    };
  }, [editor, onDispose, onReady]);

  useEffect(() => {
    if (editor === null) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  return (
    <EditorContent
      editor={editor}
      className="flex-1"
      data-testid="note-editor-pane"
    />
  );
}
