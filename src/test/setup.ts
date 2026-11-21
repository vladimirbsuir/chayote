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

if (!('ResizeObserver' in globalThis)) {
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