import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';

/* `05-ui-ux.md` §9: chrome text is not selectable — only text inputs and the
   editor content are. The bar's brand, field box, hint and menu are read and
   pressed, never copied; both search fields opt back in with `select-text`. */

function bar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}): void {
  const props: React.ComponentProps<typeof TopBar> = {
    searchValue: '',
    inputRef: createRef<HTMLInputElement>(),
    onSearchChange: () => {},
    onNewNote: () => {},
    onToggleTheme: () => {},
    theme: 'light',
    onOpenOverflow: () => {},
    ...overrides,
  };
  render(<TopBar {...props} />);
}

function searchbox(): HTMLInputElement {
  const found = screen.getByRole('searchbox', { name: 'Search notes' });
  if (!(found instanceof HTMLInputElement)) throw new Error('no search field');
  return found;
}

describe('TopBar selection', () => {
  it('renders the desktop bar unselectable', () => {
    bar();

    expect(document.querySelector('header')?.className).toContain('select-none');
  });

  it('keeps the desktop search field selectable', () => {
    bar();

    expect(searchbox().className).toContain('select-text');
  });

  it('renders the desktop overflow menu unselectable', () => {
    bar();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    expect(screen.getByTestId('topbar-overflow').className).toContain('select-none');
  });

  it('renders the mobile bar unselectable', () => {
    bar({ variant: 'mobile' });

    expect(document.querySelector('header')?.className).toContain('select-none');
  });

  it('keeps the mobile search field selectable', () => {
    bar({ variant: 'mobile' });

    expect(searchbox().className).toContain('select-text');
  });
});
