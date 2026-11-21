import { Extension } from '@tiptap/core';

export const MAX_INDENT = 7;
export const INDENT_STEP_PX = 24;

export function clampIndent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, Math.trunc(value)));
}

function indentOfStyle(style: CSSStyleDeclaration | undefined): number {
  const raw = style?.marginLeft ?? '';
  const px = Number.parseFloat(raw);
  if (!Number.isFinite(px) || px <= 0) return 0;
  return clampIndent(Math.round(px / INDENT_STEP_PX));
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => indentOfStyle(element.style),
            renderHTML: (attributes) => {
              const level = clampIndent(attributes.indent);
              if (level === 0) return {};
              return { style: `margin-left: ${level * INDENT_STEP_PX}px` };
            },
            keepOnSplit: true,
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ commands, editor }) => {
          if (editor.isActive('listItem')) return commands.sinkListItem('listItem');
          if (editor.isActive('taskItem')) return commands.sinkListItem('taskItem');
          if (editor.isActive('blockquote')) {
            const current = clampIndent(editor.getAttributes('blockquote').indent);
            if (current >= MAX_INDENT) return false;
            return commands.updateAttributes('blockquote', { indent: current + 1 });
          }
          if (editor.isActive('heading')) {
            const current = clampIndent(editor.getAttributes('heading').indent);
            if (current >= MAX_INDENT) return false;
            return commands.updateAttributes('heading', { indent: current + 1 });
          }
          if (editor.isActive('paragraph')) {
            const current = clampIndent(editor.getAttributes('paragraph').indent);
            if (current >= MAX_INDENT) return false;
            return commands.updateAttributes('paragraph', { indent: current + 1 });
          }
          return false;
        },
      outdent:
        () =>
        ({ commands, editor }) => {
          if (editor.isActive('listItem')) return commands.liftListItem('listItem');
          if (editor.isActive('taskItem')) return commands.liftListItem('taskItem');
          if (editor.isActive('blockquote')) {
            const current = clampIndent(editor.getAttributes('blockquote').indent);
            if (current <= 0) return false;
            return commands.updateAttributes('blockquote', { indent: current - 1 });
          }
          if (editor.isActive('heading')) {
            const current = clampIndent(editor.getAttributes('heading').indent);
            if (current <= 0) return false;
            return commands.updateAttributes('heading', { indent: current - 1 });
          }
          if (editor.isActive('paragraph')) {
            const current = clampIndent(editor.getAttributes('paragraph').indent);
            if (current <= 0) return false;
            return commands.updateAttributes('paragraph', { indent: current - 1 });
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    };
  },
});
