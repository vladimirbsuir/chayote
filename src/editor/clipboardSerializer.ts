import type { EditorOptions } from '@tiptap/core'

export const CLIPBOARD_CORE_OPTIONS: Pick<EditorOptions, 'coreExtensionOptions'> = {
  coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: '\n\n' } },
}