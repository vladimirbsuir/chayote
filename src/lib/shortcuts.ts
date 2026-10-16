/* Layout-independent letter match for Ctrl/Cmd shortcuts (`05-ui-ux.md` §7).
   `event.key` carries the printed letter — "а" on a Russian layout for the
   physical F key — while `code` names that physical key (`KeyF`) whatever is
   printed on it. Matching the key alone strands every shortcut on a
   non-Latin layout; matching the code alone would miss exotic keyboards that
   report no code, so both count. */

/** Whether the event is Ctrl/Cmd plus the given Latin letter, on any layout. */
export function isLetterShortcut(
  event: { key: string; code: string },
  letter:
    | 'a'
    | 'b'
    | 'c'
    | 'd'
    | 'e'
    | 'f'
    | 'g'
    | 'h'
    | 'i'
    | 'j'
    | 'k'
    | 'l'
    | 'm'
    | 'n'
    | 'o'
    | 'p'
    | 'q'
    | 'r'
    | 's'
    | 't'
    | 'u'
    | 'v'
    | 'w'
    | 'x'
    | 'y'
    | 'z',
): boolean {
  return event.key.toLowerCase() === letter || event.code === `Key${letter.toUpperCase()}`;
}
