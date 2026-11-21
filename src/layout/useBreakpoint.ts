import { useEffect, useState } from 'react';
import { type Breakpoint, breakpointOf, isAndroidWebView } from './breakpoints';

function current(): Breakpoint {
  if (typeof window === 'undefined') return 'tablet';
  if (isAndroidWebView(window.navigator.userAgent)) return 'mobile';
  return breakpointOf(window.innerWidth);
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => current());

  useEffect(() => {
    const onResize = (): void => {
      setBreakpoint(current());
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return breakpoint;
}

export { MOBILE_MAX, TABLET_MAX } from './breakpoints';