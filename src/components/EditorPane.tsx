import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import { AlertCircle, ArrowLeft, MoreHorizontal, RotateCw } from 'lucide-react';
import { notesApi } from '../lib/ipc';
import { useAutosave } from '../hooks/useAutosave';
import { openNote, selectSaveState, useEditorStore } from '../stores/editor';
import { qk } from '../queries/keys';
import { IconButton } from './IconButton';
import type { JsonDoc, Uuid } from '../types/note';
import type { Note, SaveNoteInput } from '../types/ipc';
import { NoteEditor } from '../editor/NoteEditor';
import { EditorStatusBar } from './EditorStatusBar';
import { EmptyState } from './EmptyState';

type EditorPaneProps = {
  noteId: Uuid | null;
  /** Bumped by the sidebar when the selection changes: a flush condition (§5.1). */
  selectionKey: string;
  /** Backs the mobile editor view's back affordance (§2.4). A no-op on desktop,
      where there is no view stack to pop. */
  onClose?: () => void;
};

const UNTITLED = 'Untitled';

/* The folder, tags, and pin state of the note the mounted editor holds. Held in
   a ref because they change only on a save, and read only from an event handler
   or an effect — never during render. */
type Active = {
  folderId: Uuid | null;
  tagIds: Uuid[];
  isPinned: boolean;
};

/**
 * `05-ui-ux.md` §4: owns the TipTap instance, the autosave state machine, and the
 * status bar. Everything it does is listed in `04-editor.md` §5.1 and §5.2.
 *
 * The document is never held in React state. TipTap owns it
 * (`10-conventions.md` §7) and the autosave controller reads it through the
 * editor at the moment of the write, which keeps a large document off the render
 * path entirely.
 */
export function EditorPane({ noteId, selectionKey, onClose }: EditorPaneProps) {
  const queryClient = useQueryClient();
  const activeRef = useRef<Active>({ folderId: null, tagIds: [], isPinned: false });
  const autosave = useAutosave((saved) => {
    queryClient.setQueryData(qk.note(saved.id), saved);
  });
  const saveState = useEditorStore((state) => selectSaveState(state, noteId));

  const note = useQuery({
    queryKey: qk.note(noteId ?? ''),
    queryFn: () => notesApi.get(noteId as Uuid),
    enabled: noteId !== null,
    retry: false,
  });

  const targetOf = useCallback((editor: Editor): SaveNoteInput | null => {
    if (noteId === null) return null;
    const active = activeRef.current;
    return {
      id: noteId,
      doc: editor.getJSON() as JsonDoc,
      folderId: active.folderId,
      tagIds: active.tagIds,
      isPinned: active.isPinned,
    };
  }, [noteId]);

  /* All three callbacks are stable for the lifetime of the editor instance.

     `NoteEditor` runs its setup effect on `[editor, onDispose, onReady]`, so a
     callback that changes identity re-runs that effect — which re-issues
     `onReady`, re-establishing the autosave baseline, and re-runs the cleanup,
     which flushes. Both land in the middle of a typing burst. The observable
     symptom is the selection resetting, so a mark applies to three characters
     instead of six and `Ctrl+Enter` toggles nothing: the keystroke arrives, the
     editor is re-baselined, and the selection is gone before the command runs.

     So none of these may depend on `note.data`. The data a save returns is read
     through `useEditorStore.getState()` inside `onReady` instead of closing over
     the query result, which is what keeps the identity stable across saves. */
  const onReady = useCallback(
    (editor: Editor): void => {
      const data = queryClient.getQueryData<Note>(qk.note(noteId ?? ''));
      if (data === undefined) return;
      activeRef.current = {
        folderId: data.folderId,
        tagIds: data.tags.map((tag) => tag.id),
        isPinned: data.isPinned,
      };
      autosave.setBaseline(targetOf(editor) as SaveNoteInput);
    },
    [autosave, noteId, queryClient, targetOf],
  );

  const onChange = useCallback(
    (editor: Editor): void => {
      const target = targetOf(editor);
      if (target !== null) autosave.noteChanged(target);
    },
    [autosave, targetOf],
  );

  const onDispose = useCallback((): void => {
    void autosave.flush();
  }, [autosave]);

  useEffect(() => {
    openNote(noteId);
  }, [noteId]);

  /* Flush condition: selection change. */
  useEffect(() => {
    void autosave.flush();
  }, [autosave, selectionKey]);

  /* Flush conditions: window blur and app background. The Android lifecycle
     event arrives as `visibilitychange`, because that is what the WebView
     reports; `06-platform.md` §4.5 wants the same effect. Editor blur reaches
     the same path through `NoteEditor`'s `onBlur`. */
  useEffect(() => {
    if (noteId === null) return;

    const flush = (): void => {
      void autosave.flush();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('blur', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [autosave, noteId]);

  /* `05-ui-ux.md` §7: Ctrl/Cmd+S is Save now, the escape hatch from the 800 ms
     debounce. Bound on the window rather than in the editor keymap because it
     must work with focus anywhere in the pane, and because the browser's own
     save dialog would otherwise fire under Playwright. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void autosave.flush();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [autosave]);

  if (noteId === null) {
    return (
      <Shell
        status={<EditorStatusBar title="" wordCount={0} saveState="saved" />}
        editor={
          <Centred>
            <EmptyState
              title="No note open"
              body="Pick a note from the list, or create one with Ctrl+N."
              icon={<AlertCircle className="icon i-20" aria-hidden="true" />}
            />
          </Centred>
        }
      />
    );
  }

  if (note.isError) {
    return <RecoveryScreen code={errorCodeOf(note.error)} onRetry={() => void note.refetch()} />;
  }

  const data = note.data;

  return (
    <Shell
      status={
        <EditorStatusBar
          title={data === undefined ? '' : displayTitle(data.title)}
          wordCount={data?.wordCount ?? 0}
          saveState={saveState}
        />
      }
      editor={
        data === undefined ? (
          <div className="flex-1" />
        ) : (
          <>
            {saveState === 'error' ? (
              <span className="sr-only" role="status">
                Your text is still on this device. The save will be retried automatically.
              </span>
            ) : null}
            <MobileEditorBar title={displayTitle(data.title)} onBack={onClose} />
            <NoteEditor
              key={data.id}
              doc={data.doc}
              editable
              onChange={onChange}
              onFlush={() => {
                void autosave.flush();
              }}
              onReady={onReady}
              onDispose={onDispose}
            />
          </>
        )
      }
    />
  );
}

function Shell({ editor, status }: { editor: ReactNode; status: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--surface)]" aria-label="Editor">
      {editor}
      {status}
    </section>
  );
}

function Centred({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8">{children}</div>;
}

/* `05-ui-ux.md` §2.4: the editor view on a small screen has its own top bar,
   because it needs a back affordance and the note title, and because it does not
   reuse the desktop top bar.

   `onBack` is `undefined` on desktop, and that is load-bearing rather than a
   shortcut: the bar is not rendered at all there. Hiding it with `md:hidden`
   would leave its two icon buttons in the tab order and in the layout above a
   `display: none` boundary, which moves focus out of the editor — the caret is
   in ProseMirror, not in the button, so `Ctrl+Enter` then toggles nothing. Not
   rendering is also the honest answer: there is no back affordance to offer. */
function MobileEditorBar({ title, onBack }: { title: string; onBack?: () => void }) {
  if (onBack === undefined) return null;
  return (
    <header className="flex h-[52px] flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2">
      <IconButton label="Back to list" onClick={onBack} size="mobile">
        <ArrowLeft className="icon i-24" aria-hidden="true" />
      </IconButton>
      <span className="flex-1 truncate text-[14px] font-semibold">{title}</span>
      <IconButton label="More" size="mobile">
        <MoreHorizontal className="icon i-24" aria-hidden="true" />
      </IconButton>
    </header>
  );
}

/* `04-editor.md` §8.4 — a deliberate dead end, not an editor. The stored version
   was never touched, so "Try again" is honest. */
function RecoveryScreen({ code, onRetry }: { code: string; onRetry: () => void }) {
  return (
    <Shell
      status={<EditorStatusBar title="" wordCount={0} saveState="saved" />}
      editor={
        <Centred>
          <EmptyState
            title="This note could not be opened"
            body={
              code === 'DOC_INVALID'
                ? 'The stored document does not match the schema, so the saved version was kept untouched.'
                : 'The note could not be read from the database.'
            }
            icon={<AlertCircle className="icon i-20" aria-hidden="true" />}
            tone="warning"
            action={
              <button
                type="button"
                onClick={onRetry}
                className="mt-1 flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)]"
              >
                <RotateCw className="icon i-16" aria-hidden="true" />
                Try again
              </button>
            }
          />
        </Centred>
      }
    />
  );
}

function displayTitle(title: string): string {
  return title.length === 0 ? UNTITLED : title;
}

function errorCodeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'INTERNAL';
  const { code } = error;
  return typeof code === 'string' ? code : 'INTERNAL';
}