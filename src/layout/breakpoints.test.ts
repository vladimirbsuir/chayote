import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  breakpointOf,
  clampSidebarWidth,
  defaultSidebarWidth,
  isAndroidWebView,
} from './breakpoints';
import { INITIAL_STACK, canPop, currentView, popView, pushView } from './viewStack';

/* The two layout rules of `05-ui-ux.md` §9 and §2.4. Both are pure functions on
   purpose: the view stack in particular is the thing the Android back button
   will drive in M7, and "what does back do at depth 1" is a rule rather than a
   handler. */

describe('breakpointOf', () => {
  it('treats anything under 768 px as mobile', () => {
    expect(breakpointOf(360)).toBe('mobile');
    expect(breakpointOf(767)).toBe('mobile');
  });

  it('treats 768–1023 px as the overlay drawer', () => {
    expect(breakpointOf(768)).toBe('tablet');
    expect(breakpointOf(900)).toBe('tablet');
    expect(breakpointOf(1023)).toBe('tablet');
  });

  it('treats 1024 px and up as two panes', () => {
    expect(breakpointOf(1024)).toBe('desktop');
    expect(breakpointOf(1280)).toBe('desktop');
    expect(breakpointOf(3840)).toBe('desktop');
  });

  it('seeds 320 px above 1280 and 280 px in the narrower desktop band', () => {
    expect(defaultSidebarWidth(1280)).toBe(320);
    expect(defaultSidebarWidth(1920)).toBe(320);
    expect(defaultSidebarWidth(1024)).toBe(280);
    expect(defaultSidebarWidth(1279)).toBe(280);
  });
});

describe('isAndroidWebView', () => {
  /* Found on a phone: rotation to landscape widened the viewport past 768 px
     and flipped the navigation model, yanking the list into the editor with
     desktop chrome. Width bands govern desktop windows; the device decides. */
  const ANDROID_PHONE =
    'Mozilla/5.0 (Linux; Android 13; X6836 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.57 Mobile Safari/537.36';

  it('recognises the System WebView UA, portrait or landscape', () => {
    expect(isAndroidWebView(ANDROID_PHONE)).toBe(true);
  });

  it('ignores desktop UAs, so narrow windows keep the width bands', () => {
    expect(
      isAndroidWebView(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    expect(
      isAndroidWebView(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe(false);
    expect(isAndroidWebView('')).toBe(false);
  });
});

describe('clampSidebarWidth', () => {
  it('holds the 240–480 px range from §9', () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(100)).toBe(240);
    expect(clampSidebarWidth(320)).toBe(320);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(480)).toBe(480);
  });

  it('rounds to whole pixels so a drag cannot store a fractional width', () => {
    expect(clampSidebarWidth(301.6)).toBe(302);
    expect(clampSidebarWidth(299.4)).toBe(299);
  });
});

describe('view stack', () => {
  it('starts on the list', () => {
    expect(currentView(INITIAL_STACK)).toBe('list');
    expect(canPop(INITIAL_STACK)).toBe(false);
  });

  it('pushes the editor view and pops back to the list', () => {
    const opened = pushView(INITIAL_STACK, 'editor');
    expect(currentView(opened)).toBe('editor');
    expect(canPop(opened)).toBe(true);
    expect(currentView(popView(opened))).toBe('list');
  });

  it('ignores a push of the view already showing', () => {
    expect(pushView(INITIAL_STACK, 'list')).toBe(INITIAL_STACK);
    const opened = pushView(INITIAL_STACK, 'editor');
    expect(pushView(opened, 'editor')).toBe(opened);
  });

  it('refuses to pop at the root, so back falls through to the platform', () => {
    expect(popView(INITIAL_STACK)).toBe(INITIAL_STACK);
  });

  it('never grows past the list→editor pair', () => {
    let state = INITIAL_STACK;
    for (let i = 0; i < 5; i += 1) {
      state = pushView(state, 'editor');
    }
    expect(state.stack).toHaveLength(2);
  });
});