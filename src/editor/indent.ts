import { Extension } from '@tiptap/core';

/* `04-editor.md` §1.2: `paragraph`, `heading` and `blockquote` carry an
   `indent` level of 0–7, rendered as a left margin in 24 px steps — the same
   step as the list padding in `editor.css`, so indented text aligns with
   list text. Lists themselves indent structurally (nesting), never through
   this attribute: inside a `listItem`/`taskItem` the commands below dispatch
   to sink/lift instead. A cursor inside a quote indents the whole quote,
   not the inner paragraph. */

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
          /* Nesting first: a list never gains a margin, it gains depth. A
             nested ordered list restarts at 1 by construction — no custom
             `start` handling exists here. */
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

  /* Word/Google Docs convention; nothing in `05-ui-ux.md` §7 uses these two.
     `Tab`/`Shift+Tab` keep their §7 meaning (spaces in prose, sink/lift in
     lists) — these are the discoverable-via-tooltip secondary path beside
     the toolbar buttons. */
  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    };
  },
});
