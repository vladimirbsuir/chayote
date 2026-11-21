import type { EditorOptions } from '@tiptap/core'
import { buildPasteProps } from './pasteSanitizer'

type EditorProps = NonNullable<EditorOptions['editorProps']>

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