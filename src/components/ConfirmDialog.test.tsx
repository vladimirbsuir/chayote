import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/* `05-ui-ux.md` §10: "Opening a dialog moves focus in and traps it; `Esc` closes
   and restores focus to the trigger." All three are about focus, and none of them
   is visible in a screenshot — a dialog that lets `Tab` walk behind it looks
   perfect and lets the next keystroke land in a note the user thinks is not being
   edited. So these assert on `document.activeElement` throughout. */

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

  /* A button that opens the dialog, so the focus-restore round trip can be
     asserted end to end. The dialog captures `document.activeElement` on mount,
     which is why the trigger has to hold focus *before* the dialog renders — the
     real ordering, and the only one where "restores focus to the trigger" means
     anything. */
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

    /* Focus is back where the user left it, so the next `Tab` continues from the
       row they acted on rather than from the top of the document. */
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
    /* `preventDefault` is what stops the browser's own Tab from moving focus out
       of the dialog; observing the wrap is how that is asserted from outside. */
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

    /* Destructive confirmation: the safe action is the one `Enter` reaches first.
       The visual order matches, so the focus order cannot disagree with what the
       user sees. */
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Delete folder']);
    /* And focus actually lands there, rather than on the destructive one. */
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('leaves a Tab that is moving between its own controls alone', () => {
    renderDialog();

    const cancel = screen.getByRole('button', { name: 'Cancel' });

    /* Not prevented, so the browser's own order applies. The trap must fire only
       at the two ends of the list, or the dialog becomes unusable. */
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