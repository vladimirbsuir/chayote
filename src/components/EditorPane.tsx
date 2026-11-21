import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import { AlertCircle, ArrowLeft, RotateCw } from 'lucide-react';
import { notesApi, tagsApi } from '../lib/ipc';
import { registerSyncFlusher } from '../lib/syncFlush';
import { useAutosave } from '../hooks/useAutosave';
import { useNoteTitle } from '../hooks/useNoteTitle';
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
import { NoteHeader } from './NoteHeader';
import { FormattingToolbar } from './FormattingToolbar';
import { EmptyState } from './EmptyState';
import { summaryOf } from './summaryOf';
import { FolderPicker, TagEditor } from './StatusPopovers';
import { popoverPlacement } from './popoverPlacement';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';

type EditorPaneProps = {
  noteId: Uuid | null;
  selectionKey: string;
  onClose?: () => void;
  onTrash?: () => void;
};

const NOOP = (): void => {};

const EMPTY_FOLDERS: FolderNode[] = [];
const EMPTY_TAGS: TagWithCount[] = [];

type Active = {
  folderId: Uuid | null;
  tagIds: Uuid[];
  isPinned: boolean;
};

export function EditorPane({ noteId, selectionKey, onClose, onTrash }: EditorPaneProps) {
  const queryClient = useQueryClient();
  const activeRef = useRef<Active>({ folderId: null, tagIds: [], isPinned: false });
  const [pinned, setPinned] = useState(false);
  const [folderId, setFolderId] = useState<Uuid | null>(null);
  const [tagIds, setTagIds] = useState<Uuid[]>([]);
  const [title, setTitle] = useState('');
  const { write: writeTitle, flush: flushTitle } = useNoteTitle();

  const editorRef = useRef<Editor | null>(null);
  const loadedDocRef = useRef<string | null>(null);
  const [contentEpoch, setContentEpoch] = useState(0);
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null);

  const [popover, setPopover] = useState<{
    kind: 'folder' | 'tags';
    anchor: HTMLElement;
    placement: { top: number; left: number };
  } | null>(null);
  const openIdRef = useRef(noteId);
  useEffect(() => {
    openIdRef.current = noteId;
  }, [noteId]);
  const autosave = useAutosave((saved) => {
    if (saved.id === openIdRef.current) loadedDocRef.current = JSON.stringify(saved.doc);
    queryClient.setQueryData(qk.note(saved.id), saved);
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
      setPinned(data.isPinned);
      setFolderId(data.folderId);
      setTagIds(ids);
      setTitle(data.title);
      editorRef.current = editor;
      setToolbarEditor(editor);
      autosave.setBaseline(targetOf(editor) as SaveNoteInput);
    },
    [autosave, noteId, queryClient, targetOf],
  );

  const changeTitle = useCallback(
    (next: string): void => {
      setTitle(next);
      if (noteId !== null) writeTitle(noteId, next);
    },
    [noteId, writeTitle],
  );

  const commitTitle = useCallback((): void => {
    flushTitle();
  }, [flushTitle]);

  const enterBodyFromTitle = useCallback((): void => {
    flushTitle();
    editorRef.current?.commands.focus('start');
  }, [flushTitle]);

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

  const closePopover = (): void => {
    setPopover(null);
  };

  const createTag = useCallback(
    async (name: string): Promise<void> => {
      const created = await tagsApi.create(name);
      toggleTag(created.id);
      await autosave.flush();
      await queryClient.invalidateQueries({ queryKey: qk.tags() });
    },
    [autosave, queryClient, toggleTag],
  );

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

  useEffect(() => {
    void autosave.flush();
  }, [autosave, selectionKey]);

  useEffect(() => {
    registerSyncFlusher(() => {
      flushTitle();
      return autosave.flush();
    });
    return () => {
      registerSyncFlusher(null);
    };
  }, [autosave, flushTitle]);

  const serverDocJson = note.data === undefined ? null : JSON.stringify(note.data.doc);
  useEffect(() => {
    if (note.data === undefined || serverDocJson === null) return;
    if (saveState !== 'saved') return;
    if (loadedDocRef.current === serverDocJson) return;
    loadedDocRef.current = serverDocJson;
    setContentEpoch((epoch) => epoch + 1);
  }, [note.data, serverDocJson, saveState]);

  useEffect(() => {
    const data = note.data;
    if (data === undefined || data.id !== noteId || saveState !== 'saved') return;
    const active = activeRef.current;
    const ids = data.tags.map((tag) => tag.id);
    const sameTags =
      ids.length === active.tagIds.length && ids.every((id) => active.tagIds.includes(id));
    if (active.folderId === data.folderId && sameTags && active.isPinned === data.isPinned) {
      return;
    }
    activeRef.current = { folderId: data.folderId, tagIds: ids, isPinned: data.isPinned };
    setFolderId(data.folderId);
    setTagIds(ids);
    setPinned(data.isPinned);
  }, [note.data, noteId, saveState]);

  const [freshId, setFreshId] = useState<Uuid | null>(null);
  if (freshId !== noteId) {
    if (noteId === null || note.data === undefined || note.isFetching) {
      if (freshId !== null) setFreshId(null);
    } else {
      setFreshId(noteId);
    }
  }
  const ready = freshId === noteId && note.data !== undefined;

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;

      if (isLetterShortcut(event, 's')) {
        event.preventDefault();
        void autosave.flush();
        return;
      }
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
          wordCount={data?.wordCount ?? 0}
          saveState={saveState}
          isPinned={pinned}
          onTogglePin={togglePin}
          folderName={folderId === null ? null : (folderNames.get(folderId) ?? null)}
          tagNames={tagNames}
          onPickFolder={(anchor) => {
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
              onBack={onClose}
              isPinned={pinned}
              onTogglePin={togglePin}
              onTrash={onTrash ?? NOOP}
            />{' '}
            <FormattingToolbar
              editor={toolbarEditor}
              variant={onClose === undefined ? 'desktop' : 'mobile'}
            />
            <div
              className={`editor-scroll flex flex-1 flex-col overflow-y-auto overscroll-contain ${
                onClose === undefined ? 'px-8 pt-10 pb-16' : 'px-5 pt-6 pb-16'
              }`}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const selection = window.getSelection();
                if (selection !== null && !selection.isCollapsed) return;
                toolbarEditor?.commands.focus('end');
              }}
            >
              <NoteHeader
                title={title}
                updatedAt={data.updatedAt}
                onChange={changeTitle}
                onCommit={commitTitle}
                onEnter={enterBodyFromTitle}
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
            </div>
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

function MobileEditorBar({
  onBack,
  isPinned,
  onTogglePin,
  onTrash,
}: {
  onBack?: () => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onTrash: () => void;
}) {
  if (onBack === undefined) return null;
  return (
    <header className="flex h-[52px] flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2 select-none">
      <IconButton label="Back to list" onClick={onBack} size="mobile">
        <ArrowLeft className="icon i-24" aria-hidden="true" />
      </IconButton>
      <div className="ml-auto">
        <EditorOverflowMenu isPinned={isPinned} onTogglePin={onTogglePin} onTrash={onTrash} />
      </div>
    </header>
  );
}

function RecoveryScreen({ code, onRetry }: { code: string; onRetry: () => void }) {
  return (
    <Shell
      status={
        <EditorStatusBar
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

function errorCodeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'INTERNAL';
  const { code } = error;
  return typeof code === 'string' ? code : 'INTERNAL';
}
