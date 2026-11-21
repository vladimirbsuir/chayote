import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Check } from 'lucide-react';

export function TaskItemView({ node, updateAttributes }: NodeViewProps) {
  const checked = node.attrs.checked === true;
  const text = node.textContent.length === 0 ? 'empty task item' : node.textContent;
  const label = `Task item: ${text}${checked ? ', done' : ''}`;

  return (
    <NodeViewWrapper as="li" className="note-task-item" data-checked={String(checked)}>
      <label className="note-task-item__box" contentEditable={false}>
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