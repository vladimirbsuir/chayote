import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'

export const MAX_DOC_DEPTH = 12

function height(node: PMNode): number {
  let tallest = 0
  node.forEach((child) => {
    tallest = Math.max(tallest, height(child))
  })
  return tallest + 1
}

export function exceedsDepth(doc: PMNode, from: number, to: number): boolean {
  const start = Math.max(0, from)
  const end = Math.min(doc.content.size, Math.max(start, to))
  let deep = false
  doc.nodesBetween(start, end, (node, pos) => {
    if (deep) return false
    const depth = doc.resolve(pos).depth + 1
    const enclosesChange = pos < start && pos + node.nodeSize > end
    if (enclosesChange) {
      deep = depth > MAX_DOC_DEPTH
      return !deep
    }
    deep = depth - 1 + height(node) > MAX_DOC_DEPTH
    return false
  })
  return deep
}

export function transactionTooDeep(tr: Transaction): boolean {
  if (!tr.docChanged) return false
  let deep = false
  tr.steps.forEach((step, index) => {
    if (deep) return
    const rest = tr.mapping.slice(index + 1)
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (deep) return
      const from = rest.map(newStart, -1)
      const to = rest.map(newEnd, 1)
      deep = exceedsDepth(tr.doc, from, to)
    })
  })
  return deep
}

export const DepthGuard = Extension.create({
  name: 'depthGuard',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('depthGuard'),
        filterTransaction: (tr) => !transactionTooDeep(tr),
      }),
    ]
  },
})
