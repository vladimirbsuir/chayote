import { describe, expect, it } from 'vitest';
import { isCheckDue } from './useUpdates';
import { useSettingsStore } from '../stores/settings';

/* The daily silent check is the one piece of the updater that runs with nobody
   watching, so its only interesting property is *when it stays quiet*. A check
   that fires on every launch is a network request per launch; one that never
   fires is not a daily check at all. `05-ui-ux.md` §6.6: it surfaces nothing. */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_780_000_000_000;

describe('isCheckDue', () => {
  it('is due when nothing has ever been recorded', () => {
    expect(isCheckDue(null, NOW)).toBe(true);
  });

  it('is not due moments after a check', () => {
    expect(isCheckDue(NOW, NOW)).toBe(false);
    expect(isCheckDue(NOW - 60_000, NOW)).toBe(false);
  });

  it('is not due for the whole day, and is due once the day is up', () => {
    expect(isCheckDue(NOW - DAY_MS + 1, NOW)).toBe(false);
    expect(isCheckDue(NOW - DAY_MS, NOW)).toBe(true);
    expect(isCheckDue(NOW - DAY_MS * 3, NOW)).toBe(true);
  });

  it('is due again when the stored timestamp is in the future, not stuck', () => {
    /* A clock that moved backwards, or a settings file hand-edited. Rationing
       must not turn into "never check again". */
    expect(isCheckDue(NOW + DAY_MS, NOW)).toBe(true);
  });
});

describe('the stored timestamp', () => {
  it('defaults to null, so a first run checks once', () => {
    expect(useSettingsStore.getState().lastUpdateCheckAt).toBeNull();
  });

  it('records the moment a check was attempted, not the moment it succeeded', () => {
    useSettingsStore.getState().setLastUpdateCheckAt(NOW);
    expect(useSettingsStore.getState().lastUpdateCheckAt).toBe(NOW);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().lastUpdateCheckAt).toBeNull();
  });
});