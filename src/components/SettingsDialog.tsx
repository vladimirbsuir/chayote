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
import type { UpdatePaneProps } from './UpdatePane';
import { hexToHsl, hslToHex, normalizeHexInput } from '../lib/color';
import { ACCENT_PRESETS, presetValue } from '../lib/settings';
import type { AccentChoice, Theme } from '../lib/settings';
import type { SyncConflict, SyncStatus, SyncSummary } from '../types/sync';
import type { FolderNode } from '../types/folder';
import type { Uuid } from '../types/note';

type SettingsDialogProps = {
  theme: Theme;
  effective: 'light' | 'dark';
  accent: AccentChoice;
  lastCustomHex: string;
  defaultFolderId: Uuid | null;
  folders: FolderNode[];
  onThemeChange: (theme: Theme) => void;
  onAccentChange: (accent: AccentChoice) => void;
  onDefaultFolderChange: (folderId: Uuid | null) => void;
  onClose: () => void;
  confirmReset: React.ReactNode;
  initialTab?: SettingsTab;
  sync?: SyncTabState;
  updates?: UpdatesTabState;
};

export type SettingsTab = 'general' | 'sync' | 'updates';

const TABS: readonly SettingsTab[] = ['general', 'sync', 'updates'];

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

export type UpdatesTabState = UpdatePaneProps;

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
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [custom, setCustom] = useState<string>(() =>
    accent !== null && accent.kind === 'custom' ? accent.hex : lastCustomHex,
  );
  const [draft, setDraft] = useState<string>(() =>
    accent !== null && accent.kind === 'custom' ? accent.hex : lastCustomHex,
  );
  const [customOpen, setCustomOpen] = useState(accent !== null && accent.kind === 'custom');
  const [confirming, setConfirming] = useState(false);
  const [picker, setPicker] = useState<{
    anchor: HTMLElement;
    placement: { top: number; left: number };
  } | null>(null);

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof Node && panelRef.current?.contains(event.target) !== true) return;
    trapKeyDown(event);
  };

  const options = useMemo(() => flattenFolders(folders), [folders]);

  const currentName = useMemo(() => {
    if (defaultFolderId === null) return null;
    return options.find((option) => option.id === defaultFolderId)?.name ?? null;
  }, [options, defaultFolderId]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-sunken)_70%,transparent)] p-6 pb-[max(1.5rem,var(--inset-bottom))]"
      onMouseDown={(event) => {
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
                  if (picker !== null) {
                    setPicker(null);
                    return;
                  }
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
              <UpdatePane {...updates} />
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

        {confirming ? confirmReset : null}
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
