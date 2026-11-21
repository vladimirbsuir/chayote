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

export function isAndroidWebView(userAgent: string): boolean {
  return /android/i.test(userAgent);
}

export function defaultSidebarWidth(width: number): number {
  return width >= 1280 ? SIDEBAR_WIDE : SIDEBAR_NARROW;
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}