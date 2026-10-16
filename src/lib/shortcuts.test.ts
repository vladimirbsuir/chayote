import { describe, expect, it } from 'vitest';
import { isLetterShortcut } from './shortcuts';

/* Ctrl/Cmd shortcuts must survive a layout switch: with a Russian layout the
   F key reports "а", so matching `event.key` alone strands them. Found on
   desktop, where the browser find bar opened instead of the note search. */

describe('isLetterShortcut', () => {
  it('matches the Latin key and code', () => {
    expect(isLetterShortcut({ key: 'f', code: 'KeyF' }, 'f')).toBe(true);
    expect(isLetterShortcut({ key: 'F', code: 'KeyF' }, 'f')).toBe(true);
  });

  it('matches by physical code when the layout prints another letter', () => {
    expect(isLetterShortcut({ key: 'а', code: 'KeyF' }, 'f')).toBe(true);
    expect(isLetterShortcut({ key: 'ы', code: 'KeyS' }, 's')).toBe(true);
    expect(isLetterShortcut({ key: 'в', code: 'KeyD' }, 'd')).toBe(true);
  });

  it('rejects other keys', () => {
    expect(isLetterShortcut({ key: 'x', code: 'KeyX' }, 'f')).toBe(false);
    expect(isLetterShortcut({ key: 'а', code: 'KeyF' }, 'n')).toBe(false);
  });
});
