import { describe, expect, it } from 'vitest';
import { isLetterShortcut } from './shortcuts';

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

  it('follows the printed Latin letter, not the physical key, on Dvorak', () => {
    expect(isLetterShortcut({ key: 'b', code: 'KeyN' }, 'n')).toBe(false);
    expect(isLetterShortcut({ key: 'b', code: 'KeyN' }, 'b')).toBe(true);
    expect(isLetterShortcut({ key: 'u', code: 'KeyF' }, 'f')).toBe(false);
  });

  it('ignores AltGr, which reports Ctrl and Alt together', () => {
    expect(isLetterShortcut({ key: 'ń', code: 'KeyN', altKey: true }, 'n')).toBe(false);
    expect(isLetterShortcut({ key: 's', code: 'KeyS', altKey: true }, 's')).toBe(false);
  });

  it('rejects other keys', () => {
    expect(isLetterShortcut({ key: 'x', code: 'KeyX' }, 'f')).toBe(false);
    expect(isLetterShortcut({ key: 'а', code: 'KeyF' }, 'n')).toBe(false);
  });
});
