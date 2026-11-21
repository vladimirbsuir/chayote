import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

afterEach(() => {
  cleanup();
});

function Dialog({ onCancel }: { onCancel: () => void }): React.ReactElement {
  const { panelRef, onKeyDown } = useDialogFocus(onCancel);
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" onKeyDown={onKeyDown}>
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

describe('useDialogFocus', () => {
  it('pulls Tab back into the dialog after focus fell to the page', () => {
    render(
      <>
        <button type="button">Behind</button>
        <Dialog onCancel={vi.fn()} />
      </>,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
  });

  it('still closes on Escape pressed outside the panel', () => {
    const onCancel = vi.fn();
    render(<Dialog onCancel={onCancel} />);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
