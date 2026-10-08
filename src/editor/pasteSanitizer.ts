import type { EditorOptions } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { hasVisibleContent, sanitizeAndNormalize, textToParagraphs } from '../lib/sanitize'

type EditorProps = NonNullable<EditorOptions['editorProps']>

/**
 * `04-editor.md` §4. Rules 1–7 are enforced by the two transform hooks: DOMPurify
 * strips everything outside the allowlist, presentational attributes, and every
 * `href`/`src`, then the DOM pass flattens table cells and deep nesting.
 *
 * Rule 8 needs a `handlePaste`, because it is the one rule ProseMirror's parser
 * cannot infer: a paste that yields nothing must insert nothing and leave the
 * selection where it was. Returning `true` consumes the event; returning `false`
 * hands the already-sanitised markup back to ProseMirror, which does the insert.
 */
export function buildPasteProps(): EditorProps {
  return {
    handlePaste: (_view: EditorView, event: ClipboardEvent): boolean => {
      const clipboard = event.clipboardData
      if (clipboard === null) return false

      return !hasVisibleContent(sanitisedMarkupOf(clipboard))
    },
    transformPastedHTML: (html: string): string => sanitizeAndNormalize(html),
    transformPastedText: (text: string): string => textToParagraphs(text),
  }
}

function sanitisedMarkupOf(clipboard: DataTransfer): string {
  const html = clipboard.getData('text/html')
  if (html.length > 0) return sanitizeAndNormalize(html)

  return textToParagraphs(clipboard.getData('text/plain'))
}