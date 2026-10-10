/* WCAG 2.1 relative luminance and contrast ratio, over the app's own hex tokens.

   `05-ui-ux.md` §3.1 states contrast requirements as numbers, and §10 makes them
   acceptance criteria. A number in a document is only worth what checks it, so
   the arithmetic lives here rather than in the test that uses it: the settings
   dialog needs the same figure to warn about a custom accent, and two
   implementations of relative luminance would eventually disagree.

   Only the sRGB formula is implemented, because every token is a 6-digit hex.
   An alpha or a named colour has nowhere to be in a token table and would be a
   bug in the table rather than a case to support. */

export type Rgb = readonly [number, number, number];

/** Parses `#rrggbb`. Returns `null` for anything else rather than throwing, so
    a caller iterating user input can skip a malformed colour instead of
    crashing the settings dialog on a half-typed hex. */
export function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match?.[1] === undefined) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** The sRGB electro-optical transfer function, piecewise-linear about 0.03928 as
    the specification requires. Applying it once per channel is what separates a
    real ratio from one computed on gamma-encoded bytes, which overstates dark
    colours and would have hidden the failures in the accent set. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio between two colours, from 1 to 21. Order-independent:
    the lighter of the two always goes in the numerator. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Two 6-digit hexes, as `contrastRatio` takes them. */
export function contrastBetween(foreground: string, background: string): number | null {
  const a = parseHex(foreground);
  const b = parseHex(background);
  if (a === null || b === null) return null;
  return contrastRatio(a, b);
}