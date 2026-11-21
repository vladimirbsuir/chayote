import DOMPurify from 'dompurify'

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

const ALLOWED_ATTR = ['colspan', 'rowspan']

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

const MAX_NESTING_DEPTH = 11

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
  })

  if (clean.length === 0) return ''

  return reshape(clean)
}

export function textToParagraphs(text: string): string {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  if (blocks.length === 0) return ''

  return blocks.map((block) => `<p>${escapeHtml(block).split('\n').join('<br>')}</p>`).join('')
}

export function hasVisibleContent(html: string): boolean {
  if (html.length === 0) return false;
  if (/<(?:hr|br)\s*\/?>/i.test(html)) return true;
  return bodyOf(html).textContent.trim().length > 0;
}

export function sanitizeSnippet(html: string): string {
  if (html.length === 0) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: SNIPPET_TAGS,
    ALLOWED_ATTR: SNIPPET_ATTR,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    WHOLE_DOCUMENT: false,
  });
}

const SNIPPET_TAGS = ['mark'];
const SNIPPET_ATTR: string[] = [];

function reshape(html: string): string {
  const body = bodyOf(html)

  for (const cell of Array.from(body.querySelectorAll('td, th'))) {
    replaceWithParagraph(cell)
  }

  for (const wrapper of Array.from(body.querySelectorAll('table, thead, tbody, tr'))) {
    unwrap(wrapper)
  }

  flatten(body, 1)
  return body.innerHTML
}

function bodyOf(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
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
  if (depth >= MAX_NESTING_DEPTH) {
    for (const descendant of Array.from(node.querySelectorAll('*'))) {
      if (descendant.tagName !== 'BR') unwrap(descendant)
    }
    return
  }
  for (const child of Array.from(node.children)) {
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