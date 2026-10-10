import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';
import { nextTheme, themeLabel } from '../lib/theme';

/* `05-ui-ux.md` §4 names `ThemeToggle` as the Light / Dark / System cycle and
   §7 binds `Ctrl/Cmd+Shift+L` to it. The shortcut and the button have to run the
   same cycle, and the button and the dialog have to show the same three states,
   so the cycle is a named function with its own test rather than an increment
   written twice. */

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
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('reports the value it was given', () => {
    render(<ThemeToggle value="system" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(themeLabel('system')).toBe('System');
  });

  it('is one tab stop with a roving tabindex, as a radiogroup should be', () => {
    /* Ten focus stops for three options is the same mistake §10.1 records for
       the folder tree: the tab order would spend more presses on the control
       than on the thing the control is for. */
    render(<ThemeToggle value="light" onChange={() => {}} />);
    const stops = screen.getAllByRole('radio').filter((node) => node.getAttribute('tabindex') === '0');
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
    /* Driven from each state rather than three presses on one value: the
       component is controlled, so holding `value` still would ask it the same
       question three times. What is under test is the step from each state. */
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