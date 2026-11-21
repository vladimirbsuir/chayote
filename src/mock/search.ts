import type { JsonDoc } from '../types/note';
import { plainTextOf } from './derive';

const ELLIPSIS = '…';

const TOKEN = /[\p{L}\p{N}_]+/gu;

const CONTEXT_TOKENS = 6;

export function toSearchTokens(input: string): string[] | null {
  const tokens = input.match(TOKEN) ?? [];
  return tokens.length === 0 ? null : tokens.map(foldCase);
}

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

export function matchesTokens(haystack: string, tokens: string[]): boolean {
  const words = foldCase(haystack).match(TOKEN) ?? [];
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

export function rankFor(title: string, body: string, tokens: string[]): number | null {
  const titleHits = hitsIn(title, tokens).length;
  const bodyHits = hitsIn(body, tokens).length;
  if (titleHits === 0 && bodyHits === 0) return null;
  return -(titleHits * 8 + bodyHits);
}

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