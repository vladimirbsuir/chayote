import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Hash } from 'lucide-react';
import { flattenFolders } from './popoverPlacement';
import type { FolderNode } from '../types/folder';
import type { TagWithCount } from '../types/tag';
import type { Uuid } from '../types/note';

/* The "no folder" choice, worded once: it labels the picker's first option and
   the settings dialog's button for the same value, so the two can never read
   as two different meanings. */
export const NONE_LABEL = 'None';


type PopoverProps = {
  anchor: HTMLElement;
  placement: { top: number; left: number };
  label: string;
  onClose: () => void;
  children: React.ReactNode;
};

function Popover({ anchor, placement, label, onClose, children }: PopoverProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return;
      if (anchor.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      data-testid="status-popover"
      style={{ top: placement.top, left: placement.left }}
      /* Option labels are chrome, not content: a hold on one must pick it,
         never select its text. The tag editor's filter input opts back in with
         `select-text`, so it keeps its selection toolbar. */
      className="fixed z-50 w-[260px] overflow-hidden rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)] select-none"
    >
      <div className="border-b border-[var(--border)] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
        {label}
      </div>
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ *
 *  FolderPicker
 * ------------------------------------------------------------------ */

export type FolderPickerProps = {
  anchor: HTMLElement;
  /** Viewport coordinates, measured by the caller in its click handler. */
  placement: { top: number; left: number };
  folders: FolderNode[];
  current: Uuid | null;
  onPick: (folderId: Uuid | null) => void;
  onClose: () => void;
};

export function FolderPicker({
  anchor,
  placement,
  folders,
  current,
  onPick,
  onClose,
}: FolderPickerProps): React.ReactElement {
  const options = useMemo(() => flattenFolders(folders), [folders]);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  /* Case-insensitive substring, like the tag editor's filter: a large library
     is narrowed by typing rather than scrolled. The "None" choice filters by
     its own label too, so an active filter never shows a stale first row. */
  const needle = query.trim().toLowerCase();
  const matches =
    needle.length === 0
      ? options
      : options.filter((option) => option.name.toLowerCase().includes(needle));
  const showNone = needle.length === 0 || NONE_LABEL.toLowerCase().includes(needle);

  return (
    <Popover anchor={anchor} placement={placement} label="Folder" onClose={onClose}>
      <div className="border-b border-[var(--border)] p-2">
        <input
          type="text"
          aria-label="Filter folders"
          data-testid="folder-picker-filter"
          placeholder="Filter folders…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          /* Explicitly selectable: the popover root carries `select-none`, and
             a field the user types in must keep its selection toolbar. */
          className="h-[26px] w-full rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[13px] text-[var(--text)] outline-none select-text"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Folder"
        data-testid="folder-picker-list"
        tabIndex={0}
        /* Capped so the whole panel stays within the height `popoverPlacement`
           assumes (280): label + filter + list must fit above the anchor with
           room to spare, or the panel would cover the button that toggles it —
           and then the list could only be dismissed by clicking elsewhere. */
        className="max-h-[190px] overflow-y-auto p-1 outline-none"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const items = Array.from(
              listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
            );
            const currentIndex = items.findIndex((item) => item === document.activeElement);
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const next = (currentIndex === -1 ? 0 : currentIndex + delta + items.length) % items.length;
            items[next]?.focus();
          }
        }}
      >
        {matches.length === 0 && !showNone ? (
          <p className="px-2 py-2 text-[12px] text-[var(--text-subtle)]">No matching folders</p>
        ) : (
          <>
            {showNone ? (
              <Option
                id={null}
                name={NONE_LABEL}
                /* Depth one with no icon, exactly like a top-level folder: the
                   old row carried a folder glyph none of the other rows has,
                   which read as emphasis on the default rather than a choice
                   among equals. */
                depth={1}
                selected={current === null}
                onPick={onPick}
              />
            ) : null}
            {matches.map((option) => (
              <Option
                key={option.id}
                id={option.id}
                name={option.name}
                depth={option.depth + 1}
                selected={current === option.id}
                onPick={onPick}
              />
            ))}
          </>
        )}
      </div>
    </Popover>
  );
}

function Option({
  id,
  name,
  depth,
  selected,
  onPick,
}: {
  id: Uuid | null;
  name: string;
  depth: number;
  selected: boolean;
  onPick: (id: Uuid | null) => void;
}): React.ReactElement {
  return (
    <div
      role="option"
      aria-selected={selected}
      /* `id === null` for "no folder", which is a real option and must not collide
         with a folder id in the DOM. */
      data-testid="folder-picker-option"
      data-folder-id={id ?? 'none'}
      tabIndex={-1}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={() => {
        onPick(id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick(id);
        }
      }}
      className={`flex h-[26px] cursor-pointer items-center gap-2 rounded-[var(--r-input)] px-2 text-[13px] ${
        selected
          ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
          : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
      }`}
    >
      <span className="flex-1 truncate">{name}</span>
      {selected ? <Check className="icon i-16 flex-none" aria-hidden="true" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  TagEditor
 * ------------------------------------------------------------------ */

export type TagEditorProps = {
  anchor: HTMLElement;
  /** Viewport coordinates, measured by the caller in its click handler. */
  placement: { top: number; left: number };
  tags: TagWithCount[];
  selected: Uuid[];
  /** Resolves a typed name to a tag, creating it if it does not exist. §6.4: "A tag
      is created by typing a new name into the tag editor; existing names complete.
      Case-insensitive match, normalised to the first-created spelling." */
  onToggle: (tagId: Uuid) => void;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
};

export function TagEditor({
  anchor,
  placement,
  tags,
  selected,
  onToggle,
  onCreate,
  onClose,
}: TagEditorProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  /* Case-insensitive, per §6.4. The match is on the typed text so `work` completes
     `Work`, and the tag keeps its first-created spelling because the backend
     returns the existing row rather than making a new one. */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return tags;
    return tags.filter((tag) => tag.name.toLowerCase().includes(needle));
  }, [query, tags]);

  const exact = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return null;
    return tags.find((tag) => tag.name.toLowerCase() === needle) ?? null;
  }, [query, tags]);

  return (
    <Popover anchor={anchor} placement={placement} label="Tags" onClose={onClose}>
      <div className="border-b border-[var(--border)] p-2">
        <input
          type="text"
          aria-label="Add a tag"
          data-testid="tag-editor-input"
          placeholder="Add a tag…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const name = query.trim();
              if (name.length === 0) return;
              /* An exact match toggles rather than creates: typing the name of a tag
                 that already exists is a request to add it, not to add a second copy
                 of it. §6.4 says the case-insensitive match is normalised to the
                 first-created spelling, which is the backend's job — asking it to
                 create the same name again would be asking for a duplicate. */
              if (exact !== null) {
                onToggle(exact.id);
                setQuery('');
                return;
              }
              void onCreate(name).then(() => {
                setQuery('');
              });
            }
          }}
          /* Explicitly selectable: the popover root carries `select-none`, and a
             field the user types in must keep its selection toolbar. */
          className="h-[26px] w-full rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[13px] text-[var(--text)] outline-none select-text"
        />
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Tags"
        data-testid="tag-editor-list"
        className="max-h-[200px] overflow-y-auto p-1"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const items = Array.from(
            listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
          );
          const currentIndex = items.findIndex((item) => item === document.activeElement);
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const next = (currentIndex === -1 ? 0 : currentIndex + delta + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        {matches.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-[var(--text-subtle)]">
            {query.trim().length === 0
              ? 'No tags yet'
              : `Press Enter to create “${query.trim()}”`}
          </p>
        ) : (
          matches.map((tag) => (
            <div
              key={tag.id}
              role="option"
              aria-selected={selected.includes(tag.id)}
              data-testid="tag-editor-option"
              data-tag-id={tag.id}
              tabIndex={-1}
              onClick={() => {
                onToggle(tag.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggle(tag.id);
                }
              }}
              className={`flex h-[26px] cursor-pointer items-center gap-2 rounded-[var(--r-input)] px-2 text-[13px] ${
                selected.includes(tag.id)
                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                  : 'text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <Hash className="icon i-16 flex-none opacity-70" aria-hidden="true" />
              <span className="flex-1 truncate">{tag.name}</span>
              {selected.includes(tag.id) ? (
                <Check className="icon i-16 flex-none" aria-hidden="true" />
              ) : null}
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}
