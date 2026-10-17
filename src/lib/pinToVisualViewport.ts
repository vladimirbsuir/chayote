/* Glues the app to the part of the layout the reader can actually see.

   Found on a phone, and it is not a styling mistake — it is the WebView and the
   keyboard disagreeing about what "the screen" means.

   `06-platform.md` §4.3 declares `adjustResize`, and it is set. On the Infinix
   (Android 13, WebView 153) the IME does not shrink the **layout** viewport:
   measured with the keyboard up, `window.innerHeight` stayed 820 while
   `visualViewport.height` fell to 525 and `visualViewport.offsetTop` became 295.
   The app is laid out against 820, so the browser pinned the visible window to
   the bottom of it — 295 px of the app, the whole editor header, sat above the
   fold with no way to bring it back, and dragging moved the window rather than
   the text. `document.scrollingElement.scrollTop` stayed 0 throughout: the page
   was not scrolling, the *viewport* was, and no amount of `overflow` or `min-h-0`
   on our own elements can reach that.

   So the app is positioned and sized against the visual viewport instead. Where
   the two agree — every desktop browser, and any phone with the keyboard closed —
   this is exactly `inset: 0` and changes nothing, which is why it belongs in the
   app rather than in a platform check.

   Measured after: the back bar, the toolbar, the title, the date and the status
   row are all on screen with the keyboard up, and the status row is no longer
   behind the keyboard either — which is the §3.5a item that had been recorded as
   unfixed since M8.

   `position: fixed` rather than a transform, because a transform on `#root` would
   become the containing block for every `position: fixed` descendant — the undo
   toast is one, and it is positioned against the insets. */

const ROOT = 'root';

export function pinToVisualViewport(): () => void {
  const viewport = window.visualViewport;
  const container = document.getElementById(ROOT);
  /* jsdom reports no `visualViewport`, and so would a WebView older than the
     floor in `06-platform.md` §1. Then there is nothing to follow and the
     stylesheet's fallback — `inset: 0` — is the whole behaviour. */
  if (viewport === null || container === null) {
    return () => {};
  }

  const sync = (): void => {
    container.style.setProperty('--app-viewport-top', `${Math.round(viewport.offsetTop)}px`);
    container.style.setProperty('--app-viewport-height', `${Math.round(viewport.height)}px`);
  };

  sync();
  /* `resize` is the keyboard appearing and disappearing. `scroll` is the reader
     dragging the window — without it the app stays where it was and the drag looks
     like the app sliding under their finger, which is the other half of the
     report. */
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  return () => {
    viewport.removeEventListener('resize', sync);
    viewport.removeEventListener('scroll', sync);
  };
}
