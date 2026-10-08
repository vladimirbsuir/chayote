/* jsdom has no layout engine, so `Range` lacks the two methods ProseMirror calls
   whenever it resolves a selection or scrolls to it. Without these, `useEditor`
   throws on `autofocus` and every transaction becomes an unhandled rejection.
   A zero-size rect is the honest answer for a document with no layout: it makes
   the editor believe nothing is visible, which never affects the document model
   the tests assert on. */

const NO_RECTS = Object.assign([], { item: (): null => null }) as DOMRectList;

Range.prototype.getClientRects = (): DOMRectList => NO_RECTS;

Range.prototype.getBoundingClientRect = (): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});

Element.prototype.scrollIntoView = (): void => {};