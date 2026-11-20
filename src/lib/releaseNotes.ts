/* Release notes for the Updates tab (ADR-024).

   `latest.json` carries the notes as untrusted text, and the app has no Markdown
   renderer — nor should it grow one for a paragraph of changes. Rendering the
   text verbatim was the other extreme: the v0.2.1 manifest carried the whole
   GitHub release body, and the tab printed its table, its `**` and its hard
   line breaks exactly as typed (the release pipeline now writes a short list
   instead — `scripts/release-notes.mjs`).

   So this reads the small subset the pipeline writes and anything a person is
   likely to type by hand, and turns it into plain blocks the tab lays out:

   - blank lines separate paragraphs, and a paragraph's own line breaks are
     soft wraps, joined with a space;
   - `- ` / `* ` lines are list items, and an indented line continues the item;
   - `**bold**`, `` `code` `` and `[text](url)` keep their text and lose the
     markup — the tab cannot open a link, so the URL would only be noise;
   - a Markdown table separator (`--- | ---`) is dropped and every other table
     row stays a line of its own, which is the most it can say legibly.

   Nothing here produces HTML: the blocks are rendered as React text, so the
   notes cannot inject markup whatever they contain. */

export type ReleaseNoteBlock = { kind: 'text' | 'item'; text: string };

const BULLET = /^\s*[-*+]\s+/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function releaseNoteBlocks(notes: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  /* Whether the next plain line continues the last block, which is false after
     a blank line or a table row. */
  let open = false;

  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const last = blocks[blocks.length - 1];
    if (raw.trim().length === 0 || TABLE_SEPARATOR.test(raw)) {
      open = false;
    } else if (BULLET.test(raw)) {
      blocks.push({ kind: 'item', text: raw.replace(BULLET, '') });
      open = true;
    } else if (raw.includes('|')) {
      const cells = raw.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
      blocks.push({ kind: 'text', text: cells.replace(/\s*\|\s*/g, ' — ') });
      open = false;
    } else if (open && last !== undefined) {
      last.text += ` ${raw}`;
    } else {
      blocks.push({ kind: 'text', text: raw });
      open = true;
    }
  }

  return blocks
    .map((block) => ({ kind: block.kind, text: plain(block.text) }))
    .filter((block) => block.text.length > 0);
}
