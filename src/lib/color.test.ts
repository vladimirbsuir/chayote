import { describe, expect, it } from 'vitest';
import { hexToHsl, hslToHex, normalizeHexInput, rgbToHex } from './color';

describe('color conversions', () => {
  it('round-trips presets through HSL within rounding', () => {
    for (const hex of ['#2769ec', '#1f7a4d', '#814ef5', '#c2410c', '#b91c5c', '#0f766e']) {
      const hsl = hexToHsl(hex);
      expect(hsl).not.toBeNull();
      if (hsl === null) continue;
      const roundTripped = hslToHex(hsl.h, hsl.s, hsl.l);
      const want = hex.toLowerCase();
      expect(roundTripped.slice(0, 1)).toBe('#');
      for (const offset of [1, 3, 5]) {
        const a = parseInt(roundTripped.slice(offset, offset + 2), 16);
        const b = parseInt(want.slice(offset, offset + 2), 16);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('maps primary hues to their angles', () => {
    expect(hexToHsl('#ff0000')).toMatchObject({ h: 0 });
    expect(hexToHsl('#00ff00')).toMatchObject({ h: 120 });
    expect(hexToHsl('#0000ff')).toMatchObject({ h: 240 });
    expect(hexToHsl('#808080')?.s).toBe(0);
  });

  it('rejects non-hex input', () => {
    expect(hexToHsl('not-a-colour')).toBeNull();
    expect(hexToHsl('#12345')).toBeNull();
  });

  it('normalizes hex input with or without a hash', () => {
    expect(normalizeHexInput('#4a4a4a')).toBe('#4a4a4a');
    expect(normalizeHexInput('4a4a4a')).toBe('#4a4a4a');
    expect(normalizeHexInput('#ABC')).toBe('#aabbcc');
    expect(normalizeHexInput('  #1A3FA8  ')).toBe('#1a3fa8');
    expect(normalizeHexInput('#12')).toBeNull();
    expect(normalizeHexInput('blue')).toBeNull();
    expect(normalizeHexInput('')).toBeNull();
  });

  it('formats rgb channels as a six-digit hex', () => {
    expect(rgbToHex([255, 0, 0])).toBe('#ff0000');
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
    expect(rgbToHex([255, 255, 255])).toBe('#ffffff');
  });
});
