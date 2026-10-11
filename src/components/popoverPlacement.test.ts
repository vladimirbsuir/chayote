import { afterEach, describe, expect, it, vi } from 'vitest';
import { popoverPlacement } from './popoverPlacement';

/* The status-bar popovers open upward from their anchor — except on a narrow
   viewport, where a 260 px panel at the anchor's edge parks against the screen
   edge and is centred instead. Found on a phone: the tag editor hugged the
   right edge. */

function anchorAt(left: number, top: number): HTMLElement {
  const element = document.createElement('button');
  const rect: DOMRect = {
    left,
    top,
    right: left + 44,
    bottom: top + 44,
    width: 44,
    height: 44,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
  return element;
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

describe('popoverPlacement', () => {
  afterEach(() => {
    setViewportWidth(1024);
  });

  it('opens at the anchor edge on a wide viewport', () => {
    setViewportWidth(1280);

    expect(popoverPlacement(anchorAt(500, 700))).toEqual({ top: 412, left: 500 });
  });

  it('clamps to the viewport rather than overflowing the right edge', () => {
    setViewportWidth(1280);

    expect(popoverPlacement(anchorAt(1200, 700))).toEqual({ top: 412, left: 1012 });
  });

  it('centres the panel on a narrow viewport instead of hugging the edge', () => {
    setViewportWidth(360);

    /* (360 − 260) / 2: equal margins, reachable by either thumb. */
    expect(popoverPlacement(anchorAt(105, 700))).toEqual({ top: 412, left: 50 });
  });

  it('never parks above the viewport', () => {
    setViewportWidth(360);

    expect(popoverPlacement(anchorAt(105, 100)).top).toBe(8);
  });
});
