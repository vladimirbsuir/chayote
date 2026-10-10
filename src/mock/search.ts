import type { JsonDoc } from '../types/note';
import { plainTextOf } from './derive';

/* The browser backend's half of `03-data-model.md` §3.6.

   ADR-018 requires the mock to answer every command the way the real backend
   does, and required test 11 in `10-conventions.md` §10 is that contract. A mock
   that matched substrings and returned each note's opening excerpt would satisfy
   the TypeScript types while failing the thing that matters: every assertion
   about search made in a browser would then be about a search the app does not
   perform.

   So the three behaviours below mirror the Rust side rather than approximate it.

   Tokenisation keeps letters, digits and `_` — the characters `to_fts_match`
   keeps — so `NEAR(`, `^` and `-` reach no index here either, and a query of
   pure punctuation sanitises to nothing.

   Matching is on token starts. The Rust side emits `token*`, which FTS5 resolves
   as a prefix over whole tokens; a substring test would also match `road` inside
   `broadway`, which is a different answer and the kind of difference that makes a
   mock worse than no mock.

   The snippet is built around the match, not taken from the note's opening.
   `snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12)` returns the tokens
   around a hit with the terms marked, and the card has to be able to render that
   markup for the frontend's allowlist to be anything but decoration. */

const ELLIPSIS = '…';

/** Characters `to_fts_match` keeps. `#tag` and `snake_case` words survive; the
    rest is punctuation the index never held. */
const TOKEN = /[\p{L}\p{N}_]+/gu;

/** FTS5's `snippet()` context argument is 12 tokens around the phrase. Six on
    each side reads as a sentence or two, which is what the card's two-line clamp
    can show anyway. */
const CONTEXT_TOKENS = 6;

/** The sanitised query, or `null` when nothing searchable is left in it. Mirrors
    `SearchService::to_fts_match`. */
export function toSearchTokens(input: string): string[] | null {
  const tokens = input.match(TOKEN) ?? [];
  return tokens.length === 0 ? null : tokens.map(foldCase);
}

/** The `[start, end)` ranges of the words a token prefixed, in document order. */
function hitsIn(haystack: string, tokens: string[]): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const match of haystack.matchAll(TOKEN)) {
    const word = foldCase(match[0]);
    if (tokens.some((token) => word.startsWith(token))) {
      found.push([match.index, match.index + match[0].length]);
    }
  }
  return found;
}

/** True when every token starts a word, which is what `token*` means to FTS5. */
export function matchesTokens(haystack: string, tokens: string[]): boolean {
  const words = foldCase(haystack).match(TOKEN) ?? [];
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

/**
 * `bm25(notes_fts, 8.0, 1.0)`, inverted: a title hit outranks roughly eight body
 * hits, and FTS5's more-negative-is-better becomes the smaller number here.
 * `null` when nothing matched, so a caller cannot rank an absent match.
 */
export function rankFor(title: string, body: string, tokens: string[]): number | null {
  const titleHits = hitsIn(title, tokens).length;
  const bodyHits = hitsIn(body, tokens).length;
  if (titleHits === 0 && bodyHits === 0) return null;
  return -(titleHits * 8 + bodyHits);
}

/**
 * The snippet column 1 would return: the matched word with context on each side,
 * every matched word wrapped in `mark`.
 *
 * The text is escaped on the way out. `plain_text` is whatever the user typed, so
 * a note containing `<script>` produces a snippet containing one — through FTS5
 * too, which escapes none of it. Escaping here is what makes the two backends
 * agree, and it is also why the frontend's allowlist is still worth having.
 *
 * With no match in the body — a title-only hit — FTS5 returns the column's
 * opening tokens, and so does this.
 */
export function snippetFor(doc: JsonDoc, tokens: string[]): string {
  const plain = plainTextOf(doc);
  const hits = hitsIn(plain, tokens);
  const first = hits[0];
  if (first === undefined) return escapeHtml(plain.trim().slice(0, 200));

  const words = [...plain.matchAll(TOKEN)];
  const at = words.findIndex((word) => word.index === first[0]);
  const from = Math.max(0, at - CONTEXT_TOKENS);
  const to = Math.min(words.length, at + CONTEXT_TOKENS + 1);

  const start = words[from]?.index ?? 0;
  const last = words[to - 1];
  const end = last === undefined ? plain.length : last.index + last[0].length;

  const window = plain.slice(start, end);
  const lead = from > 0 ? ELLIPSIS : '';
  const tail = to < words.length ? ELLIPSIS : '';
  return `${lead}${markHits(window, hits, start)}${tail}`;
}

function markHits(window: string, hits: Array<[number, number]>, offset: number): string {
  let out = '';
  let cursor = 0;
  for (const [from, to] of hits) {
    const localFrom = Math.max(from - offset, cursor);
    const localTo = to - offset;
    if (localTo <= localFrom || localFrom >= window.length) continue;
    out += escapeHtml(window.slice(cursor, localFrom));
    out += `<mark>${escapeHtml(window.slice(localFrom, localTo))}</mark>`;
    cursor = localTo;
  }
  return out + escapeHtml(window.slice(cursor));
}

/* FTS5 escapes none of what it reads, and neither does `plain_text`, so the two
   backends agree only because this does. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function foldCase(value: string): string {
  return value.toLocaleLowerCase();
}