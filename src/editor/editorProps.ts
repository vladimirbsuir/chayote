import type { EditorOptions } from '@tiptap/core'
import { buildPasteProps } from './pasteSanitizer'

type EditorProps = NonNullable<EditorOptions['editorProps']>

/**
 * `04-editor.md` §2.1. `handleDrop: () => false` prevents ProseMirror from
 * attempting to drop nodes from outside the editor: v1 has no draggable block
 * handles, and an accidental drop of foreign content must not mutate the
 * document (`06-platform.md` §3.6 ignores external file drops for the same reason).
 *
 * Keyboard shortcuts live in the extension set, in `extensions.ts`, because they
 * need editor commands rather than a raw view. `05-ui-ux.md` §7 is the source.
 *
 * The accessibility attributes come from `05-ui-ux.md` §10: ProseMirror's
 * editable region is not fully accessible on its own, and `role="textbox"` plus
 * `aria-multiline` is the stated minimum for v1.
 */
export function buildEditorProps(): EditorProps {
  return {
    attributes: {
      class: 'note-editor',
      spellcheck: 'true',
      autocapitalize: 'sentences',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': 'Note content',
      'data-testid': 'note-editor',
    },
    handleDrop: () => false,
    ...buildPasteProps(),
  }
}