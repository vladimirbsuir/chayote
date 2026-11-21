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

function shortDate(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function relativeTime(updatedAt: number, now: number): string {
  const age = now - updatedAt;

  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h`;
  if (age < 2 * DAY) return 'yesterday';
  if (age < WEEK) return `${Math.floor(age / DAY)} d`;
  return shortDate(updatedAt);
}