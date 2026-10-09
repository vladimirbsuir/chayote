import type { ReactNode } from 'react';
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDE, clampSidebarWidth } from './breakpoints';

/* `05-ui-ux.md` §9. Two panes above 1024 px, an overlay drawer at 768–1023 px
   where the editor takes the full width, and a single pane with a view stack
   below 768 px (ADR-006).

   The breakpoint lives in JS rather than in a media query because it decides
   which components mount, not how they are styled: the drawer and the two-pane
   layout are different component trees, and CSS alone cannot unmount one. */

type DesktopLayoutProps = {
  sidebar: ReactNode;
  editor: ReactNode;
  sidebarWidth: number;
  onResize: (width: number) => void;
};

export function DesktopLayout({ sidebar, editor, sidebarWidth, onResize }: DesktopLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1">
      {sidebar}
      <ResizeHandle width={sidebarWidth} onResize={onResize} />
      {editor}
    </div>
  );
}

/* §9: resizable between 240 and 480 px, and keyboard-operable because every
   action is reachable by keyboard (§10). The separator carries the ARIA values
   so the current width is announced rather than only seen. */
function ResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      data-testid="sidebar-resize"
      onPointerDown={(event) => {
        const startX = event.clientX;
        const startWidth = width;
        const move = (moveEvent: PointerEvent): void => {
          onResize(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
        };
        const up = (): void => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onResize(clampSidebarWidth(width - 16));
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          onResize(clampSidebarWidth(width + 16));
        }
      }}
      /* Visually 1 px, but 9 px of hit area centred on it.

         A 1 px target is correct to look at and wrong to use: on every keystroke
         the resize moves the handle, and if the pointer or the caret follows the
         element rather than the page, focus leaves for whatever is under it. The
         negative margins keep the painted border where §9 puts it while the
         clickable and focusable region is the 9 px a control is expected to have
         (`05-ui-ux.md` §3.3 gives 32 px to icon buttons; a separator this narrow
         is the one place a smaller target is acceptable, and 9 px is where the
         drag starts feeling accidental rather than deliberate). */
      className="relative z-10 -mr-1 w-[9px] flex-none cursor-col-resize bg-transparent outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-[var(--border)] before:transition-colors hover:before:bg-[var(--accent)] focus-visible:before:bg-[var(--accent)] focus-visible:before:w-[3px]"
    />
  );
}

type TabletLayoutProps = {
  sidebar: ReactNode;
  editor: ReactNode;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
};

/* §2.3: the sidebar overlays the editor as a 320 px drawer with a scrim. The
   editor stays mounted underneath, so opening and closing the drawer costs no
   editor rebuild and no lost editor state. */
export function TabletLayout({
  sidebar,
  editor,
  drawerOpen,
  onDrawerOpenChange,
}: TabletLayoutProps) {
  return (
    <div className="relative flex min-h-0 flex-1">
      {editor}
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          data-testid="drawer-scrim"
          onClick={() => {
            onDrawerOpenChange(false);
          }}
          className="absolute inset-0 z-10 bg-[rgb(0_0_0/0.32)]"
        />
      ) : null}
      <div
        data-testid="sidebar-drawer"
        data-open={drawerOpen ? 'true' : 'false'}
        style={{ width: SIDEBAR_WIDE }}
        className={`absolute inset-y-0 left-0 z-20 flex flex-col border-r border-[var(--border)] bg-[var(--surface-raised)] transition-transform duration-150 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </div>
    </div>
  );
}

type MobileLayoutProps = {
  editor: ReactNode;
  list: ReactNode;
  /** Which of the two panes is visible. One at a time (§2.4). */
  view: 'list' | 'editor';
};

/* §2.4: one view at a time, the list → editor transition a horizontal slide.
   `06-platform.md` §4.3: never size a fixed element with `vh` here — the
   on-screen keyboard changes the visible height — so the layout is flex and
   fills whatever the WebView gives it. */
export function MobileLayout({ editor, list, view }: MobileLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)]" data-view={view}>
      {view === 'editor' ? editor : list}
    </div>
  );
}