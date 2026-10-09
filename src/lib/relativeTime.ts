/* `05-ui-ux.md` §6.5a. Relative by default, absolute once older than a week,
   no tooltip on desktop — the relative form is what matters and a hover state
   on every row is visual noise. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `3 Feb` — the short absolute form the table in §6.5a asks for past a week. */
function shortDate(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * Age of a note relative to `now`, as the note list shows it.
 *
 * Both arguments are epoch milliseconds (rule R2), and `now` is passed in rather
 * than read here so a whole list recomputes from one clock reading. The caller
 * re-renders on a 60 s interval (`05-ui-ux.md` §6.5a), which is what keeps a list
 * left open accurate.
 *
 * A timestamp in the future reads as `now` rather than a negative age: device
 * clocks are wrong (rule R2), and a list that showed `-3 min` would be worse than
 * one that understates recency by a few seconds.
 */
export function relativeTime(updatedAt: number, now: number): string {
  const age = now - updatedAt;

  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h`;
  if (age < 2 * DAY) return 'yesterday';
  if (age < WEEK) return `${Math.floor(age / DAY)} d`;
  return shortDate(updatedAt);
}