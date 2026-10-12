import { parseHex } from './contrast';
import type { Rgb } from './contrast';

export type Hsl = { h: number; s: number; l: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const [r8, g8, b8] = rgb;
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  if (h < 0) h += 360;
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((Math.round(h) % 360) + 360) % 360;
  const sat = clamp(Math.round(s), 0, 100) / 100;
  const light = clamp(Math.round(l), 0, 100) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

export function normalizeHexInput(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  const bare = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/.test(bare)) {
    const [r, g, b] = bare.split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/.test(bare)) return `#${bare}`;
  return null;
}
