import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteHeader } from './NoteHeader';

function header(overrides: Partial<React.ComponentProps<typeof NoteHeader>> = {}) {
  const props: React.ComponentProps<typeof NoteHeader> = {
    title: 'Meeting notes',
    updatedAt: Date.UTC(2026, 9, 16, 17, 26),
    onChange: () => {},
    onCommit: () => {},
    ...overrides,
  };
  return render(<NoteHeader {...props} />);
}

describe('NoteHeader', () => {
  it('shows the title and the date it was last changed', () => {
    header();

    expect(screen.getByTestId('note-title-input')).toHaveProperty('value', 'Meeting notes');
    expect(screen.getByTestId('note-updated-at').textContent).toBe(
      new Date(Date.UTC(2026, 9, 16, 17, 26)).toLocaleString(),
    );
  });

  it('offers "Title" as the placeholder on an unnamed note', () => {
    header({ title: '' });

    expect(screen.getByTestId('note-title-input')).toHaveProperty('value', '');
    expect(screen.getByPlaceholderText('Title')).toBeDefined();
  });

  it('leaves the date line out when the note has no saved state yet', () => {
    header({ updatedAt: null });

    expect(screen.queryByTestId('note-updated-at')).toBeNull();
  });

  it('reports every keystroke', () => {
    const onChange = vi.fn();
    header({ onChange });

    fireEvent.change(screen.getByTestId('note-title-input'), { target: { value: 'Plan' } });

    expect(onChange).toHaveBeenCalledWith('Plan');
  });

  it('hands over to the body on Enter, and on blur', () => {
    const onCommit = vi.fn();
    header({ onCommit });

    fireEvent.keyDown(screen.getByTestId('note-title-input'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);

    fireEvent.blur(screen.getByTestId('note-title-input'));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('keeps Shift+Enter as a line break, which the title then holds', () => {
    const onCommit = vi.fn();
    header({ onCommit });

    fireEvent.keyDown(screen.getByTestId('note-title-input'), { key: 'Enter', shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('is a textarea that grows and stops at four lines', () => {
    header();

    const input = screen.getByTestId('note-title-input');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.getAttribute('rows')).toBe('1');
    expect(input.className).toContain('resize-none');
    expect(input.className).toContain('overflow-y-auto');
  });

  it('is labelled, and the label is not only a placeholder', () => {
    header();

    expect(screen.getByLabelText('Note title')).toBe(screen.getByTestId('note-title-input'));
  });

  it('is selectable even though the editor chrome around it is not', () => {
    header();

    expect(screen.getByTestId('note-title-input').className).toContain('select-text');
  });
});
