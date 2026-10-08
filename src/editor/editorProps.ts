import type { EditorOptions } from '@tiptap/core'
import { buildPasteProps } from './pasteSanitizer'

type EditorProps = NonNullable<EditorOptions['editorProps']>

/**
 * `04-editor.md` §2.1.
 *
 * Keyboard shortcuts live in the extension set, in `extensions.ts`, because they
 * need editor commands rather than a raw view. `05-ui-ux.md` §7 is the source.
 *
 * The accessibility attributes come from `05-ui-ux.md` §10: ProseMirror's
 * editable region is not fully accessible on its own, and `role="textbox"` plus
 * `aria-multiline` is the stated minimum for v1.
 *
 * Every drop is refused, and the event is cancelled. v1 has no draggable block
 * handles, so there is no legitimate internal drag to preserve, and
 * `06-platform.md` §3.6 requires an external file drop to change nothing — not
 * to insert content, not to navigate the window away.
 *
 * Note the polarity: returning `false` from a ProseMirror `handleDrop` means "not
 * handled", which lets the browser default through. Returning `true` is what
 * blocks it. §2.1's own sketch had this backwards and has been corrected.
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
    handleDrop: (_view, event) => {
      event.preventDefault()
      return true
    },
    ...buildPasteProps(),
  }
}