import type { EditorOptions } from '@tiptap/core'

/**
 * `04-editor.md` §4.3: copy and cut emit plain text with a blank line between
 * blocks, so pasting into another app produces something readable rather than one
 * run-on line.
 *
 * ProseMirror's `clipboardTextSerializer` reads `toText` from each node in the
 * schema and joins the results with `blockSeparator`. In TipTap 3 it is a *core*
 * extension rather than a member of the extension array, so this file exports the
 * `coreExtensionOptions` fragment instead of an `Extension`.
 *
 * No checkbox glyph is emitted for task items. The derived `plain_text` in
 * `03-data-model.md` §4.2 carries task text and nothing else, and a glyph here
 * would come back as literal characters when pasted into Chayote.
 */
export const CLIPBOARD_CORE_OPTIONS: Pick<EditorOptions, 'coreExtensionOptions'> = {
  coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: '\n\n' } },
}