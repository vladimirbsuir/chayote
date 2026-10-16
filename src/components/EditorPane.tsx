import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import { AlertCircle, ArrowLeft, RotateCw } from 'lucide-react';
import { notesApi, tagsApi } from '../lib/ipc';
import { registerSyncFlusher } from '../lib/syncFlush';
import { useAutosave } from '../hooks/useAutosave';
import { isLetterShortcut } from '../lib/shortcuts';
import { useFolders, folderNamesById } from '../hooks/useFolders';
import { useTags } from '../hooks/useTags';
import { useTogglePin } from '../hooks/useTogglePin';
import { openNote, selectSaveState, useEditorStore } from '../stores/editor';
import { qk } from '../queries/keys';
import { IconButton } from './IconButton';
import { EditorOverflowMenu } from './EditorOverflowMenu';
import type { JsonDoc, Uuid } from '../types/note';
import type { Note, NoteFilter, NoteSummary, SaveNoteInput } from '../types/ipc';
import { applySaveToList } from '../lib/noteOrder';
import { NoteEditor } from '../editor/NoteEditor';
import { EditorStatusBar } from './EditorStatusBar';
import { FormattingToolbar } from './FormattingToolbar';
import { EmptyState } from './EmptyState';
import { summaryOf } from './summaryOf';
import { FolderPicker, TagEditor } from './StatusPopovers';
import { popoverPlacement } from './popoverPlacement';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';

type EditorPaneProps = {
  noteId: Uuid | null;
  /** Bumped by the sidebar when the selection changes: a flush condition (§5.1). */
  selectionKey: string;
  /** Backs the mobile editor view's back affordance (§2.4). A no-op on desktop,
      where there is no view stack to pop. */
  onClose?: () => void;
  /** `05-ui-ux.md` §2.4: the mobile editor bar carries "a delete action". Undefined on
      desktop, where the note row's own menu owns it and two controls for one verb is
      the duplication §6.2 warns about. */
  onTrash?: () => void;
};

const UNTITLED = 'Untitled';

/* The status bar renders on the no-note and recovery screens too, where there is no
   note to point a picker at. */
const NOOP = (): void => {};

const EMPTY_FOLDERS: FolderNode[] = [];
const EMPTY_TAGS: TagWithCount[] = [];

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
export function EditorPane({ noteId, selectionKey, onClose, onTrash }: EditorPaneProps) {
  const queryClient = useQueryClient();
  const activeRef = useRef<Active>({ folderId: null, tagIds: [], isPinned: false });
  /* Mirrors `activeRef.isPinned` as state. The status-bar control has to re-render
     when the pin changes, and a ref write renders nothing — the button would keep
     showing the state the note had when it opened. */
  const [pinned, setPinned] = useState(false);
  /* Mirrors `activeRef.folderId` and `.tagIds` as state, for the same reason
     `pinned` exists: the status-bar controls must re-render when these change, and a
     ref write renders nothing.

     They are also the pending values — what the next autosave will write — not what
     the database holds. Showing the saved state here would mean a click appears to do
     nothing until the debounce commits, which is the same lie the pin had. */
  const [folderId, setFolderId] = useState<Uuid | null>(null);
  const [tagIds, setTagIds] = useState<Uuid[]>([]);

  /* The mounted TipTap instance. Held so a status-bar change can be turned into a
     save target without the editor having to be a piece of component state: the
     document belongs to TipTap (`10-conventions.md` §7) and nothing else reads it
     during render. */
  const editorRef = useRef<Editor | null>(null);
  /* The serialised document the mounted TipTap instance was built from. The
     editor is keyed by note id alone, so a saved document that changes
     underneath it — a sync pull for a note opened from stale cache, or a
     conflict resolution — would otherwise never reach the screen: the list
     preview updates from the query cache while TipTap keeps showing the old
     text until the note is reopened. `contentEpoch` below remounts the editor
     when the saved document moves and there is nothing unsaved to lose. */
  const loadedDocRef = useRef<string | null>(null);
  const [contentEpoch, setContentEpoch] = useState(0);
  /* The same instance as state for the formatting toolbar. The toolbar reads
     `isActive`/`can` during render, and a ref write renders nothing — without
     the mirror its pressed states would freeze at the mount value. Set and
     cleared beside the ref so both always point at the mounted editor. */
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null);

  /* `04-editor.md` §9: folder and tags are "click to change". Which of the two
     popovers is open, and the element each was opened from — the menu needs the
     anchor to place itself, and holding the element rather than the coordinates means
     a re-render between the click and the measurement still measures the right thing.
     One slot rather than two, because a 28 px row cannot sensibly have both open and
     two flags would only be a way to end up with both. */
  const [popover, setPopover] = useState<{
    kind: 'folder' | 'tags';
    anchor: HTMLElement;
    placement: { top: number; left: number };
  } | null>(null);
  const autosave = useAutosave((saved) => {
    /* An own save is not an external change: the editor already holds this
       document, so adopt it as the baseline the remount effect compares
       against — otherwise every save would remount the editor and drop undo
       history and caret. */
    loadedDocRef.current = JSON.stringify(saved.doc);
    /* `10-conventions.md` §7: a save does not invalidate the list, because the
       response already carries the fresh summary — so the entry is patched in
       place. `updatedAt` and `isPinned` both move with a save (the pin through
       `notes_set_pinned`, the timestamp through every write), and the list orders
       by exactly those two, so patching only the open note's own cache entry would
       leave a card showing a pin the note no longer has until the next refetch. */
    queryClient.setQueryData(qk.note(saved.id), saved);
    /* The save moved `updated_at`, which is the list ordering: patching the row
       without re-sorting strands the edited note wherever it was.
       `applySaveToList` re-sorts every live selection and leaves trash
       (ordered by `deleted_at`) alone; search pages live under a different key
       prefix and are never enumerated here. Enumerated with `getQueriesData`
       rather than patched with `setQueriesData` because that updater never sees
       the key — only the data — so per-selection branching inside it cannot
       know which list it holds. */
    const patched = summaryOf(saved);
    for (const [key, existing] of queryClient.getQueriesData<NoteSummary[]>({
      queryKey: ['notes'],
    })) {
      if (!Array.isArray(existing)) continue;
      const filter = key[1] as NoteFilter | undefined;
      queryClient.setQueryData(key, applySaveToList(existing, patched, filter?.kind));
    }
  });
  const saveState = useEditorStore((state) => selectSaveState(state, noteId));

  const note = useQuery({
    queryKey: qk.note(noteId ?? ''),
    queryFn: () => notesApi.get(noteId as Uuid),
    enabled: noteId !== null,
    retry: false,
  });

  /* Folders and tags are already loaded by the sidebar, so these two queries hit the
     cache rather than the backend — `10-conventions.md` §8, "folders and tags load
     once and are cached; they change rarely". Read here because the status bar is
     this pane's concern and threading them down as props would put data the shell
     owns into a prop it passes to two children. */
  const { folders } = useFolders();
  const { tags } = useTags();

  const folderNames = useMemo(() => folderNamesById(folders ?? []), [folders]);
  const tagNames = useMemo(
    () => (tags ?? []).filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name),
    [tags, tagIds],
  );

  const targetOf = useCallback(
    (editor: Editor): SaveNoteInput | null => {
      if (noteId === null) return null;
      const active = activeRef.current;
      return {
        id: noteId,
        doc: editor.getJSON() as JsonDoc,
        folderId: active.folderId,
        tagIds: active.tagIds,
        isPinned: active.isPinned,
      };
    },
    [noteId],
  );

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
      loadedDocRef.current = JSON.stringify(data.doc);
      const ids = data.tags.map((tag) => tag.id);
      activeRef.current = {
        folderId: data.folderId,
        tagIds: ids,
        isPinned: data.isPinned,
      };
      /* The mirrors have to follow the load too, or a note opened after a change made
         elsewhere would show the previous note's state. */
      setPinned(data.isPinned);
      setFolderId(data.folderId);
      setTagIds(ids);
      editorRef.current = editor;
      setToolbarEditor(editor);
      autosave.setBaseline(targetOf(editor) as SaveNoteInput);
    },
    [autosave, noteId, queryClient, targetOf],
  );

  /* The save target for whatever is on screen now, or `null` before the editor has
     mounted. Shared by the document path and the folder/tag path so both read the
     document at the moment of the write rather than a captured copy — a captured
     document is what makes a serialisation comparison skip a real change. */
  const saveTarget = useCallback((): SaveNoteInput | null => {
    const editor = editorRef.current;
    return editor === null ? null : targetOf(editor);
  }, [targetOf]);

  const onChange = useCallback(
    (editor: Editor): void => {
      const target = targetOf(editor);
      if (target !== null) autosave.noteChanged(target);
    },
    [autosave, targetOf],
  );

  const onDispose = useCallback((): void => {
    setToolbarEditor(null);
    void autosave.flush();
  }, [autosave]);

  /* Folder and tag changes go through the autosave rather than through their own
     commands. `notes_save` is the one write that carries `folderId`, `tagIds` and
     the document together, and `04-editor.md` §5.1 makes the debounce the reason a
     200 ms debounce on the status bar would be wrong: the user may be mid-sentence,
     and a folder change must not force the document out of TipTap or reset undo
     history. Flushing immediately would do exactly that.

     What does not go through it is `isPinned`, which has a command of its own — see
     `togglePin`. */
  const changeFolder = useCallback(
    (next: Uuid | null): void => {
      setFolderId(next);
      activeRef.current = { ...activeRef.current, folderId: next };
      const target = saveTarget();
      if (target !== null) autosave.schedule(target);
    },
    [autosave, saveTarget],
  );

  const toggleTag = useCallback(
    (tagId: Uuid): void => {
      const current = activeRef.current.tagIds;
      const next = current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId];
      setTagIds(next);
      activeRef.current = { ...activeRef.current, tagIds: next };
      const target = saveTarget();
      if (target !== null) autosave.schedule(target);
    },
    [autosave, saveTarget],
  );

  /* `05-ui-ux.md` §6.3a: `Ctrl/Cmd+D` toggles the pin of the open note.

     Deliberately *not* routed through the autosave debounce. `04-editor.md` §5.1
     makes the serialised document the comparison, so a write that changes only
     `isPinned` would be judged unchanged and skipped — and the pin would move in
     the UI and never reach the database. It is a metadata write, so it goes
     straight to `notes_set_pinned`.

     The important half is `activeRef`: the autosave target carries `isPinned`, so
     without updating it the next keystroke would save the *old* flag and silently
     undo the pin the user just pressed. One ref write, and the next save carries
     the new value. */
  const closePopover = (): void => {
    setPopover(null);
  };

  /* §6.4: "A tag is created by typing a new name into the tag editor; existing names
     complete. Case-insensitive match, normalised to the first-created spelling."
     The backend returns the existing row when the name matches, so a case-insensitive
     duplicate lands on the original tag rather than a second copy. */
  const createTag = useCallback(
    async (name: string): Promise<void> => {
      const created = await tagsApi.create(name);
      toggleTag(created.id);
      /* Two writes, in this order, and the order is the point.

         The new tag is in the library as soon as it is created — even at a
         zero count (ADR-021) — but attaching it to the note is the debounced
         write, so the save is flushed here rather than leaving the new name
         unattached for 800 ms. Then the refetch: the status bar resolves tag
         names out of the cached list, which is stale until invalidated, and
         without the new tag in it the note would carry a tag it cannot name. */
      await autosave.flush();
      await queryClient.invalidateQueries({ queryKey: qk.tags() });
    },
    [autosave, queryClient, toggleTag],
  );

  /* Pinning goes through `useTogglePin`, the same hook the note card uses, rather
     than calling `notesApi.setPinned` directly.

     M7 found this on a device: the editor pinned the note, the editor's own state
     followed, and the **Pinned filter still said zero notes**. The card path patches
     every `['notes']` cache and invalidates the list, because a pin reorders every
     list in the app; the editor's copy did neither, so every list kept serving a
     `is_pinned` of 0. One write, one cache policy — two implementations of "set the
     pin" is how they drift apart. The local mirror is still set first so the editor
     reacts on the keystroke rather than after the round trip. */
  const { togglePin: writePin } = useTogglePin();

  const togglePin = useCallback((): void => {
    if (noteId === null) return;
    const next = !pinned;
    setPinned(next);
    activeRef.current = { ...activeRef.current, isPinned: next };
    writePin(noteId, next);
  }, [noteId, pinned, writePin]);

  useEffect(() => {
    openNote(noteId);
  }, [noteId]);

  /* Flush condition: selection change. */
  useEffect(() => {
    void autosave.flush();
  }, [autosave, selectionKey]);

  /* Phase-E open-editor guard: every sync entry point flushes through this
     before draining, so the pull arbitrates on the user's actual document
     rather than on the row beneath unsaved typing. Registered per mount —
     exactly one pane is ever mounted — and cleared on unmount. */
  useEffect(() => {
    registerSyncFlusher(() => autosave.flush());
    return () => {
      registerSyncFlusher(null);
    };
  }, [autosave]);

  /* A saved document that changed under the mounted editor — a sync pull that
     landed after the note opened from a stale cache entry, or a conflict
     resolution — remounts the editor so the screen shows what the list
     already shows. Only while clean: with unsaved typing (or a save in
     flight) the user's keystrokes win and the editor is left alone. The
     resolve path flushes first (`App`), so Use-theirs on the open note still
     lands immediately. Metadata-only writes keep the serialised document
     identical and never remount: pinning while typing keeps caret and undo. */
  const serverDocJson = note.data === undefined ? null : JSON.stringify(note.data.doc);
  useEffect(() => {
    if (note.data === undefined || serverDocJson === null) return;
    if (saveState !== 'saved') return;
    if (loadedDocRef.current === serverDocJson) return;
    loadedDocRef.current = serverDocJson;
    setContentEpoch((epoch) => epoch + 1);
  }, [note.data, serverDocJson, saveState]);

  /* First paint waits for fresh data. Mounting TipTap on a stale cache entry
     flashes the old text until the mount refetch lands — visible after every
     sync that changed the note. Local reads settle in milliseconds, so the
     placeholder is imperceptible; a failed refetch still falls back to the
     cached document rather than a blank screen. Background refetches later
     never hide the editor: only the newly opened note waits.
     Adjusted during render rather than in an effect, where it would be a
     cascading render (`10-conventions.md` §8) — the same pattern the settings
     dialog uses for external accent changes. */
  const [freshId, setFreshId] = useState<Uuid | null>(null);
  if (freshId !== noteId) {
    if (noteId === null || note.data === undefined || note.isFetching) {
      if (freshId !== null) setFreshId(null);
    } else {
      setFreshId(noteId);
    }
  }
  const ready = freshId === noteId && note.data !== undefined;

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
      if (!(event.ctrlKey || event.metaKey)) return;

      if (isLetterShortcut(event, 's')) {
        event.preventDefault();
        void autosave.flush();
        return;
      }
      /* `Ctrl/Cmd+D` is the pin, not the bookmark dialog: it is §7's shortcut and the
         empty state promises it by name. Browser default suppressed either way. */
      if (isLetterShortcut(event, 'd')) {
        event.preventDefault();
        togglePin();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [autosave, togglePin]);

  if (noteId === null) {
    return (
      <Shell
        status={
          <EditorStatusBar
            title=""
            wordCount={0}
            saveState="saved"
            isPinned={false}
            onTogglePin={NOOP}
            folderName={null}
            tagNames={[]}
            onPickFolder={NOOP}
            onEditTags={NOOP}
          />
        }
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
          isPinned={pinned}
          onTogglePin={togglePin}
          folderName={folderId === null ? null : (folderNames.get(folderId) ?? null)}
          tagNames={tagNames}
          onPickFolder={(anchor) => {
            /* A toggle, like the settings default-folder button: the panel never
               covers its own anchor, so pressing it again is the fastest way out.
               Outside press and Esc keep working through the popover itself. */
            if (popover?.kind === 'folder') {
              setPopover(null);
              return;
            }
            setPopover({ kind: 'folder', anchor, placement: popoverPlacement(anchor) });
          }}
          onEditTags={(anchor) => {
            if (popover?.kind === 'tags') {
              setPopover(null);
              return;
            }
            setPopover({ kind: 'tags', anchor, placement: popoverPlacement(anchor) });
          }}
          variant={onClose === undefined ? 'desktop' : 'mobile'}
        />
      }
      popover={
        popover?.kind === 'folder' ? (
          <FolderPicker
            anchor={popover.anchor}
            placement={popover.placement}
            folders={folders ?? EMPTY_FOLDERS}
            current={folderId}
            onPick={(next) => {
              changeFolder(next);
              setPopover(null);
            }}
            onClose={closePopover}
          />
        ) : popover?.kind === 'tags' ? (
          <TagEditor
            anchor={popover.anchor}
            placement={popover.placement}
            tags={tags ?? EMPTY_TAGS}
            selected={tagIds}
            onToggle={toggleTag}
            onCreate={createTag}
            onClose={closePopover}
          />
        ) : null
      }
      editor={
        !ready || data === undefined ? (
          <div className="flex-1" />
        ) : (
          <>
            {saveState === 'error' ? (
              <span className="sr-only" role="status">
                Your text is still on this device. The save will be retried automatically.
              </span>
            ) : null}
            <MobileEditorBar
              title={displayTitle(data.title)}
              onBack={onClose}
              isPinned={pinned}
              onTogglePin={togglePin}
              onTrash={onTrash ?? NOOP}
            />
            <FormattingToolbar
              editor={toolbarEditor}
              variant={onClose === undefined ? 'desktop' : 'mobile'}
            />
            <NoteEditor
              key={`${data.id}:${contentEpoch}`}
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

function Shell({
  editor,
  status,
  popover = null,
}: {
  editor: ReactNode;
  status: ReactNode;
  /** The folder picker or tag editor, rendered beside the pane rather than inside
      the status bar: the bar is a flex row in the pane's own stacking context, and a
      popover inside it would be clipped by the editor's `overflow`. */
  popover?: ReactNode;
}): React.ReactElement {
  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col bg-[var(--surface)]"
      aria-label="Editor"
    >
      {editor}
      {status}
      {popover}
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
function MobileEditorBar({
  title,
  onBack,
  isPinned,
  onTogglePin,
  onTrash,
}: {
  title: string;
  onBack?: () => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onTrash: () => void;
}) {
  if (onBack === undefined) return null;
  return (
    /* Bar chrome is not selectable: the title is read, never copied — copying
       happens in the editor below it. */
    <header className="flex h-[52px] flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2 select-none">
      <IconButton label="Back to list" onClick={onBack} size="mobile">
        <ArrowLeft className="icon i-24" aria-hidden="true" />
      </IconButton>
      <span className="flex-1 truncate text-[14px] font-semibold">{title}</span>
      <EditorOverflowMenu isPinned={isPinned} onTogglePin={onTogglePin} onTrash={onTrash} />
    </header>
  );
}

/* `04-editor.md` §8.4 — a deliberate dead end, not an editor. The stored version
   was never touched, so "Try again" is honest. */
function RecoveryScreen({ code, onRetry }: { code: string; onRetry: () => void }) {
  return (
    <Shell
      status={
        <EditorStatusBar
          title=""
          wordCount={0}
          saveState="saved"
          isPinned={false}
          onTogglePin={NOOP}
          folderName={null}
          tagNames={[]}
          onPickFolder={NOOP}
          onEditTags={NOOP}
        />
      }
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
