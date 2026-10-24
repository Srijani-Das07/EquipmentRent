/**
 * Date helpers for rental windows. Booking dates are plain calendar dates ("2026-11-03");
 * a pickup time and a timezone (both from the policy file) turn them into exact instants.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** True for a real calendar date written as YYYY-MM-DD. */
export const isValidDateOnly = (date: string): boolean => parseDate(date) !== null;

const toDateString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Adds whole calendar days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const p = parseDate(date);
  if (!p) throw new Error(`Invalid date: ${date}`);
  return toDateString(Date.UTC(p.y, p.m - 1, p.d) + days * 86_400_000);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) throw new Error('Invalid date');
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** Offset of a timezone from UTC, in minutes, at a given instant. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** The exact instant at which a wall-clock time occurs on a date in the given timezone. */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const p = parseDate(date);
  if (!p) throw new Error(`Invalid date: ${date}`);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  const guess = Date.UTC(p.y, p.m - 1, p.d, hh, mm);
  const first = offsetMinutes(guess, timeZone);
  let utc = guess - first * 60_000;
  const second = offsetMinutes(utc, timeZone);
  if (second !== first) utc = guess - second * 60_000; // crossed a daylight-saving change
  return new Date(utc);
}

/** The calendar date (YYYY-MM-DD) of an instant in the given timezone. */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
