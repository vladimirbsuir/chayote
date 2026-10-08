import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { buildEditorProps } from './editorProps';
import { sliceFromPlainText } from './pasteSanitizer';
import { EDITOR_EXTENSIONS } from './extensions';

type Transaction = Parameters<EditorView['dispatch']>[0];

/* `04-editor.md` §2.1. These are pure props, so they are asserted directly
   rather than through a WebView — the WebView tests live in `e2e/`. */

const props = buildEditorProps();

/* ProseMirror's prop signatures carry arguments TipTap does not use. These two
   helpers keep the call sites readable instead of padding every call with
   `undefined`. */
const attributes = (): Record<string, string> =>
  typeof props.attributes === 'function' ? props.attributes({} as never) : (props.attributes ?? {});

const drop = (event: Event): boolean =>
  props.handleDrop?.({} as never, event as never, {} as never, { block: false } as never) === true;

const pasteHtml = (html: string): string =>
  props.transformPastedHTML?.(html, {} as never) ?? '';

const paste = (data: DataTransfer | null, view: EditorView): boolean =>
  props.handlePaste?.(view, { clipboardData: data } as never, {} as never) === true;

const schema = getSchema(EDITOR_EXTENSIONS);

/* A minimal view: enough state for `handlePaste` to read, and a recorder for the
   transaction it dispatches. */
function stubView(): { view: EditorView; dispatched: () => Transaction[] } {
  const state = EditorState.create({ schema });
  const sent: Transaction[] = [];
  return {
    view: {
      state,
      dispatch: (tr: Transaction) => sent.push(tr),
    } as unknown as EditorView,
    dispatched: () => sent,
  };
}

function clipboard(html: string, text: string): DataTransfer {
  const data = new Map<string, string>([
    ['text/html', html],
    ['text/plain', text],
  ]);
  return {
    getData: (type: string): string => data.get(type) ?? '',
  } as unknown as DataTransfer;
}

describe('editor attributes', () => {
  it('carries the class, the testid, and the §10 accessibility set', () => {
    const attrs = attributes();

    expect(attrs.class).toBe('note-editor');
    expect(attrs['data-testid']).toBe('note-editor');
    expect(attrs.role).toBe('textbox');
    expect(attrs['aria-multiline']).toBe('true');
    expect(attrs['aria-label']).toBe('Note content');
  });
});

describe('handleDrop', () => {
  it('cancels the event and reports the drop as handled', () => {
    const event = new Event('drop', { cancelable: true });

    expect(drop(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('transformPastedHTML', () => {
  it('strips script, style, and presentational attributes', () => {
    const clean = pasteHtml(
      '<p style="color:red">kept</p><script>bad()</script><span onclick="bad()">also</span>',
    );

    expect(clean).not.toContain('script');
    expect(clean).not.toContain('style');
    expect(clean).not.toContain('onclick');
    expect(clean).toContain('kept');
    expect(clean).toContain('also');
  });

  it('keeps a Word-style document readable: headings, lists, bold', () => {
    const clean = pasteHtml(
      '<h1>Report</h1><p style="margin:0"><span style="font-weight:700">Summary</span> text</p><ul><li>one</li><li>two</li></ul>',
    );

    expect(clean).toContain('<h1>Report</h1>');
    expect(clean).toContain('one</li>');
    expect(clean).toContain('Summary');
    expect(clean).not.toContain('<span');
  });

  it('flattens a Google Docs table into paragraphs in reading order', () => {
    const clean = pasteHtml('<table><tbody><tr><td>alpha</td><td>beta</td></tr></tbody></table>');

    expect(clean).not.toContain('<table');
    expect(clean).not.toContain('<td');
    expect(clean.indexOf('alpha')).toBeLessThan(clean.indexOf('beta'));
  });
});

describe('sliceFromPlainText', () => {
  it('splits on blank lines into paragraphs', () => {
    const slice = sliceFromPlainText(schema, 'first\n\nsecond', []);

    expect(slice?.content.childCount).toBe(2);
    expect(slice?.content.child(0).type.name).toBe('paragraph');
    expect(slice?.content.child(1).textContent).toBe('second');
  });

  it('turns a single newline into a hardBreak, per 04-editor.md §4.1 rule 7', () => {
    const slice = sliceFromPlainText(schema, 'first line\nsecond line', []);

    expect(slice?.content.childCount).toBe(1);
    expect(slice?.content.child(0).childCount).toBe(3);
    expect(slice?.content.child(0).child(1).type.name).toBe('hardBreak');
  });

  it('carries the marks of the insertion point', () => {
    const italic = schema.marks.italic;
    expect(italic).toBeDefined();
    const slice = sliceFromPlainText(schema, 'kept', italic === undefined ? [] : [italic.create()]);

    expect(slice?.content.child(0).child(0).marks.map((m) => m.type.name)).toContain('italic');
  });

  it('returns null when there is nothing to insert', () => {
    expect(sliceFromPlainText(schema, '   \n\n  ', [])).toBeNull();
  });
});

describe('handlePaste', () => {
  it('consumes a paste that would insert nothing', () => {
    const { view } = stubView();

    expect(paste(clipboard('', '   \n\n  '), view)).toBe(true);
    expect(paste(clipboard('<div><span></span></div>', 'ignored'), view)).toBe(true);
  });

  it('builds the slice itself for a plain-text paste, because transformPastedText cannot express rule 7', () => {
    const { view, dispatched } = stubView();

    expect(paste(clipboard('', 'first line\nsecond line\n\nsecond paragraph'), view)).toBe(true);

    const [tr] = dispatched();
    const inserted = tr?.doc;
    expect(inserted?.childCount).toBe(2);
    expect(inserted?.child(0).child(1).type.name).toBe('hardBreak');
    expect(inserted?.child(1).textContent).toBe('second paragraph');
  });

  it('dispatches nothing when the plain-text paste is empty', () => {
    const { view, dispatched } = stubView();

    expect(paste(clipboard('', '   '), view)).toBe(true);
    expect(dispatched()).toHaveLength(0);
  });

  it('hands an HTML paste back to ProseMirror so transformPastedHTML runs', () => {
    const { view, dispatched } = stubView();

    expect(paste(clipboard('<p>text</p>', 'text'), view)).toBe(false);
    expect(dispatched()).toHaveLength(0);
  });

  it('defers to ProseMirror when the clipboard is unreadable', () => {
    const { view } = stubView();

    expect(paste(null, view)).toBe(false);
  });
});