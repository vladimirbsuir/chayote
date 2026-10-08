import DOMPurify from 'dompurify'

/* Paste is the only place untrusted markup enters the app. The allowlist below
   is the intersection of `04-editor.md` §4.1 and the schema in §1.2. ProseMirror
   drops anything it does not parse on top of this, so an omission degrades to a
   lost node rather than a hole. */

/* §1.2 node names, plus the HTML shapes ProseMirror parses into the four marks:
   `strong`/`b` → bold, `em`/`i` → italic, `s`/`strike`/`del` → strike. `doc`,
   `paragraph`, `text`, and `hardBreak` have no distinct HTML counterpart. */
const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  's',
  'strike',
  'del',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
]

/* §4.1 rule 2: presentational attributes are stripped unconditionally, and what
   survives is only this. `href` and `src` are absent by design — §4.1 rule 3
   rejects every one of them, and v1 has no link mark and no image node. The two
   surviving attributes exist because a pasted table keeps its spans after
   §4.1 rule 6 flattens it into paragraphs. */
const ALLOWED_ATTR = ['colspan', 'rowspan']

/* §4.1 rule 4, plus the non-visual elements that would otherwise survive as
   empty boxes. */
const FORBID_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'meta',
  'link',
  'base',
  'img',
  'svg',
  'math',
  'video',
  'audio',
  'source',
  'track',
  'canvas',
  'noscript',
  'template',
  'frame',
  'frameset',
  'applet',
]

const MAX_NESTING_DEPTH = 12

/**
 * §4.2: sanitise the pasted HTML *before* ProseMirror parses it. Sanitising the
 * resulting tree instead would mean writing a second traversal, which is exactly
 * the easier-to-get-wrong variant this rule exists to reject.
 *
 * `ALLOWED_URI_REGEXP` matching nothing is redundant with `ALLOWED_ATTR` omitting
 * `href` and `src`; it is here so that adding a URL attribute later cannot
 * silently reopen a `javascript:` surface.
 */
export function sanitizeAndNormalize(html: string): string {
  if (html.length === 0) return ''

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    ALLOWED_URI_REGEXP: /^$/,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    WHOLE_DOCUMENT: false,
  }) as string

  if (clean.length === 0) return ''

  return reshape(clean)
}

/**
 * §4.1 rule 7: blank lines separate paragraphs, a single newline becomes a hard
 * break. Splitting rather than emitting one block per line keeps a pasted list of
 * single lines readable instead of a column of empty paragraphs.
 */
export function textToParagraphs(text: string): string {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  if (blocks.length === 0) return ''

  return blocks.map((block) => `<p>${escapeHtml(block.split('\n').join('<br>'))}</p>`).join('')
}

/** True when the sanitised markup would leave something visible in the document. */
export function hasVisibleContent(html: string): boolean {
  if (html.length === 0) return false
  if (/<(?:hr|br)\s*\/?>/i.test(html)) return true
  const doc = parse(html)
  return doc === null ? false : (doc.body?.textContent?.trim().length ?? 0) > 0
}

/**
 * §4.1 rule 6 — table cells become paragraphs in reading order. The table
 * elements are allowed through DOMPurify precisely so that cell order survives
 * sanitisation, then flattened here; v1 has no table node.
 * §4.1 rule 5 — nesting past 12 levels is unwrapped, so the validator in
 * `doc/validate.rs` never has to reject a depth it should have flattened.
 */
function reshape(html: string): string {
  const doc = parse(html)
  const { body } = doc ?? {}
  if (body === null || body === undefined) return html

  for (const cell of Array.from(body.querySelectorAll('td, th'))) {
    replaceWithParagraph(cell)
  }

  flatten(body, 1)
  return body.innerHTML
}

function parse(html: string): Document | null {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
}

function replaceWithParagraph(cell: Element): void {
  const parent = cell.parentNode
  if (parent === null) return

  const paragraph = cell.ownerDocument.createElement('p')
  while (cell.firstChild !== null) {
    paragraph.appendChild(cell.firstChild)
  }
  parent.replaceChild(paragraph, cell)
}

function flatten(node: Element, depth: number): void {
  for (const child of Array.from(node.children)) {
    if (depth >= MAX_NESTING_DEPTH) {
      unwrap(child)
      continue
    }
    flatten(child, depth + 1)
  }
}

function unwrap(element: Element): void {
  const parent = element.parentNode
  if (parent === null) return
  while (element.firstChild !== null) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export { ALLOWED_ATTR, ALLOWED_TAGS, FORBID_TAGS, MAX_NESTING_DEPTH }