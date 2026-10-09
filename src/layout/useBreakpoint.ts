import { useEffect, useState } from 'react';
import { TABLET_MAX, type Breakpoint, breakpointOf } from './breakpoints';

/* The responsive breakpoint of `05-ui-ux.md` §9, in JS.

   §2.3 and §2.4 are not styling differences — the tablet drawer and the mobile
   view stack mount different component trees. A media query can restyle one
   tree into another but cannot unmount it, so the decision has to live where the
   components are chosen.

   One resize listener on the window rather than a `matchMedia` query per
   breakpoint: the three thresholds are adjacent integers, so a single width read
   answers the same question with one listener instead of three. */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() =>
    breakpointOf(typeof window === 'undefined' ? TABLET_MAX : window.innerWidth),
  );

  useEffect(() => {
    const onResize = (): void => {
      setBreakpoint(breakpointOf(window.innerWidth));
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