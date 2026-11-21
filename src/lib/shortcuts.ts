export function isLetterShortcut(
  event: { key: string; code: string; altKey?: boolean },
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
  if (event.altKey === true) return false;
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key === letter;
  return event.code === `Key${letter.toUpperCase()}`;
}
