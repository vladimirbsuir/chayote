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
import { Indent } from './indent'

const TaskItemWithCheckbox = TaskItem.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView)
  },
})

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

function deleteHrBeforeEmptyBlock(editor: Editor): boolean {
  const { selection } = editor.state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const $cursor = selection.$cursor
  if ($cursor === null || $cursor.parentOffset !== 0) return false
  if ($cursor.depth !== 1 || $cursor.parent.type.name !== 'paragraph') return false
  if ($cursor.parent.content.size !== 0) return false
  const parentIndex = $cursor.index($cursor.depth - 1)
  const before = $cursor.node($cursor.depth - 1).maybeChild(parentIndex - 1)
  if (before?.type.name !== 'horizontalRule') return false
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
  Indent,
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