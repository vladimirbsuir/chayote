import { describe, expect, it } from 'vitest';
import { matchesTokens, rankFor, snippetFor, toSearchTokens } from './search';
import type { JsonDoc } from '../types/note';

/* Required test 7 in `10-conventions.md` §10 is the Rust half: search input
   containing FTS operators cannot produce an error or an injection. This is the
   browser half of the same rule, and it matters more than it looks — a mock that
   quietly accepted `NEAR(` would let a Playwright test pass while the real query
   rejected it, which is the whole failure ADR-018 is written to prevent. */

function doc(text: string): JsonDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const LONG =
  'Rough outline of the priorities we agreed on. Needs numbers before it goes anywhere. ' +
  'The roadmap moves to the fourteenth, and nothing ships until the onboarding flow is done.';

function tokens(input: string): string[] {
  const found = toSearchTokens(input);
  if (found === null) throw new Error(`expected tokens for ${input}`);
  return found;
}

describe('toSearchTokens', () => {
  it('keeps letters, digits and underscores, and drops the rest', () => {
    expect(toSearchTokens('road_map 42, café')).toEqual(['road_map', '42', 'café']);
  });

  it('is null when nothing searchable survives, which is the fallback case', () => {
    expect(toSearchTokens('   ')).toBeNull();
    expect(toSearchTokens('^ - * , "')).toBeNull();
  });

  it('takes an FTS operator as the word rather than as syntax', () => {
    expect(tokens('and')).toEqual(['and']);
    expect(tokens('NEAR(a b)')).toEqual(['near', 'a', 'b']);
  });
});

describe('matchesTokens', () => {
  it('matches a prefix of a word, as token* does', () => {
    expect(matchesTokens('The roadmap moves', tokens('road'))).toBe(true);
    expect(matchesTokens('The roadmap moves', tokens('roadm'))).toBe(true);
  });

  it('does not match inside a word, which a substring test would', () => {
    expect(matchesTokens('On the broadway branch', tokens('road'))).toBe(false);
  });

  it('requires every token, as the AND between them means', () => {
    expect(matchesTokens('The roadmap moves', tokens('roadmap moves'))).toBe(true);
    expect(matchesTokens('The roadmap moves', tokens('roadmap budget'))).toBe(false);
  });

  it('ignores case and the diacritics the tokenizer folds away', () => {
    expect(matchesTokens('Cafe notes for the Caf\u00e9', tokens('cafe'))).toBe(true);
  });
});

describe('rankFor', () => {
  it('is null when nothing matched', () => {
    expect(rankFor('Untitled', 'nothing here', tokens('roadmap'))).toBeNull();
  });

  it('puts a title hit above about eight body hits', () => {
    const title = rankFor('roadmap', 'unrelated', tokens('roadmap'));
    const body = rankFor('unrelated', 'roadmap', tokens('roadmap'));
    expect(title).not.toBeNull();
    expect(body).not.toBeNull();
    expect(title as number).toBeLessThan(body as number);
  });
});

describe('snippetFor', () => {
  it('marks the matched word and keeps the words around it', () => {
    const snippet = snippetFor(doc(LONG), tokens('roadmap'));

    expect(snippet).toContain('<mark>roadmap</mark>');
    expect(snippet).toContain('goes anywhere');
    expect(snippet.startsWith('…')).toBe(true);
  });

  it('escapes markup that came out of the note, so a script tag stays text', () => {
    const snippet = snippetFor(doc('before <script>steal()</script> roadmap after'), tokens('roadmap'));

    expect(snippet).not.toContain('<script>');
    expect(snippet).toContain('&lt;script&gt;');
    expect(snippet).toContain('<mark>roadmap</mark>');
  });

  it('falls back to the opening of the body when only the title matched', () => {
    /* FTS5's `snippet(…, 1, …)` reads column 1, the body, whatever column matched.
       A result whose only hit was in the title therefore still shows the body —
       which is the useful thing, because the card prints the title itself. */
    const snippet = snippetFor(doc('A body with nothing relevant in it.'), tokens('roadmap'));

    expect(snippet).not.toContain('<mark>');
    expect(snippet).toBe('A body with nothing relevant in it.');
  });

  it('omits both ellipses when the whole body is the context', () => {
    const snippet = snippetFor(doc('roadmap'), tokens('roadmap'));

    expect(snippet).toBe('<mark>roadmap</mark>');
  });
});