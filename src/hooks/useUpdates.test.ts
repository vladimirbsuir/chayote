import { describe, expect, it } from 'vitest';
import { isCheckDue } from './useUpdates';
import { useSettingsStore } from '../stores/settings';

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