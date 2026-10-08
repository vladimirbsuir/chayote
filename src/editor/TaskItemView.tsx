import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Check } from 'lucide-react';

/* The task item is the one place in the editor where an icon sits inside content
   rather than beside it. ADR-015 and `05-ui-ux.md` §3.3 give the `check` icon to
   exactly this case and permit `fill: currentColor` for the checked box, because
   a filled state reads faster than an outline at this size.

   A ProseMirror node view is the only way to get a Lucide React component into
   the document; the alternative is the browser's native checkbox, which ignores
   the border, the radius, and the token colours, and renders blue regardless of
   the accent. `prototype/index.html` is the visual reference for what this should
   look like.

   The input stays in the DOM, visually hidden and focusable, so the item is
   reachable and operable from the keyboard and announced by a screen reader. The
   box beside it is a label, so clicking anywhere on it toggles. */

export function TaskItemView({ node, updateAttributes }: NodeViewProps) {
  const checked = node.attrs.checked === true;
  const text = node.textContent.length === 0 ? 'empty task item' : node.textContent;
  const label = `Task item: ${text}${checked ? ', done' : ''}`;

  return (
    <NodeViewWrapper as="li" className="note-task-item" data-checked={String(checked)}>
      <label className="note-task-item__box">
        <input
          type="checkbox"
          checked={checked}
          aria-label={label}
          onChange={(event) => {
            updateAttributes({ checked: event.target.checked });
          }}
        />
        <span className="note-task-item__mark" aria-hidden="true">
          {checked ? <Check className="icon i-16" /> : null}
        </span>
      </label>
      <NodeViewContent className="note-task-item__content" />
    </NodeViewWrapper>
  );
}