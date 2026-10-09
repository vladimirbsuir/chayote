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

/* Same problem, one layer up. `@tanstack/react-virtual` measures its scroll
   element with a `ResizeObserver` and reads the box through
   `getBoundingClientRect`. jsdom implements neither: `ResizeObserver` does not
   exist at all, and every rect is zero-sized, so a virtualiser asked to render a
   viewport of 0 px height renders no rows — a windowing component that looks
   broken in jsdom for a reason that has nothing to do with its logic.

   Reporting the jsdom window size is the honest stand-in: it is the only
   dimension jsdom knows, and a test asserting "a bounded number of cards are
   mounted" cares about the window, not the exact pixel count. Note that rows are
   still positioned by the virtualiser's own maths, so nothing about the
   windowing arithmetic is faked. */
if (!('ResizeObserver' in globalThis)) {
  /* The callback has to fire. A no-op observer is worse than none: the
     virtualiser would keep a 0 × 0 rect forever and render no rows at all,
     because a viewport of zero height contains nothing. Reporting the element's
     own box once on `observe` is what a real observer does on first layout. */
  class TestResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element): void {
      this.callback(
        [{ target, contentRect: target.getBoundingClientRect() } as unknown as ResizeObserverEntry],
        this,
      );
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = TestResizeObserver;
}

function viewportBox(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  const { width, height } = viewportBox();
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
};

/* `offsetWidth` and `offsetHeight` are what the virtualiser actually reads
   (`getRect` in `@tanstack/virtual-core`), not `getBoundingClientRect`, so
   stubbing only the rect would leave it measuring a zero-height viewport and
   rendering nothing. jsdom hard-codes both to 0, so they have to be redefined
   rather than assigned. */
for (const [property, dimension] of [
  ['offsetWidth', 'width'],
  ['offsetHeight', 'height'],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get(this: HTMLElement): number {
      return viewportBox()[dimension];
    },
  });
}