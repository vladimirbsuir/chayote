import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Redo2,
  SeparatorHorizontal,
  SquareCode,
  Strikethrough,
  Undo2,
} from 'lucide-react';

type FormattingToolbarProps = {
  editor: Editor | null;
  variant?: 'desktop' | 'mobile';
};

/* `01-product.md` §5.1 promises a WYSIWYG block editor with text styles, and
   `05-ui-ux.md` §7 binds the four marks to shortcuts — but until this row
   nothing visible reached them, which §1 principle 4 ("every shortcut has a
   visible, discoverable control") forbids. One static row above the content,
   the same component on desktop and mobile: a bubble menu is `04-editor.md`
   §10's deferred item and stays deferred, and a selection-only menu is
   undiscoverable on touch where a long-press already opens the row menus. */
export function FormattingToolbar({
  editor,
  variant = 'desktop',
}: FormattingToolbarProps): React.ReactElement {
  /* `isActive` and `can` read editor state, which lives outside React: without
     a subscription the pressed state freezes at the mount value. One counter
     bumped on both events ProseMirror emits for a state change. */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (editor === null) return;
    const bump = (): void => {
      setTick((n) => n + 1);
    };
    editor.on('transaction', bump);
    editor.on('selectionUpdate', bump);
    return () => {
      editor.off('transaction', bump);
      editor.off('selectionUpdate', bump);
    };
  }, [editor]);

  const mobile = variant === 'mobile';
  const editable = editor?.isEditable ?? false;

  /* Read once per render so the buttons below stay declarations rather than
     sixteen copies of the same optional chain. `?? false` turns the nullable
     read into a plain boolean, which is what the strict boolean rules want. */
  const activeBold = editor?.isActive('bold') ?? false;
  const activeItalic = editor?.isActive('italic') ?? false;
  const activeStrike = editor?.isActive('strike') ?? false;
  const activeCode = editor?.isActive('code') ?? false;
  const activeH1 = editor?.isActive('heading', { level: 1 }) ?? false;
  const activeH2 = editor?.isActive('heading', { level: 2 }) ?? false;
  const activeH3 = editor?.isActive('heading', { level: 3 }) ?? false;
  const activeBullet = editor?.isActive('bulletList') ?? false;
  const activeOrdered = editor?.isActive('orderedList') ?? false;
  const activeTask = editor?.isActive('taskList') ?? false;
  const activeQuote = editor?.isActive('blockquote') ?? false;
  const activeCodeBlock = editor?.isActive('codeBlock') ?? false;

  const canBold = editor?.can().toggleBold() ?? false;
  const canItalic = editor?.can().toggleItalic() ?? false;
  const canStrike = editor?.can().toggleStrike() ?? false;
  const canCode = editor?.can().toggleCode() ?? false;
  const canH1 = editor?.can().toggleHeading({ level: 1 }) ?? false;
  const canH2 = editor?.can().toggleHeading({ level: 2 }) ?? false;
  const canH3 = editor?.can().toggleHeading({ level: 3 }) ?? false;
  const canBullet = editor?.can().toggleBulletList() ?? false;
  const canOrdered = editor?.can().toggleOrderedList() ?? false;
  const canTask = editor?.can().toggleTaskList() ?? false;
  const canQuote = editor?.can().toggleBlockquote() ?? false;
  const canCodeBlock = editor?.can().toggleCodeBlock() ?? false;
  const canHr = editor?.can().setHorizontalRule() ?? false;
  const canUndo = editor?.can().undo() ?? false;
  const canRedo = editor?.can().redo() ?? false;

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      data-testid="formatting-toolbar"
      className={`flex flex-none items-center gap-0.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] ${
        mobile ? 'h-12 px-1' : 'h-10 px-2'
      }`}
    >
      <ToolButton
        mobile={mobile}
        testId="format-bold"
        label="Bold"
        title="Bold (Ctrl+B)"
        pressed={activeBold}
        disabled={!editable || !canBold}
        onRun={() => editor?.chain().focus().toggleBold().run()}
        icon={<Bold className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-italic"
        label="Italic"
        title="Italic (Ctrl+I)"
        pressed={activeItalic}
        disabled={!editable || !canItalic}
        onRun={() => editor?.chain().focus().toggleItalic().run()}
        icon={<Italic className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-strike"
        label="Strikethrough"
        title="Strikethrough (Ctrl+Shift+X)"
        pressed={activeStrike}
        disabled={!editable || !canStrike}
        onRun={() => editor?.chain().focus().toggleStrike().run()}
        icon={<Strikethrough className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-code"
        label="Inline code"
        title="Inline code (Ctrl+E)"
        pressed={activeCode}
        disabled={!editable || !canCode}
        onRun={() => editor?.chain().focus().toggleCode().run()}
        icon={<Code className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <Separator />
      <ToolButton
        mobile={mobile}
        testId="format-h1"
        label="Heading 1"
        title="Heading 1"
        pressed={activeH1}
        disabled={!editable || !canH1}
        onRun={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        icon={<Heading1 className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-h2"
        label="Heading 2"
        title="Heading 2"
        pressed={activeH2}
        disabled={!editable || !canH2}
        onRun={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        icon={<Heading2 className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-h3"
        label="Heading 3"
        title="Heading 3"
        pressed={activeH3}
        disabled={!editable || !canH3}
        onRun={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        icon={<Heading3 className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <Separator />
      <ToolButton
        mobile={mobile}
        testId="format-bullet"
        label="Bullet list"
        title="Bullet list"
        pressed={activeBullet}
        disabled={!editable || !canBullet}
        onRun={() => editor?.chain().focus().toggleBulletList().run()}
        icon={<List className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-ordered"
        label="Ordered list"
        title="Ordered list"
        pressed={activeOrdered}
        disabled={!editable || !canOrdered}
        onRun={() => editor?.chain().focus().toggleOrderedList().run()}
        icon={<ListOrdered className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-task"
        label="Task list"
        title="Task list"
        pressed={activeTask}
        disabled={!editable || !canTask}
        onRun={() => editor?.chain().focus().toggleTaskList().run()}
        icon={<ListTodo className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <Separator />
      <ToolButton
        mobile={mobile}
        testId="format-quote"
        label="Blockquote"
        title="Blockquote"
        pressed={activeQuote}
        disabled={!editable || !canQuote}
        onRun={() => editor?.chain().focus().toggleBlockquote().run()}
        icon={<Quote className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-codeblock"
        label="Code block"
        title="Code block"
        pressed={activeCodeBlock}
        disabled={!editable || !canCodeBlock}
        onRun={() => editor?.chain().focus().toggleCodeBlock().run()}
        icon={<SquareCode className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-hr"
        label="Horizontal rule"
        title="Horizontal rule"
        disabled={!editable || !canHr}
        onRun={() => editor?.chain().focus().setHorizontalRule().run()}
        icon={
          <SeparatorHorizontal className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />
        }
      />
      <Separator />
      <ToolButton
        mobile={mobile}
        testId="format-undo"
        label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!editable || !canUndo}
        onRun={() => editor?.chain().focus().undo().run()}
        icon={<Undo2 className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
      <ToolButton
        mobile={mobile}
        testId="format-redo"
        label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!editable || !canRedo}
        onRun={() => editor?.chain().focus().redo().run()}
        icon={<Redo2 className={`icon ${mobile ? 'i-20' : 'i-18'}`} aria-hidden="true" />}
      />
    </div>
  );
}

function Separator(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-5 w-px flex-none bg-[var(--border)]"
    />
  );
}

function ToolButton({
  mobile,
  testId,
  label,
  title,
  pressed,
  disabled,
  onRun,
  icon,
}: {
  mobile: boolean;
  testId: string;
  label: string;
  title: string;
  pressed?: boolean;
  disabled: boolean;
  onRun: () => void;
  icon: ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={title}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      disabled={disabled}
      onMouseDown={(event) => {
        /* A mousedown on the button would blur the editor before the click
           runs, losing the selection the mark applies to. Preventing the
           default keeps the caret where it is; the chain still focuses, which
           covers touch where no mousedown precedes the tap. */
        event.preventDefault();
      }}
      onClick={onRun}
      className={`grid flex-none place-items-center rounded-[var(--r-input)] border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        mobile ? 'h-11 w-11' : 'h-8 w-8'
      } ${
        pressed === true
          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]'
      }`}
    >
      {icon}
    </button>
  );
}
