import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'

/* The node and mark set is fixed by `04-editor.md` §1.2. Node names must match
   the Rust validator in `src-tauri/src/doc/validate.rs`, because the document in
   SQLite is exactly what this schema produces. Adding a node here without adding
   it to that validator — and to §1.2 in the same commit — is a storage bug. */

/* `05-ui-ux.md` §7, editor-local bindings. TipTap merges every extension's
   shortcuts into one keymap, later extensions winning, so this extension has to
   take over `Tab` from StarterKit's `listKeymap` and cover the list cases itself.
   §7 requires `Tab` never to cycle focus rings out of the editor, which is why
   the paragraph case inserts two spaces instead of falling through. */
const EditorShortcuts = Extension.create({
  name: 'editorShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.commands.toggleBold(),
      'Mod-i': () => this.editor.commands.toggleItalic(),
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-e': () => this.editor.commands.toggleCode(),
      'Mod-Enter': () =>
        this.editor.commands.first(({ commands }) => [
          () =>
            this.editor.isActive('taskItem') &&
            commands.updateAttributes('taskItem', {
              checked: this.editor.getAttributes('taskItem').checked !== true,
            }),
        ]),
      Tab: () =>
        this.editor.commands.first(({ commands }) => [
          () => this.editor.isActive('codeBlock') && commands.insertContent('  '),
          () => this.editor.isActive('taskItem') && commands.sinkListItem('taskItem'),
          () => this.editor.isActive('listItem') && commands.sinkListItem('listItem'),
          () => commands.insertContent('  '),
        ]),
      'Shift-Tab': () =>
        this.editor.commands.first(({ commands }) => [
          () => this.editor.isActive('taskItem') && commands.liftListItem('taskItem'),
          () => this.editor.isActive('listItem') && commands.liftListItem('listItem'),
          () => false,
        ]),
    }
  },
})

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: { HTMLAttributes: { class: 'code-block' } },
    dropcursor: { color: 'var(--accent)', width: 2 },
    gapcursor: false,
    link: false,
    trailingNode: false,
    undoRedo: { depth: 200, newGroupDelay: 500 },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Typography,
  EditorShortcuts,
  Placeholder.configure({
    placeholder: ({ node }) =>
      node.type.name === 'heading' ? 'Heading' : 'Write something…',
    showOnlyWhenEditable: true,
    showOnlyCurrent: true,
  }),
]

export { EditorShortcuts }