// Calendar dates for HR features (joining dates, leave, holidays) are plain
// YYYY-MM-DD strings, like task due dates: no timezone conversion anywhere.
// "Today" is decided in one place, in the organization's working timezone.

export const APP_TIMEZONE = 'Asia/Kolkata';

/** Today's calendar date in APP_TIMEZONE, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const day = toUtc(date).getUTCDay();
  return day === 0 || day === 6;
}

/** Every date from `from` to `to`, inclusive. Empty when from > to. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday..Sunday of the week containing `date`. */
export function weekRange(date: string): { from: string; to: string } {
  const day = toUtc(date).getUTCDay(); // 0 = Sunday
  const from = addDays(date, day === 0 ? -6 : 1 - day);
  return { from, to: addDays(from, 6) };
}

// ---------------------------------------------------------------- times of day
// Attendance punches are real instants (Date, stored in UTC). Shift times are
// "HH:mm" wall-clock times in APP_TIMEZONE.

/** The current instant. One place, so tests can pin "now". */
export function now(): Date {
  return new Date();
}

/** "09:30" → 570. */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/** 570 → "09:30". */
export function minutesToHm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function zonedParts(at: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** Minutes since midnight of an instant, on APP_TIMEZONE's wall clock. */
export function minutesOfDay(at: Date): number {
  const p = zonedParts(at);
  return p.h * 60 + p.mi;
}

/** The instant at wall-clock `hm` on `date` in APP_TIMEZONE. */
export function zonedInstant(date: string, hm: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at that moment (no DST in Asia/Kolkata, but stay general).
  const p = zonedParts(new Date(guess));
  const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - guess;
  return new Date(guess - offset);
}

/** "2026-10" → first and last date of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
