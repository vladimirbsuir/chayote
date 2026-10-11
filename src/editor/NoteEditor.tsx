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

/**
 * One editor instance per mount. `04-editor.md` §6 is explicit that undo must
 * not reach into another note, and `setContent` does not clear history, so
 * `EditorPane` passes `key={noteId}` and React builds a fresh instance — and
 * therefore a fresh history — whenever the note changes.
 *
 * `onDispose` is the flush hook for a note switch: React runs this cleanup
 * before the replacement editor mounts, so the outgoing document is still the
 * one on screen and `06-platform.md` §3.2's "flush, then close" has a real hook.
 *
 * Blur is `onFlush`, not `onChange`. ProseMirror fires blur on mount when
 * `autofocus` settles, and routing that through `onChange` would put "Unsaved
 * changes" on a note nobody has touched. The autosave's serialisation check
 * would skip the write; the status bar would still lie.
 *
 * §2.1 `immediatelyRender: false` keeps construction out of render, which is
 * what makes the same component usable under StrictMode and in jsdom.
 */
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
    editorProps: buildEditorProps(),
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
      className="editor-scroll flex-1 overflow-y-auto px-8 pb-16 pt-10"
      data-testid="note-editor-pane"
      /* Taps in the wrapper's own padding land outside ProseMirror even with its
         full-height floor above, and on touch that tap would do nothing — no
         caret, no keyboard. Route exactly those to the end of the document. Only
         when the wrapper itself is the target (anything inside the text targets
         a descendant and keeps ProseMirror's own position mapping), and never
         mid-selection: releasing a text-selection drag over the padding must not
         collapse what the user just selected. Scrollbar presses dispatch no
         click, so they cannot reach this. */
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const selection = window.getSelection();
        if (selection !== null && !selection.isCollapsed) return;
        editor?.commands.focus('end');
      }}
    />
  );
}