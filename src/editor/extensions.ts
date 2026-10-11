import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TaskItemView } from './TaskItemView'

/* The node and mark set is fixed by `04-editor.md` §1.2. Node names must match
   the Rust validator in `src-tauri/src/doc/validate.rs`, because the document in
   SQLite is exactly what this schema produces. Adding a node here without adding
   it to that validator — and to §1.2 in the same commit — is a storage bug.

   `TaskItem` is extended, not configured, so the node view can be ours. The node
   name and the `checked` attribute are unchanged; only the rendering is. */

const TaskItemWithCheckbox = TaskItem.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView)
  },
})

/* `05-ui-ux.md` §7, editor-local bindings. TipTap merges every extension's
   shortcuts into one keymap, later extensions winning, so this extension has to
   take over `Tab` from StarterKit's `listKeymap` and cover the list cases itself.
   §7 requires `Tab` never to cycle focus rings out of the editor, which is why
   the paragraph case inserts two spaces instead of falling through. `Backspace`
   takes over one case from the default chain: an empty top-level paragraph
   after a divider deletes the divider at once — see `deleteHrBeforeEmptyBlock`.
   Everything else falls through untouched. */
const EditorShortcuts = Extension.create({
  name: 'editorShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.commands.toggleBold(),
      'Mod-i': () => this.editor.commands.toggleItalic(),
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-e': () => this.editor.commands.toggleCode(),
      Backspace: () => deleteHrBeforeEmptyBlock(this.editor),
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

/* Without this, Backspace in an empty paragraph after a divider deletes the
   paragraph first and leaves the divider node-selected but unstyled — the caret
   looks lost, and clicking away strands a trailing divider no caret can reach.
   Deleting the divider at once is safe for exactly this shape: the paragraph is
   empty so no text is lost, and anything else (text, nesting, another preceding
   node) falls through to the default select-then-delete chain. Top-level only,
   so an empty list item keeps its lift behaviour and code blocks are untouched. */
function deleteHrBeforeEmptyBlock(editor: Editor): boolean {
  const { selection } = editor.state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const $cursor = selection.$cursor
  if ($cursor === null || $cursor.parentOffset !== 0) return false
  if ($cursor.depth !== 1 || $cursor.parent.type.name !== 'paragraph') return false
  if ($cursor.parent.content.size !== 0) return false
  /* `nodeBefore` is empty at a block boundary, so the sibling is read off the
     parent instead: the paragraph's own index in the document, minus one. */
  const parentIndex = $cursor.index($cursor.depth - 1)
  const before = $cursor.node($cursor.depth - 1).maybeChild(parentIndex - 1)
  if (before?.type.name !== 'horizontalRule') return false
  /* The divider ends where the paragraph starts, so its start is one node
     size further back — not the cursor minus the size, which lands on the
     paragraph's own opening boundary and removes the paragraph instead. */
  const hrPos = $cursor.before($cursor.depth) - before.nodeSize
  editor.view.dispatch(editor.state.tr.delete(hrPos, hrPos + before.nodeSize).scrollIntoView())
  return true
}

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
  TaskItemWithCheckbox.configure({ nested: true }),
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