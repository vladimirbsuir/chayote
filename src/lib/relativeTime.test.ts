import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

/* Every boundary in the §6.5a table, asserted from both sides. A timestamp
   formatter is exactly the kind of code that looks right in review and is wrong
   at 59 min or at exactly 7 days. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Built in local time, not UTC: the formatter reads local time for display
   (rule R2 — the wire format is epoch ms, the rendering is the user's), so a
   UTC-based `now` would make the absolute-date expectations depend on the test
   machine's offset. Local construction holds on any machine. */
const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime();

function ago(ms: number): number {
  return NOW - ms;
}

describe('relativeTime', () => {
  it('shows now below a minute, including a clock that has run ahead', () => {
    expect(relativeTime(NOW, NOW)).toBe('now');
    expect(relativeTime(ago(59_000), NOW)).toBe('now');
    expect(relativeTime(ago(1_500), NOW)).toBe('now');
    expect(relativeTime(NOW + 45_000, NOW)).toBe('now');
  });

  it('shows whole minutes from one minute to one hour', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1 min');
    expect(relativeTime(ago(2 * MINUTE), NOW)).toBe('2 min');
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59 min');
  });

  it('switches to hours at sixty minutes', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1 h');
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe('3 h');
    expect(relativeTime(ago(23 * HOUR + 59 * MINUTE), NOW)).toBe('23 h');
  });

  it('shows yesterday for the whole second day, not a number', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('yesterday');
    expect(relativeTime(ago(DAY + 5 * HOUR), NOW)).toBe('yesterday');
    expect(relativeTime(ago(2 * DAY - 1), NOW)).toBe('yesterday');
  });

  it('counts days from two days to a week', () => {
    expect(relativeTime(ago(2 * DAY), NOW)).toBe('2 d');
    expect(relativeTime(ago(6 * DAY + 3 * HOUR), NOW)).toBe('6 d');
    expect(relativeTime(ago(7 * DAY - 1), NOW)).toBe('6 d');
  });

  it('falls back to a short absolute date past a week', () => {
    expect(relativeTime(ago(7 * DAY), NOW)).toBe('30 Sep');
    expect(relativeTime(ago(40 * DAY), NOW)).toBe('28 Aug');
    expect(relativeTime(ago(400 * DAY), NOW)).toBe('2 Sep');
  });

  it('renders the day and month without leading zeros', () => {
    expect(relativeTime(new Date(2026, 1, 3, 12).getTime(), NOW)).toBe('3 Feb');
    expect(relativeTime(new Date(2025, 11, 24, 12).getTime(), NOW)).toBe('24 Dec');
  });
});