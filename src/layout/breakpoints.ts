/* `05-ui-ux.md` §9. Two panes above 1024 px, an overlay drawer at 768–1023 px
   where the editor takes the full width, and a single pane with a view stack
   below 768 px (ADR-006).

   The breakpoint lives in JS rather than in a media query because it decides
   which components mount, not how they are styled: the drawer and the two-pane
   layout are different component trees, and CSS alone cannot unmount one.

   The sidebar is resizable between 240 and 480 px and collapses entirely. The
   width and the collapsed flag are separate settings, so toggling back restores
   the width the user chose rather than the minimum. */

export const MOBILE_MAX = 768;
export const TABLET_MAX = 1024;

export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_WIDE = 320;
export const SIDEBAR_NARROW = 280;

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export function breakpointOf(width: number): Breakpoint {
  if (width < MOBILE_MAX) return 'mobile';
  if (width < TABLET_MAX) return 'tablet';
  return 'desktop';
}

/* A phone in landscape is still a phone. Width alone reports 800+ px after
   rotation, which would flip the navigation model under the user: the tablet
   band always renders the editor, so rotating on the list yanked the user
   into the last-opened note with desktop chrome. The navigation model is a
   device property (ADR-006), not a width — `01-product.md` §8 requires the
   Android UI to run correctly in both orientations — so on Android the answer
   is always the single-pane stack. The System WebView UA carries "Android";
   no desktop UA does. */
export function isAndroidWebView(userAgent: string): boolean {
  return /android/i.test(userAgent);
}

/** 320 px above 1280 px, 280 px in the 1024–1279 band (§9). Only used to seed the
    persisted width the first time the app runs; after that the user's choice
    wins. */
export function defaultSidebarWidth(width: number): number {
  return width >= 1280 ? SIDEBAR_WIDE : SIDEBAR_NARROW;
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}