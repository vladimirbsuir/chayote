import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';
import { nextTheme, nextVisibleTheme, themeLabel } from '../lib/theme';

describe('nextTheme', () => {
  it('cycles light to dark to system and back', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme('system')).toBe('light');
  });

  it('returns to where it started after three steps, from any state', () => {
    for (const theme of ['light', 'dark', 'system'] as const) {
      let current = theme;
      for (let step = 0; step < 3; step += 1) current = nextTheme(current);
      expect(current).toBe(theme);
    }
  });
});

describe('nextVisibleTheme', () => {
  it('skips system when the OS already shows what is on screen', () => {
    expect(nextVisibleTheme('dark', true)).toBe('light');
    expect(nextVisibleTheme('light', false)).toBe('dark');
  });

  it('keeps system when it would visibly change the theme', () => {
    expect(nextVisibleTheme('dark', false)).toBe('system');
    expect(nextVisibleTheme('light', true)).toBe('dark');
    expect(nextVisibleTheme('system', true)).toBe('light');
    expect(nextVisibleTheme('system', false)).toBe('dark');
  });
});

describe('ThemeToggle', () => {
  it('offers exactly the three states of 05-ui-ux.md 6.6, by name', () => {
    render(<ThemeToggle value="light" onChange={() => {}} />);
    for (const label of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('radio', { name: label })).toBeDefined();
    }
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the selected state with aria-checked, not colour alone', () => {
    render(<ThemeToggle value="dark" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('false');
  });

  it('reports the value it was given', () => {
    render(<ThemeToggle value="system" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    expect(themeLabel('system')).toBe('System');
  });

  it('is one tab stop with a roving tabindex, as a radiogroup should be', () => {
    render(<ThemeToggle value="light" onChange={() => {}} />);
    const stops = screen
      .getAllByRole('radio')
      .filter((node) => node.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('aria-checked')).toBe('true');
  });

  it('calls back with the state a click names', () => {
    const seen: string[] = [];
    render(
      <ThemeToggle
        value="light"
        onChange={(theme) => {
          seen.push(theme);
        }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(seen).toEqual(['system']);
  });

  it('moves the selection with the arrow keys, and wraps at both ends', () => {
    const step = (from: 'light' | 'dark' | 'system', key: string): string[] => {
      const seen: string[] = [];
      const { unmount } = render(
        <ThemeToggle
          value={from}
          onChange={(theme) => {
            seen.push(theme);
          }}
        />,
      );
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key });
      unmount();
      return seen;
    };

    expect(step('light', 'ArrowRight')).toEqual(['dark']);
    expect(step('dark', 'ArrowRight')).toEqual(['system']);
    expect(step('system', 'ArrowRight')).toEqual(['light']);
    expect(step('light', 'ArrowLeft')).toEqual(['system']);
    expect(step('system', 'ArrowLeft')).toEqual(['dark']);
  });

  it('decorates every icon rather than leaving one announced', () => {
    const { container } = render(<ThemeToggle value="light" onChange={() => {}} />);
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
