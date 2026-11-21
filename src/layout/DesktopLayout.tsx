import type { ReactNode } from 'react';
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDE, clampSidebarWidth } from './breakpoints';

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
  view: 'list' | 'editor';
};

export function MobileLayout({ editor, list, view }: MobileLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)]" data-view={view}>
      {view === 'editor' ? editor : list}
    </div>
  );
}