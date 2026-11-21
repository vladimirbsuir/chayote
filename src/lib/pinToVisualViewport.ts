const ROOT = 'root';

export function pinToVisualViewport(): () => void {
  const viewport = window.visualViewport;
  const container = document.getElementById(ROOT);
  if (viewport === null || container === null) {
    return () => {};
  }

  const sync = (): void => {
    container.style.setProperty('--app-viewport-top', `${Math.round(viewport.offsetTop)}px`);
    container.style.setProperty('--app-viewport-height', `${Math.round(viewport.height)}px`);
  };

  sync();
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  return () => {
    viewport.removeEventListener('resize', sync);
    viewport.removeEventListener('scroll', sync);
  };
}
