import type { EditorOptions } from '@tiptap/core'
import type { Mark, Schema, Slice } from '@tiptap/pm/model'
import { Slice as PMSlice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { hasVisibleContent, sanitizeAndNormalize } from '../lib/sanitize'

type EditorProps = NonNullable<EditorOptions['editorProps']>

/**
 * `04-editor.md` §4. Rules 1–7, in the two shapes ProseMirror actually offers.
 *
 * **HTML flavour.** Rules 1–6 are `transformPastedHTML`: DOMPurify strips
 * everything outside the allowlist, presentational attributes, and every
 * `href`/`src`, then the DOM pass flattens table cells and deep nesting.
 * ProseMirror parses what survives.
 *
 * **Plain-text flavour.** Rule 7 is ours, in `handlePaste`, and it cannot be a
 * `transformPastedText`. ProseMirror treats that hook's return value as *text*:
 * it splits on newlines and wraps each piece in a paragraph, so returning
 * `<p>one<br>two</p>` inserts those characters literally. It also drops single
 * newlines instead of turning them into hard breaks, which is what rule 7 asks
 * for. Building the slice here is the only way to get both.
 *
 * Rule 8 needs `handlePaste` in either case: a paste that yields nothing must
 * insert nothing and leave the selection untouched. Returning `true` consumes
 * the event; returning `false` hands the event back to ProseMirror.
 */
export function buildPasteProps(): EditorProps {
  return {
    handlePaste: (view: EditorView, event: ClipboardEvent): boolean => {
      const clipboard = event.clipboardData
      if (clipboard === null) return false

      const html = clipboard.getData('text/html')
      if (html.length > 0) return !hasVisibleContent(sanitizeAndNormalize(html))

      const text = clipboard.getData('text/plain')
      if (text.trim().length === 0) return true

      const { state } = view
      const marks = state.storedMarks ?? state.selection.$from.marks()
      const slice = sliceFromPlainText(state.schema, text, marks)
      if (slice === null) return true

      view.dispatch(state.tr.replaceSelection(slice).scrollIntoView())
      return true
    },
    transformPastedHTML: (html: string): string => sanitizeAndNormalize(html),
  }
}

/** §4.1 rule 7: blank lines separate paragraphs, a single newline is a hard break. */
export function sliceFromPlainText(schema: Schema, text: string, marks: readonly Mark[]): Slice | null {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  if (blocks.length === 0) return null

  const paragraphType = schema.nodes.paragraph
  const hardBreakType = schema.nodes.hardBreak
  if (paragraphType === undefined || hardBreakType === undefined) return null

  const content = blocks.map((block) => {
    const parts: ReturnType<Schema['text']>[] = []
    block.split('\n').forEach((line, index) => {
      if (index > 0) parts.push(hardBreakType.create())
      if (line.length > 0) parts.push(schema.text(line, marks))
    })
    return paragraphType.create(null, parts)
  })

  const docType = schema.nodes.doc
  if (docType === undefined) return null

  return new PMSlice(docType.create(null, content).content, 0, 0)
}