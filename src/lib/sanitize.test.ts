import { describe, expect, it } from 'vitest';
import { hasVisibleContent, sanitizeAndNormalize, sanitizeSnippet, textToParagraphs } from './sanitize';

/* `04-editor.md` §4.1, rules 1–8. Required test 10 in `10-conventions.md` §10
   is rules 1–3: pasted script tags, presentational attributes, and URLs do not
   survive. The rest of the file covers the rules that are easy to regress. */

describe('sanitizeAndNormalize', () => {
  it('removes script and style elements along with their subtree', () => {
    const html =
      '<p>before</p><script>window.stolen = 1</script><style>p { color: red }</style><p>after</p>';

    const clean = sanitizeAndNormalize(html);

    expect(clean).not.toContain('script');
    expect(clean).not.toContain('stolen');
    expect(clean).not.toContain('style');
    expect(clean).not.toContain('color: red');
    expect(clean).toContain('before');
    expect(clean).toContain('after');
  });

  it('removes an inline event handler and every presentational attribute', () => {
    const html = '<p style="color:red" class="x" id="y" width="10" align="left" onclick="steal()">text</p>';

    const clean = sanitizeAndNormalize(html);

    expect(clean).toBe('<p>text</p>');
    expect(clean).not.toContain('steal');
  });

  it('keeps the four marks in the schema and their HTML spellings', () => {
    const clean = sanitizeAndNormalize(
      '<p><strong>a</strong><b>b</b><em>c</em><i>d</i><s>e</s><strike>f</strike><del>g</del></p>',
    );

    expect(clean).toContain('<strong>a</strong>');
    expect(clean).toContain('<em>c</em>');
    expect(clean).toContain('<s>e</s>');
  });

  it('drops every href and src, because v1 has no link mark and no image node', () => {
    const clean = sanitizeAndNormalize(
      '<p><a href="https://example.com">link</a><a href="javascript:alert(1)">bad</a></p><p><img src="x.png" alt="pic"></p>',
    );

    expect(clean).not.toContain('href');
    expect(clean).not.toContain('src');
    expect(clean).not.toContain('javascript');
    expect(clean).not.toContain('img');
    expect(clean).toContain('link');
    expect(clean).toContain('bad');
  });

  it('preserves block structure from a document paste', () => {
    const clean = sanitizeAndNormalize(
      '<h2>Heading</h2><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><blockquote><p>quote</p></blockquote><pre><code>npm run dev</code></pre><hr>',
    );

    expect(clean).toContain('<h2>Heading</h2>');
    expect(clean).toContain('<li>one</li>');
    expect(clean).toContain('<ol>');
    expect(clean).toContain('<blockquote>');
    expect(clean).toContain('<hr>');
  });

  it('flattens table cells to paragraphs in reading order', () => {
    const clean = sanitizeAndNormalize(
      '<table><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td></tr></table>',
    );

    expect(clean).not.toContain('<td');
    expect(clean).not.toContain('<table');
    expect(clean.indexOf('alpha')).toBeLessThan(clean.indexOf('beta'));
    expect(clean.indexOf('beta')).toBeLessThan(clean.indexOf('gamma'));
  });

  it('unwraps nesting past twelve levels instead of letting the validator reject it', () => {
    const deep = 'text';
    const html = `${'<div>'.repeat(20)}${deep}${'</div>'.repeat(20)}`;

    const clean = sanitizeAndNormalize(html);

    let depth = 0;
    for (let i = 0; i < clean.length; i++) {
      if (clean.startsWith('<div>', i)) depth += 1;
      if (clean.startsWith('</div>', i)) depth -= 1;
      expect(depth).toBeLessThanOrEqual(12);
    }
    expect(clean).toContain(deep);
  });

  it('removes an iframe, an object, and a form with its subtree', () => {
    const clean = sanitizeAndNormalize(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><form><input name="a"><button>go</button></form><p>kept</p>',
    );

    expect(clean).not.toContain('iframe');
    expect(clean).not.toContain('object');
    expect(clean).not.toContain('input');
    expect(clean).not.toContain('button');
    expect(clean).toContain('kept');
  });

  it('returns an empty string for input with nothing to keep', () => {
    expect(sanitizeAndNormalize('')).toBe('');
    expect(sanitizeAndNormalize('<div><span></span></div>')).toBe('');
  });
});

describe('textToParagraphs', () => {
  it('splits on blank lines and turns a single newline into a hard break', () => {
    expect(textToParagraphs('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
  });

  it('escapes markup in pasted plain text so it cannot become a node', () => {
    const html = textToParagraphs('<script>alert(1)</script>\n\nb & c');

    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>b &amp; c</p>');
  });

  it('normalises carriage returns and drops blank runs', () => {
    expect(textToParagraphs('a\r\n\r\n\r\n\r\nb')).toBe('<p>a</p><p>b</p>');
  });

  it('returns an empty string when there is no text', () => {
    expect(textToParagraphs('   \n\n  ')).toBe('');
  });
});

describe('hasVisibleContent', () => {
  it('is false for markup that would leave nothing in the document', () => {
    expect(hasVisibleContent('')).toBe(false);
    expect(hasVisibleContent('<div><span></span></div>')).toBe(false);
    expect(hasVisibleContent('<p> </p>')).toBe(false);
  });

  it('is true for text and for a rule or a hard break on its own', () => {
    expect(hasVisibleContent('<p>kept</p>')).toBe(true);
    expect(hasVisibleContent('<hr>')).toBe(true);
    expect(hasVisibleContent('<p><br></p>')).toBe(true);
  });
});

/* A snippet is `plain_text` with the match wrapped in `mark`, and `plain_text` is
   whatever the user typed. FTS5 escapes none of it, so a note containing a script
   tag produces a snippet containing a script tag — and the snippet is the only
   backend-supplied markup that reaches the DOM anywhere in the app. */
describe('sanitizeSnippet', () => {
  it('keeps the highlight and the surrounding text', () => {
    expect(sanitizeSnippet('Blocked on the <mark>design review</mark> until Dana is back.')).toBe(
      'Blocked on the <mark>design review</mark> until Dana is back.',
    );
  });

  it('drops a script element that a note put into plain_text', () => {
    const clean = sanitizeSnippet('a <script>window.stolen = 1</script><mark>b</mark>');

    expect(clean).not.toContain('script');
    expect(clean).not.toContain('stolen');
    expect(clean).toContain('<mark>b</mark>');
  });

  it('keeps every element except mark out, however it was written', () => {
    const clean = sanitizeSnippet('<img src=x onerror="steal()"><b>bold</b>text');

    expect(clean).not.toContain('img');
    expect(clean).not.toContain('steal');
    expect(clean).not.toContain('<b>');
    expect(clean).toContain('bold');
  });

  it('strips attributes from the highlight itself', () => {
    const clean = sanitizeSnippet('<mark class="x" onclick="steal()">term</mark>');

    expect(clean).toBe('<mark>term</mark>');
  });

  it('returns an empty string when there is no snippet', () => {
    expect(sanitizeSnippet('')).toBe('');
  });
});
