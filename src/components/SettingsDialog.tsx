import { useMemo, useState } from 'react';
import { Check, Palette, RotateCw, Settings as SettingsIcon } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useDialogFocus } from './useDialogFocus';
import { flattenFolders } from './popoverPlacement';
import { contrastBetween } from '../lib/contrast';
import { ACCENT_PRESETS, presetValue } from '../lib/settings';
import type { AccentChoice, Theme } from '../lib/settings';
import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

/* `05-ui-ux.md` §6.6: theme, accent, default folder, reset. Four fields, and the
   dialog is the only place in the app where the user configures anything, which
   is why it can afford to be a dialog rather than a drawer or a page.

   Two things here are decisions rather than transcriptions of the prototype.

   **The accent readout.** ADR-019 resolves a preset through the cascade but takes
   a custom colour verbatim, in both themes, and a custom colour is the one thing
   that can fall under 4.5:1. Showing the measured ratio here means the user finds
   that out while choosing the colour, instead of discovering it on an active row
   afterwards. It is the only place in the app that computes a ratio.

   **A native `select` for the default folder.** §6.4's listbox requirement is
   about the two popovers anchored to a status-bar slot, which have to match each
   other; this is a form field, and a native select is operable by keyboard and
   announced correctly without a second listbox to keep consistent. The prototype
   draws this row as static text rather than a control at all. */

type SettingsDialogProps = {
  theme: Theme;
  /** The theme in effect, which for `system` is what the OS asked for. The
      swatches and the ratio readout describe what is on screen, not what is
      stored — otherwise a system-dark user would be shown light values. */
  effective: 'light' | 'dark';
/** `null` is the first preset, the theme's own default. */
accent: AccentChoice;
  defaultFolderId: Uuid | null;
  folders: FolderNode[];
  onThemeChange: (theme: Theme) => void;
  onAccentChange: (accent: AccentChoice) => void;
  onDefaultFolderChange: (folderId: Uuid | null) => void;
  onClose: () => void;
  /** Rendered above the dialog; `App` owns the confirmation so only one
      destructive confirmation can exist at a time (`05-ui-ux.md` §6.2). */
  confirmReset: React.ReactNode;
};

export function SettingsDialog({
  theme,
  effective,
  accent,
  defaultFolderId,
  folders,
  onThemeChange,
  onAccentChange,
  onDefaultFolderChange,
  onClose,
  confirmReset,
}: SettingsDialogProps) {
  const { panelRef, onKeyDown } = useDialogFocus(onClose);
  const [custom, setCustom] = useState<string>(() =>
    accent !== null && accent.kind === 'custom' ? accent.hex : '#2f6fed',
  );
  const [confirming, setConfirming] = useState(false);

  const options = useMemo(() => flattenFolders(folders), [folders]);

  /* The custom colour's ratio against the surface it would sit on. `effective`
     picks the pair, because the whole point is that one hex is measured against
     the theme actually in use. */
  const customRatio = useMemo(() => {
    const surface = effective === 'dark' ? '#1d1d20' : '#f7f7f8';
    return contrastBetween(custom, surface);
  }, [custom, effective]);

  /* One string rather than a conditional in the markup: a half-typed hex in the
     colour input is not a colour, and the readout has to say something rather
     than print `null` or leave the line blank. */
  const accentReadout = useMemo(() => {
    if (accent === null) {
      return `Default accent for the ${effective === 'dark' ? 'dark' : 'light'} theme`;
    }
    const hex = accent.kind === 'custom' ? accent.hex : ACCENT_PRESETS[accent.index - 1]?.[effective === 'dark' ? 'dark' : 'light'];
    if (hex === undefined) return 'Accent';
    if (accent.kind === 'preset') return `${ACCENT_PRESETS[accent.index - 1]?.name} — ${hex}`;
    if (customRatio === null) return `Custom ${hex}`;
    if (customRatio < 4.5) {
      return `Custom ${hex} — ${customRatio.toFixed(1)}:1, below the 4.5:1 needed for text`;
    }
    return `Custom ${hex} — ${customRatio.toFixed(1)}:1`;
  }, [accent, customRatio, effective]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-sunken)_70%,transparent)] p-6"
      onMouseDown={(event) => {
        /* A click on the scrim dismisses; a click inside the panel must not.
           Dismissal loses nothing, because every setting here is applied as it
           is changed rather than on a submit — see the footer. */
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        data-testid="settings-dialog"
        onKeyDown={onKeyDown}
        /* Dialog copy is chrome, not content: read, never copied. The colour
           input below is a picker, not a text field, so nothing opts back in. */
        className="w-full max-w-[420px] overflow-hidden rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)] select-none"
      >
        <div className="flex items-center gap-2 px-5 pt-[18px]">
          <span className="flex text-[var(--text-muted)]">
            <SettingsIcon className="icon i-20" aria-hidden="true" />
          </span>
          <h2 id="settings-dialog-title" className="text-[15px] font-semibold">
            Settings
          </h2>
        </div>

        <div className="flex flex-col gap-[18px] px-5 py-4">
          <div>
            <label
              id="settings-theme-label"
              className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]"
            >
              Theme
            </label>
            <ThemeToggle value={theme} onChange={onThemeChange} />
          </div>

          <div>
            <span
              id="settings-accent-label"
              className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]"
            >
              Accent colour
            </span>
            <div
              role="radiogroup"
              aria-labelledby="settings-accent-label"
              className="flex items-center gap-2"
            >
              {ACCENT_PRESETS.map((preset, offset) => {
                const value = presetValue(preset, effective === 'dark');
                const index = offset + 1;
                /* `null` is the *first* preset, the theme's own default — not "no choice". With
                   it excluded, no swatch carried the ring while the readout said
                   "Default accent", and §10 is explicit that the ring must not be
                   the only signal for a state that is in fact selected. */
                const selected =
                  accent === null
                    ? index === 1
                    : accent.kind === 'preset' && accent.index === index;
                return (
                  <button
                    key={preset.name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={preset.name}
                    title={preset.name}
                    /* One tab stop across the seven radios, so the picker costs one `Tab` rather
                   than seven — the same reasoning §10.1 records for the folder
                   tree. The first swatch carries it when the default is in use. */
                tabIndex={
                  selected ? 0 : accent === null && index === 1 ? 0 : -1
                }
                    onClick={() => {
                      onAccentChange({ kind: 'preset', index });
                    }}
                    style={{ background: value }}
                    className={`h-7 w-7 rounded-full border-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] ${
                      selected ? 'border-[var(--text)]' : 'border-transparent'
                    }`}
                  />
                );
              })}

              {/* The custom swatch is `palette`, one of the three inventory
                  icons §6.6 assigns to the custom colour. */}
              <button
                type="button"
                role="radio"
                aria-checked={accent !== null && accent.kind === 'custom'}
                aria-label="Custom colour"
                title="Custom colour"
                tabIndex={
                  accent !== null && accent.kind === 'custom' ? 0 : accent === null ? -1 : -1
                }
                onClick={() => {
                  onAccentChange({ kind: 'custom', hex: custom });
                }}
                className={`grid h-7 w-7 place-items-center rounded-full bg-[var(--surface)] text-[var(--text-muted)] shadow-[inset_0_0_0_1px_var(--border-strong)] ${
                  accent !== null && accent.kind === 'custom'
                    ? 'border-2 border-[var(--text)]'
                    : 'border-2 border-transparent'
                }`}
              >
                <Palette className="icon i-16" aria-hidden="true" />
              </button>

              <label className="sr-only" htmlFor="settings-accent-custom">
                Custom accent colour
              </label>
              <input
                id="settings-accent-custom"
                type="color"
                aria-label="Custom accent colour"
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value);
                  /* Applied as it is typed rather than on blur: this is the one
                     setting with an immediate visible effect elsewhere in the
                     window, and making it wait for a close button would mean
                     the swatch shows a colour the app is not using. */
                  onAccentChange({ kind: 'custom', hex: event.target.value });
                }}
                className="h-7 w-9 cursor-pointer rounded border border-[var(--border-strong)] bg-transparent p-0.5"
              />
            </div>

            {/* §10: colour is never the only signal. The ring on the swatch is
                the selected state, and this says which preset is in use so the
                ring is not carrying the meaning alone. */}
            <p className="mt-2 text-[12px] text-[var(--text-subtle)]" aria-live="polite">
              {accentReadout}
            </p>
          </div>

          <div>
            <label
              htmlFor="settings-default-folder"
              className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]"
            >
              Default folder for new notes
            </label>
            <select
              id="settings-default-folder"
              value={defaultFolderId ?? ''}
              onChange={(event) => {
                onDefaultFolderChange(event.target.value === '' ? null : event.target.value);
              }}
              className="w-full rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-2 text-[13px] text-[var(--text)]"
            >
              <option value="">None — notes start unfiled</option>
{options.map((option) => (
                <option key={option.id} value={option.id}>
                  {/* Non-breaking spaces, not ordinary ones: a `<select>`
                      collapses leading whitespace, so a depth indent written
                      with spaces renders flat and two folders called "Work"
                      become indistinguishable by depth. */}
                  {`${'\u00a0\u00a0'.repeat(option.depth)}${option.name}`}
                </option>
              ))}
            </select>
            {/* ADR-014: nothing is pre-created, so "None" is the default and a
                note filed into it is unfiled rather than lost. */}
            {options.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-[var(--text-subtle)]">
                No folders yet. New notes stay unfiled until you make one.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface-raised)] px-5 py-[14px]">
          <button
            type="button"
            data-testid="settings-reset"
            onClick={() => {
              setConfirming(true);
            }}
            className="flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--danger)]"
          >
            <RotateCw className="icon i-16" aria-hidden="true" />
            Reset all settings
          </button>

          <div className="flex-1" />

          {/* No Cancel. Every field here applies the moment it changes, exactly
             as the top-bar theme button has always done, so there is no
             unsubmitted state for Cancel to discard — it would be a button that
             closes the dialog without doing anything, which §9 rejects for the
             sidebar toggle in the same terms. Done closes, and that is all it
             promises. The prototype drew Cancel and Done; Done is what survives
             that reasoning, and the prototype was changed to match. */}
          <button
            type="button"
            data-testid="settings-done"
            onClick={onClose}
            className="flex items-center gap-[6px] rounded-[var(--r-input)] border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white"
          >
            <Check className="icon i-16" aria-hidden="true" />
            Done
          </button>
        </div>

        {/* Reset is destructive and needs confirming (`05-ui-ux.md` §6.6), and
            the confirmation is a sibling rather than a child: a dialog inside a
            dialog would give the inner one a focus trap inside the outer one's,
            and `Esc` would reach the wrong one. */}
        {confirming ? confirmReset : null}
      </div>
    </div>
  );
}