import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';
import type { FolderNode } from '../types/folder';

/* `05-ui-ux.md` §6.6: theme, accent, default folder, reset. §10 adds the focus
   obligations, and `05-ui-ux.md` §6.6's accent paragraph adds the one thing the
   dialog has to do that no other control does: measure a colour the user typed. */

const FOLDERS: FolderNode[] = [
  {
    id: 'f-work',
    name: 'Work',
    parentId: null,
    position: 0,
    children: [
      { id: 'f-projects', name: 'Projects', parentId: 'f-work', position: 0, children: [] },
    ],
  },
];

function open(overrides: Partial<Parameters<typeof SettingsDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onAccentChange = vi.fn();
  const onThemeChange = vi.fn();
  const onDefaultFolderChange = vi.fn();
  render(
    <SettingsDialog
      theme="light"
      effective="light"
      accent={null}
      defaultFolderId={null}
      folders={FOLDERS}
      onThemeChange={onThemeChange}
      onAccentChange={onAccentChange}
      onDefaultFolderChange={onDefaultFolderChange}
      onClose={onClose}
      confirmReset={null}
      {...overrides}
    />,
  );
  return { onClose, onAccentChange, onThemeChange, onDefaultFolderChange };
}

describe('SettingsDialog', () => {
  it('is a modal dialog with a name', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders its copy unselectable, so a hold never selects a label', () => {
    open();

    expect(screen.getByTestId('settings-dialog').className).toContain('select-none');
  });

  it('offers the three themes and reports the change', () => {
    const { onThemeChange } = open();
    expect(screen.getAllByRole('radio', { name: /Light|Dark|System/ }).length).toBe(3);
    fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('offers exactly six presets plus the custom control, all as radios', () => {
    open();
    const names = screen
      .getAllByRole('radio')
      .map((node) => node.getAttribute('aria-label'))
      .filter((label): label is string => label !== null);
    expect(names).toEqual([
      'Default',
      'Green',
      'Violet',
      'Rust',
      'Magenta',
      'Teal',
      'Custom colour',
    ]);
  });

it('a preset click names that preset, and the first one is the theme default', () => {
    /* By *index*, never by hex. The index becomes `var(--accent-preset-N)`
       inline, which the dark theme resolves to its own value; a hex would be a
       literal and would defeat the cascade — ADR-019. All six mapping to one
       value is the bug this shape exists to prevent: picking Teal would
       otherwise leave the default blue in place. */
    const { onAccentChange } = open({ accent: { kind: 'custom', hex: '#123456' } });

    fireEvent.click(screen.getByRole('radio', { name: 'Teal' }));
    expect(onAccentChange).toHaveBeenCalledWith({ kind: 'preset', index: 6 });

    onAccentChange.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'Default' }));
    expect(onAccentChange).toHaveBeenCalledWith({ kind: 'preset', index: 1 });
  });

  it('marks the chosen preset selected, and only it', () => {
    /* §10: the ring is not carrying the meaning alone, so `aria-checked` has to
       agree with the ring. */
    open({ accent: { kind: 'preset', index: 4 } });
    expect(screen.getByRole('radio', { name: 'Rust' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Default' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('marks the first preset selected when no accent is stored', () => {
    /* Caught by looking at `screenshots/settings-dark.png`, which is what level 2
       of `11-verification.md` §4 is for. `null` is the first preset — the theme's
       own default — and the readout says so, but no swatch carried the ring. */
    open({ accent: null });
    expect(screen.getByRole('radio', { name: 'Default' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    for (const name of ['Green', 'Violet', 'Rust', 'Magenta', 'Teal', 'Custom colour']) {
      expect(screen.getByRole('radio', { name }).getAttribute('aria-checked'), name).toBe(
        'false',
      );
    }
  });

  it('is one tab stop across all seven accent choices', () => {
    /* Six presets, a custom swatch and a colour input in a 28 px row: seven tab
       stops to get past would be the same mistake §10.1 records for the folder
       tree. Scoped to the accent group — the dialog has two radiogroups and the
       theme one legitimately has its own tab stop. */
    open({ accent: null });
    const group = screen.getByRole('radiogroup', { name: 'Accent colour' });
    const stops = Array.from(group.querySelectorAll('[role="radio"]')).filter(
      (node) => node.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('aria-label')).toBe('Default');
  });

  it('a custom click carries the hex, not a preset index', () => {
    const { onAccentChange } = open({ accent: null });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom colour' }));
    expect(onAccentChange).toHaveBeenCalledWith({ kind: 'custom', hex: '#2f6fed' });
  });

  it('names the theme the accent will be seen against', () => {
    const { unmount } = render(
      <SettingsDialog
        theme="dark"
        effective="dark"
        accent={null}
        defaultFolderId={null}
        folders={[]}
        onThemeChange={() => {}}
        onAccentChange={() => {}}
        onDefaultFolderChange={() => {}}
        onClose={() => {}}
        confirmReset={null}
      />,
    );
    expect(screen.getByText(/dark theme/)).toBeDefined();
    unmount();
  });

  it('reports a custom colour that is too weak, with its ratio', () => {
    /* §6.6 and ADR-019: a custom accent is the one thing that can fall under
       4.5:1, and the user should learn that while choosing it. */
    open({ accent: { kind: 'custom', hex: '#cccccc' } });
    expect(screen.getByText(/below the 4\.5:1/)).toBeDefined();
  });

  it('does not warn about a custom colour that passes', () => {
    open({ accent: { kind: 'custom', hex: '#1a3fa8' } });
    expect(screen.queryByText(/below the 4\.5:1/)).toBeNull();
    expect(screen.getByText(/Custom #1a3fa8 — \d+\.\d:1$/)).toBeDefined();
  });

  it('measures against the raised surface of the theme in effect', () => {
    /* `#4a4a4a` clears 4.5:1 on the light raised surface and fails it on the
       dark one. Reading the wrong surface would make the warning either silent
       or constant, and either way the user would stop believing it. */
    const { unmount } = render(
      <SettingsDialog
        theme="light"
        effective="light"
        accent={{ kind: 'custom', hex: '#4a4a4a' }}
        defaultFolderId={null}
        folders={[]}
        onThemeChange={() => {}}
        onAccentChange={() => {}}
        onDefaultFolderChange={() => {}}
        onClose={() => {}}
        confirmReset={null}
      />,
    );
    expect(screen.queryByText(/below the 4\.5:1/)).toBeNull();
    unmount();

    render(
      <SettingsDialog
        theme="dark"
        effective="dark"
        accent={{ kind: 'custom', hex: '#4a4a4a' }}
        defaultFolderId={null}
        folders={[]}
        onThemeChange={() => {}}
        onAccentChange={() => {}}
        onDefaultFolderChange={() => {}}
        onClose={() => {}}
        confirmReset={null}
      />,
    );
    expect(screen.getByText(/below the 4\.5:1/)).toBeDefined();
  });

  it('offers "None" for the default folder and indents children', () => {
    /* §6.1 resolves a new note's folder from this, and ADR-014 means "None" is
       the state first launch is in. The picker is the shared `FolderPicker` —
       flattened depth-first and indented by depth, as the status-bar one is. */
    open();

    expect(
      screen.getByRole('button', { name: 'Default folder for new notes' }).textContent,
    ).toContain('None — notes start unfiled');
    fireEvent.click(screen.getByRole('button', { name: 'Default folder for new notes' }));

    const options = screen.getAllByTestId('folder-picker-option');
    expect(options.map((option) => option.textContent)).toEqual([
      'None — notes start unfiled',
      'Work',
      'Projects',
    ]);
    /* Indented by depth in the option's own padding, not by whitespace: Work
       sits one level in at 20 px, its child Projects two at 34 px — the None
       option occupies depth zero. */
    expect(options[1]?.style.paddingLeft).toBe('20px');
    expect(options[2]?.style.paddingLeft).toBe('34px');
  });

  it('picks a folder through the shared picker and closes it', () => {
    const { onDefaultFolderChange } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Default folder for new notes' }));

    fireEvent.click(screen.getByRole('option', { name: 'Work' }));

    expect(onDefaultFolderChange).toHaveBeenCalledWith('f-work');
    expect(screen.queryByTestId('folder-picker-list')).toBeNull();
  });

  it('names the picked folder on the button', () => {
    open({ defaultFolderId: 'f-work' });

    expect(
      screen.getByRole('button', { name: 'Default folder for new notes' }).textContent,
    ).toContain('Work');
  });

  it('picks "None" back to unfiled', () => {
    const { onDefaultFolderChange } = open({ defaultFolderId: 'f-work' });
    fireEvent.click(screen.getByRole('button', { name: 'Default folder for new notes' }));

    fireEvent.click(screen.getByRole('option', { name: 'None — notes start unfiled' }));

    expect(onDefaultFolderChange).toHaveBeenCalledWith(null);
  });

  it('closes the picker on Escape without closing the dialog', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Default folder for new notes' }));
    expect(screen.getByTestId('folder-picker-list')).toBeDefined();

    /* The picker's own document listener consumes the key; the panel trap
       ignores keys from outside the panel's DOM, so the dialog stays. */
    fireEvent.keyDown(screen.getByTestId('folder-picker-list'), { key: 'Escape' });

    expect(screen.queryByTestId('folder-picker-list')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('closes the picker by pressing the button again', () => {
    /* The panel never covers the button, so pressing it again is always the
       fastest way to dismiss the list. */
    open();
    const button = screen.getByRole('button', { name: 'Default folder for new notes' });

    fireEvent.click(button);
    expect(screen.queryByTestId('folder-picker-list')).not.toBeNull();

    fireEvent.click(button);
    expect(screen.queryByTestId('folder-picker-list')).toBeNull();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('says so when there are no folders, rather than showing an empty select', () => {
    open({ folders: [] });
    expect(screen.getByText(/No folders yet/)).toBeDefined();
  });

  it('closes on Escape', () => {
    const { onClose } = open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Done', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByTestId('settings-done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('has no Cancel: every field applies as it changes', () => {
    /* A Cancel over settings that are already applied is a button that closes
       the dialog without doing anything — the same objection 05-ui-ux.md §9
       raises about a desktop sidebar toggle. */
    open();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('confirms before resetting, and shows the confirmation only then', () => {
    const seen: React.ReactNode[] = [];
    open({ confirmReset: <div data-testid="reset-confirm" /> });
    expect(screen.queryByTestId('reset-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-reset'));
    expect(screen.getByTestId('reset-confirm')).toBeDefined();
    seen.push(1);
  });

  it('never names the reset control by colour alone', () => {
    /* §10: colour is never the only signal, so the danger tint on the reset
       button is not carrying the meaning — the words "Reset all settings" are. */
    open();
    const button = screen.getByTestId('settings-reset');
    expect(button.textContent).toContain('Reset all settings');
  });
});
