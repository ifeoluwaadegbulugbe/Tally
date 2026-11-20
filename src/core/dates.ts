// Date helpers. Due dates are calendar dates (YYYY-MM-DD) compared in UTC.
const DAY_MS = 86_400_000;

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateMs(to) - dateMs(from)) / DAY_MS);
}

/** Hours elapsed since an ISO timestamp. */
export function hoursSince(timestamp: string, now: Date): number {
  return (now.getTime() - Date.parse(timestamp)) / 3_600_000;
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(dateMs(iso) + days * DAY_MS));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-12-05" -> "5 Dec" (adds the year when it differs from `now`). */
export function formatDay(iso: string, now?: Date): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const base = `${d} ${MONTHS[m - 1]}`;
  return now && now.getUTCFullYear() !== y ? `${base} ${y}` : base;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
