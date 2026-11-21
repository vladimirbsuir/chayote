import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const props: React.ComponentProps<typeof ConfirmDialog> = {
      title: 'Delete “Work”?',
      body: 'It contains 2 folders, which will be deleted with it.',
      confirmLabel: 'Delete folder',
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    };
    render(<ConfirmDialog {...props} />);
    return props;
  }

  function Harness({ onConfirm }: { onConfirm: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          data-testid="trigger"
          onClick={() => {
            setOpen(true);
          }}
        >
          Delete
        </button>
        {open ? (
          <ConfirmDialog
            title="Delete “Work”?"
            body="It contains 2 folders, which will be deleted with it."
            confirmLabel="Delete folder"
            onConfirm={() => {
              onConfirm();
              setOpen(false);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </>
    );
  }

  it('is a modal dialog with a name and a description', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('confirm-dialog-body');
    expect(screen.getByText('Delete “Work”?')).toBeDefined();
  });

  it('renders its copy unselectable, so a hold never selects the warning', () => {
    renderDialog();

    expect(screen.getByRole('dialog').className).toContain('select-none');
  });

  it('names the consequence and its count', () => {
    renderDialog();

    expect(screen.getByText(/contains 2 folders/)).toBeDefined();
  });

  it('moves focus into the dialog on open', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(document.activeElement);
  });

  it('restores focus to the trigger after the dialog closes', () => {
    render(<Harness onConfirm={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    act(() => {
      trigger.focus();
    });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeDefined();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus after a confirmation too, not only after a cancel', () => {
    render(<Harness onConfirm={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    act(() => {
      trigger.focus();
    });
    fireEvent.click(trigger);

    act(() => {
      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    });

    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last control back to the first, so focus cannot escape', () => {
    renderDialog();

    const confirm = screen.getByTestId('confirm-dialog-confirm');
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    act(() => {
      confirm.focus();
    });
    const notPrevented = fireEvent.keyDown(confirm, { key: 'Tab' });

    expect(notPrevented).toBe(false);
    expect(cancel).toBeDefined();
  });

  it('closes on Escape without confirming', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderDialog({ onCancel, onConfirm });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms on the confirm button and does not also cancel', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderDialog({ onCancel, onConfirm });

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('puts Cancel first in the tab order, so Enter means Cancel by default', () => {
    renderDialog();

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Delete folder']);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('leaves a Tab that is moving between its own controls alone', () => {
    renderDialog();

    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(fireEvent.keyDown(cancel, { key: 'Tab' })).toBe(true);
  });

  it('paints the destructive action in the danger token', () => {
    renderDialog();

    const confirm = screen.getByTestId('confirm-dialog-confirm');
    expect(confirm.className).toContain('var(--danger)');
  });

  it('uses the warning tone for a non-destructive variant', () => {
    renderDialog({ tone: 'warning', confirmLabel: 'Empty trash' });

    expect(screen.getByTestId('confirm-dialog-confirm').className).toContain('var(--warning)');
  });
});