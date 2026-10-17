import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Folder,
  Palette,
  RotateCw,
  Settings as SettingsIcon,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useDialogFocus } from './useDialogFocus';
import { flattenFolders, popoverPlacement } from './popoverPlacement';
import { FolderPicker, NONE_LABEL } from './StatusPopovers';
import { SyncPane } from './SyncPane';
import { UpdatePane } from './UpdatePane';
import { hexToHsl, hslToHex, normalizeHexInput } from '../lib/color';
import { ACCENT_PRESETS, presetValue } from '../lib/settings';
import type { AccentChoice, Theme } from '../lib/settings';
import type { SyncConflict, SyncStatus, SyncSummary } from '../types/sync';
import type { AppInfo, UpdateSummary } from '../types/update';
import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

/* `05-ui-ux.md` §6.6: theme, accent, default folder, reset. Four fields, and the
   dialog is the only place in the app where the user configures anything, which
   is why it can afford to be a dialog rather than a drawer or a page.

   Two things here are decisions rather than transcriptions of the prototype.

   **The accent readout.** ADR-019 resolves a preset through the cascade but takes
   a custom colour verbatim, in both themes. The readout names the preset in use
   so the swatch ring is not carrying the meaning alone; a custom colour shows
   no readout at all.

     **The default folder uses the shared `FolderPicker`, not a native select.**
     An earlier revision used a native `<select>` here on the grounds that a form
     field needs nothing custom. On Android that opens the platform's own
     radio-list popup — a second visual language for "choose a value" beside the
     popover the status bar already uses — which the user reported on a phone.
     This is the same component with the same options (flattened depth-first,
     indented by depth, "None" included), so the two pickers cannot drift apart.
     The prototype draws this row as static text rather than a control at all.

    **The custom accent uses an in-app editor, not a native colour input.**
    An earlier revision used `<input type="color">` here. On Android the WebView
    hands that to the platform's own palette plus its Hue/Saturation/Value sheet —
    two system windows in a second visual language — which the user reported on a
    phone. The replacement is a hex field plus Hue/Saturation/Lightness sliders
    built from text and range inputs, so no system dialog can open. Range inputs
    stay in the DOM where the dialog trap already reaches them. */

type SettingsDialogProps = {
  theme: Theme;
  /** The theme in effect, which for `system` is what the OS asked for. The
      swatches and the ratio readout describe what is on screen, not what is
      stored — otherwise a system-dark user would be shown light values. */
  effective: 'light' | 'dark';
  /** `null` is the first preset, the theme's own default. */
  accent: AccentChoice;
  /** The last custom colour picked, whatever the accent is now: the palette
      restores it instead of forgetting it behind a preset. */
  lastCustomHex: string;
  defaultFolderId: Uuid | null;
  folders: FolderNode[];
  onThemeChange: (theme: Theme) => void;
  onAccentChange: (accent: AccentChoice) => void;
  onDefaultFolderChange: (folderId: Uuid | null) => void;
  onClose: () => void;
  /** Rendered above the dialog; `App` owns the confirmation so only one
       destructive confirmation can exist at a time (`05-ui-ux.md` §6.2). */
  confirmReset: React.ReactNode;
  /** Which tab opens. The sidebar conflict badge opens `sync` directly. */
  initialTab?: SettingsTab;
  /* One object, optional so the general tab stays usable wherever sync is
     not wired (tests, prototype). `App` always provides it. */
  sync?: SyncTabState;
  /* Likewise for the updater, and for the same reason: the tab has to render
     without the platform behind it so the rest of the dialog stays drivable in a
     plain browser (ADR-018). */
  updates?: UpdatesTabState;
};

export type SettingsTab = 'general' | 'sync' | 'updates';

/** In tab order, so the arrow-key handler below can move between neighbours
    rather than hard-coding a pair. `05-ui-ux.md` §6.6: the order is what the
    user reads most often first — look after your writing, then sync, then the
    once-a-month chore. */
const TABS: readonly SettingsTab[] = ['general', 'sync', 'updates'];

/** The label each tab shows. Derived from the id rather than `capitalize`d from
    it, so `updates` does not depend on a CSS transform to read as a word. */
const TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  sync: 'Sync',
  updates: 'Updates',
};

export type SyncTabState = {
  status: SyncStatus | undefined;
  statusPending: boolean;
  conflicts: SyncConflict[] | undefined;
  syncing: boolean;
  saving: boolean;
  saveError: string | null;
  lastResult: SyncSummary | null;
  reuploading: boolean;
  lastReupload: number | null;
  onSaveConfig: (connectionString: string, enabled: boolean) => Promise<void>;
  onSyncNow: () => Promise<SyncSummary>;
  onReupload: () => Promise<number>;
  onResolve: (id: string, keepLocal: boolean) => Promise<void>;
};

/** ADR-024. `lastCheckedAt` comes from the settings store rather than from the
    check itself, so the line survives the app being closed and reopened: it
    answers "when did this app last look", not "when did this session look". */
export type UpdatesTabState = {
  info: AppInfo | undefined;
  isChecking: boolean;
  update: UpdateSummary | null;
  /** Whether *this tab's* check completed. The silent daily tick writes
      `lastCheckedAt` without reporting anything into the tab, so the two are not
      the same question and the pane asks this one. */
  hasChecked: boolean;
  checkError: string | null;
  checkErrorCode: string | null;
  isInstalling: boolean;
  downloaded: number;
  total: number | null;
  installError: string | null;
  lastCheckedAt: number | null;
  onCheck: () => Promise<UpdateSummary | null>;
  onInstall: () => Promise<void>;
};

export function SettingsDialog({
  theme,
  effective,
  accent,
  lastCustomHex,
  defaultFolderId,
  folders,
  onThemeChange,
  onAccentChange,
  onDefaultFolderChange,
  onClose,
  confirmReset,
  initialTab,
  sync,
  updates,
}: SettingsDialogProps) {
  const { panelRef, onKeyDown: trapKeyDown } = useDialogFocus(onClose);
  /* Two tabs — general settings and sync — so the connection string, status
     and conflicts do not crowd the theme and folder rows. The dialog mounts
     fresh on every open, so the initial tab needs no syncing afterwards. */
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [custom, setCustom] = useState<string>(() =>
    accent !== null && accent.kind === 'custom' ? accent.hex : lastCustomHex,
  );
  const [draft, setDraft] = useState<string>(() =>
    accent !== null && accent.kind === 'custom' ? accent.hex : lastCustomHex,
  );
  /* The custom editor opens from the palette swatch alone: with six presets on
     show, an always-visible panel of sliders is clutter for anyone who never
     picks a colour of their own. */
  const [customOpen, setCustomOpen] = useState(accent !== null && accent.kind === 'custom');
  const [confirming, setConfirming] = useState(false);
  /* The folder picker portals to the body, outside the panel's DOM. The trap
     and the Esc handling only apply to keys from inside the panel — otherwise
     Esc in the picker would close the dialog behind it, and Tab there would be
     yanked back into the panel mid-choice. */
  const [picker, setPicker] = useState<{
    anchor: HTMLElement;
    placement: { top: number; left: number };
  } | null>(null);

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof Node && panelRef.current?.contains(event.target) !== true) return;
    trapKeyDown(event);
  };

  const options = useMemo(() => flattenFolders(folders), [folders]);

  /* A deleted folder leaves a stale id behind; the button falls back to the
     None copy rather than showing a blank, and the id itself is replaced on
     the next pick. */
  const currentName = useMemo(() => {
    if (defaultFolderId === null) return null;
    return options.find((option) => option.id === defaultFolderId)?.name ?? null;
  }, [options, defaultFolderId]);

  /* §10: colour is never the only signal. The ring on the swatch is the
     selected state, and this says which preset is in use so the ring is not
     carrying the meaning alone. A custom colour shows no readout at all. */
  const accentReadout = useMemo(() => {
    if (accent === null) {
      return `Default accent for the ${effective === 'dark' ? 'dark' : 'light'} theme`;
    }
    if (accent.kind === 'custom') return '';
    const hex = ACCENT_PRESETS[accent.index - 1]?.[effective === 'dark' ? 'dark' : 'light'];
    if (hex === undefined) return 'Accent';
    return `${ACCENT_PRESETS[accent.index - 1]?.name} — ${hex}`;
  }, [accent, effective]);

  const customHsl = useMemo(
    () => hexToHsl(custom) ?? hexToHsl('#2f6fed') ?? { h: 222, s: 83, l: 59 },
    [custom],
  );
  const draftValid = normalizeHexInput(draft) !== null;

  const applyCustom = (next: string): void => {
    setCustom(next);
    setDraft(next);
    onAccentChange({ kind: 'custom', hex: next });
  };

  /* Hydration — or a reset — can land after the dialog mounts, leaving the
     editor on the fallbacks rather than the stored values. Re-sync from props
     when they change: edits made inside the editor already write through
     `onAccentChange`, so an outside change is the only thing that reaches
     here, and the in-editor paths set the same values back. Adjusted during
     render rather than in an effect, where it would be a cascading render
     (`10-conventions.md` §8). */
  const [prevExternal, setPrevExternal] = useState({ accent, lastCustomHex });
  if (prevExternal.accent !== accent || prevExternal.lastCustomHex !== lastCustomHex) {
    setPrevExternal({ accent, lastCustomHex });
    const next = accent !== null && accent.kind === 'custom' ? accent.hex : lastCustomHex;
    setCustom(next);
    setDraft(next);
    setCustomOpen(accent !== null && accent.kind === 'custom');
  }

  return (
    <div
      /* `pb` clears the Android navigation bar (`--inset-bottom` in
         `styles/base.css`): the dialog is `fixed`, so `#root`'s own padding
         does not move it, and without this the panel ends behind the system
         buttons on a phone. */
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-sunken)_70%,transparent)] p-6 pb-[max(1.5rem,var(--inset-bottom))]"
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
        onKeyDown={onPanelKeyDown}
        /* Dialog copy is chrome, not content: read, never copied. The colour
           input below is a picker, not a text field, so nothing opts back in. */
        className="flex max-h-[calc(100dvh-3rem-var(--inset-bottom))] w-full max-w-[420px] flex-col overflow-hidden rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)] select-none"
      >
        <div className="flex flex-none items-center gap-2 px-5 pt-[18px]">
          <span className="flex text-[var(--text-muted)]">
            <SettingsIcon className="icon i-20" aria-hidden="true" />
          </span>
          <h2 id="settings-dialog-title" className="text-[15px] font-semibold">
            Settings
          </h2>
        </div>

        <div
          role="tablist"
          aria-label="Settings sections"
          data-testid="settings-tabs"
          onKeyDown={(event) => {
            /* Arrows move between neighbours and wrap, which is what a tablist
               does; `Home`/`End` jump to the ends. With two tabs this was a
               pair-flip, which is why neither key worked and nothing noticed. */
            const at = TABS.indexOf(tab);
            let next: number | null = null;
            if (event.key === 'ArrowRight') {
              next = (at + 1) % TABS.length;
            } else if (event.key === 'ArrowLeft') {
              next = (at - 1 + TABS.length) % TABS.length;
            } else if (event.key === 'Home') {
              next = 0;
            } else if (event.key === 'End') {
              next = TABS.length - 1;
            }
            if (next === null) return;
            event.preventDefault();
            const target = TABS[next];
            if (target !== undefined) setTab(target);
          }}
          className="flex flex-none gap-1 px-5 pt-3"
        >
          {TABS.map((name) => {
            const selected = tab === name;
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`settings-panel-${name}`}
                id={`settings-tab-${name}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setTab(name);
                }}
                className={`rounded-[var(--r-input)] px-3 py-1.5 text-[13px] font-medium ${
                  selected
                    ? 'bg-[var(--surface-raised)] text-[var(--text)]'
                    : 'text-[var(--text-muted)]'
                }`}
              >
                {TAB_LABELS[name]}
              </button>
            );
          })}
        </div>

        {tab === 'general' ? (
          <div
            id="settings-panel-general"
            role="tabpanel"
            aria-labelledby="settings-tab-general"
            className="flex flex-col gap-[18px] overflow-y-auto px-5 py-4"
          >
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
                      tabIndex={selected ? 0 : accent === null && index === 1 ? 0 : -1}
                      onClick={() => {
                        setCustomOpen(false);
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
                    const next = normalizeHexInput(draft) ?? custom;
                    setCustomOpen(true);
                    applyCustom(next);
                  }}
                  className={`grid h-7 w-7 place-items-center rounded-full bg-[var(--surface)] text-[var(--text-muted)] shadow-[inset_0_0_0_1px_var(--border-strong)] ${
                    accent !== null && accent.kind === 'custom'
                      ? 'border-2 border-[var(--text)]'
                      : 'border-2 border-transparent'
                  }`}
                >
                  <Palette className="icon i-16" aria-hidden="true" />
                </button>
              </div>

              {customOpen ? (
                <div className="mt-3 rounded-[var(--r-input)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      style={{ background: draftValid ? custom : 'transparent' }}
                      className="h-7 w-7 flex-none rounded-full border-2 border-[var(--text)] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
                    />
                    <label
                      htmlFor="settings-accent-custom"
                      className="text-[12px] font-medium text-[var(--text-muted)]"
                    >
                      Custom colour
                    </label>
                    <input
                      id="settings-accent-custom"
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      maxLength={7}
                      placeholder="#rrggbb"
                      aria-label="Custom accent colour as hex"
                      aria-invalid={!draftValid}
                      value={draft}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft(value);
                        const next = normalizeHexInput(value);
                        if (next !== null) {
                          setCustom(next);
                          onAccentChange({ kind: 'custom', hex: next });
                        }
                      }}
                      onBlur={() => {
                        if (normalizeHexInput(draft) === null) setDraft(custom);
                      }}
                      className="ml-auto w-28 rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-2 font-mono text-[13px] text-[var(--text)]"
                    />
                  </div>
                  {!draftValid ? (
                    <p className="mt-1.5 text-[12px] text-[var(--danger)]" role="alert">
                      Enter a colour as #rrggbb.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-col gap-1">
                    <label className="flex min-h-11 items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <span className="w-20 flex-none">Hue {customHsl.h}°</span>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={customHsl.h}
                        aria-label="Custom colour hue"
                        onChange={(event) => {
                          const next = hslToHex(
                            Number(event.target.value),
                            customHsl.s,
                            customHsl.l,
                          );
                          applyCustom(next);
                        }}
                        style={{
                          background:
                            'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
                        }}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full"
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <span className="w-20 flex-none">Saturation {customHsl.s}%</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={customHsl.s}
                        aria-label="Custom colour saturation"
                        onChange={(event) => {
                          const next = hslToHex(
                            customHsl.h,
                            Number(event.target.value),
                            customHsl.l,
                          );
                          applyCustom(next);
                        }}
                        style={{
                          background: `linear-gradient(to right, hsl(${customHsl.h}, 0%, ${customHsl.l}%), hsl(${customHsl.h}, 100%, ${customHsl.l}%))`,
                        }}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full"
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <span className="w-20 flex-none">Lightness {customHsl.l}%</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={customHsl.l}
                        aria-label="Custom colour lightness"
                        onChange={(event) => {
                          const next = hslToHex(
                            customHsl.h,
                            customHsl.s,
                            Number(event.target.value),
                          );
                          applyCustom(next);
                        }}
                        style={{
                          background: `linear-gradient(to right, #000, hsl(${customHsl.h}, ${customHsl.s}%, 50%), #fff)`,
                        }}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full"
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {accent !== null && accent.kind === 'custom' ? null : (
                <p className="mt-2 text-[12px] text-[var(--text-subtle)]" aria-live="polite">
                  {accentReadout}
                </p>
              )}
            </div>

            <div>
              <span
                id="settings-default-folder-label"
                className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]"
              >
                Default folder for new notes
              </span>
              <button
                type="button"
                data-testid="settings-default-folder"
                aria-label="Default folder for new notes"
                aria-haspopup="listbox"
                aria-expanded={picker !== null}
                onClick={(event) => {
                  /* A toggle, not just an opener: the panel never covers this
                   button, so pressing it again is always the fastest way to
                   dismiss the list. */
                  if (picker !== null) {
                    setPicker(null);
                    return;
                  }
                  /* Geometry is in hand at the click; measuring later is a second
                   render for a value already known. */
                  setPicker({
                    anchor: event.currentTarget,
                    placement: popoverPlacement(event.currentTarget),
                  });
                }}
                className="flex w-full items-center gap-2 rounded-[var(--r-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-2 text-left text-[13px] text-[var(--text)]"
              >
                <Folder className="icon i-16 flex-none opacity-70" aria-hidden="true" />
                <span className="flex-1 truncate">{currentName ?? NONE_LABEL}</span>
                <ChevronDown
                  className="icon i-16 flex-none text-[var(--text-subtle)]"
                  aria-hidden="true"
                />
              </button>
              {/* ADR-014: nothing is pre-created, so "None" is the default and a
                note filed into it is unfiled rather than lost. */}
              {options.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-[var(--text-subtle)]">
                  No folders yet. New notes stay unfiled until you make one.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'sync' ? (
          <div
            id="settings-panel-sync"
            role="tabpanel"
            aria-labelledby="settings-tab-sync"
            className="overflow-y-auto px-5 py-4"
          >
            {sync !== undefined ? (
              <SyncPane
                status={sync.status}
                statusPending={sync.statusPending}
                conflicts={sync.conflicts}
                syncing={sync.syncing}
                saving={sync.saving}
                saveError={sync.saveError}
                lastResult={sync.lastResult}
                reuploading={sync.reuploading}
                lastReupload={sync.lastReupload}
                onSaveConfig={sync.onSaveConfig}
                onSyncNow={sync.onSyncNow}
                onReupload={sync.onReupload}
                onResolve={sync.onResolve}
              />
            ) : (
              <p className="text-[12px] text-[var(--text-subtle)]">Sync is unavailable here.</p>
            )}
          </div>
        ) : null}

        {tab === 'updates' ? (
          <div
            id="settings-panel-updates"
            role="tabpanel"
            aria-labelledby="settings-tab-updates"
            className="overflow-y-auto px-5 py-4"
          >
            {updates !== undefined ? (
              <UpdatePane
                info={updates.info}
                isChecking={updates.isChecking}
                update={updates.update}
                hasChecked={updates.hasChecked}
                checkError={updates.checkError}
                checkErrorCode={updates.checkErrorCode}
                isInstalling={updates.isInstalling}
                downloaded={updates.downloaded}
                total={updates.total}
                installError={updates.installError}
                lastCheckedAt={updates.lastCheckedAt}
                onCheck={updates.onCheck}
                onInstall={updates.onInstall}
              />
            ) : (
              <p className="text-[12px] text-[var(--text-subtle)]">Updates are unavailable here.</p>
            )}
          </div>
        ) : null}

        <div className="flex flex-none items-center gap-2 border-t border-[var(--border)] bg-[var(--surface-raised)] px-5 py-[14px]">
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
        {/* The picker portals to the body but is a React child of the panel, so
            `onPanelKeyDown` above is what keeps the trap out of it. */}
        {picker !== null ? (
          <FolderPicker
            anchor={picker.anchor}
            placement={picker.placement}
            folders={folders}
            current={defaultFolderId}
            onPick={(next) => {
              onDefaultFolderChange(next);
              setPicker(null);
            }}
            onClose={() => {
              setPicker(null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
