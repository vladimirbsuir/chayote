/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS } from '../lib/settings';
import { contrastBetween } from '../lib/contrast';

const ROOT = process.cwd();
const TOKENS_PATH = resolve(ROOT, 'src/styles/tokens.css');
const PROTOTYPE_PATH = resolve(ROOT, 'prototype/index.html');

type Block = { name: string; variables: Map<string, string> };

function blocks(): Block[] {
  const css = readFileSync(TOKENS_PATH, 'utf8');
  const found: Block[] = [];

  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const dark = /\[data-theme=['"]dark['"]\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  for (const [name, body] of [
    ['light', root],
    ['dark', dark],
  ] as const) {
    const variables = new Map<string, string>();
    for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) variables.set(key, value.trim());
    }
    found.push({ name, variables });
  }
  return found;
}

function valueOf(block: Block, key: string): string {
  const value = block.variables.get(key);
  if (value === undefined) throw new Error(`${key} is missing from the ${block.name} tokens`);
  return value;
}

const BODY_TEXT = 4.5;
const BODY_ON_SURFACE = 7;
const BODY_ON_RAISED = 4.5;

describe('token contrast', () => {
  const [light, dark] = blocks() as [Block, Block];

  it('parses both theme blocks', () => {
    expect(light.variables.get('--surface')).toBe('#ffffff');
    expect(dark.variables.get('--surface')).toBe('#161618');
  });

  it('body text on --surface reaches 7:1 in both themes', () => {
    for (const block of [light, dark]) {
      const ratio = contrastBetween(valueOf(block, '--text'), valueOf(block, '--surface'));
      expect(ratio, `${block.name} --text on --surface`).toBeGreaterThanOrEqual(BODY_ON_SURFACE);
    }
  });

  it('body text on --surface-raised reaches 4.5:1 in both themes', () => {
    for (const block of [light, dark]) {
      const ratio = contrastBetween(valueOf(block, '--text'), valueOf(block, '--surface-raised'));
      expect(ratio, `${block.name} --text on --surface-raised`).toBeGreaterThanOrEqual(
        BODY_ON_RAISED,
      );
    }
  });

  it('the muted and subtle text reaches the AA body bar on both surfaces', () => {
    for (const block of [light, dark]) {
      for (const key of ['--text-muted', '--text-subtle']) {
        for (const surface of ['--surface', '--surface-raised']) {
          const ratio = contrastBetween(valueOf(block, key), valueOf(block, surface));
          expect(ratio, `${block.name} ${key} on ${surface}`).toBeGreaterThanOrEqual(BODY_TEXT);
        }
      }
    }
  });

  it('every accent preset reaches 4.5:1 in its own theme, on the raised surface', () => {
    for (const block of [light, dark]) {
      for (let n = 1; n <= 6; n += 1) {
        const accent = valueOf(block, `--accent-preset-${n}`);
        const ratio = contrastBetween(accent, valueOf(block, '--surface-raised'));
        expect(ratio, `${block.name} ${accent} on --surface-raised`).toBeGreaterThanOrEqual(
          BODY_TEXT,
        );
      }
    }
  });

  it('the accent is per-theme: no preset shares a value across the two blocks', () => {
    for (let n = 1; n <= 6; n += 1) {
      expect(valueOf(light, `--accent-preset-${n}`)).not.toBe(valueOf(dark, `--accent-preset-${n}`));
    }
  });

  it('--accent resolves from a preset rather than a literal', () => {
    for (const block of [light, dark]) {
      expect(valueOf(block, '--accent')).toBe('var(--accent-preset-1)');
    }
  });

  it('the preset data in settings matches the token file, in both themes', () => {
    for (const [block, key] of [
      [light, 'light'],
      [dark, 'dark'],
    ] as const) {
      for (const [index, preset] of ACCENT_PRESETS.entries()) {
        expect(preset[key], `preset ${index + 1} ${key}`).toBe(
          valueOf(block, `--accent-preset-${index + 1}`),
        );
      }
    }
  });

  it('the prototype carries the same light accent and swatches (ADR-016)', () => {
    const html = readFileSync(PROTOTYPE_PATH, 'utf8');
    expect(html).toContain(`--accent: ${valueOf(light, '--accent-preset-1')};`);
    for (const preset of ACCENT_PRESETS) {
      expect(html).toContain(`background:${preset.light}`);
    }
  });
});