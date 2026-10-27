import * as chrono from 'chrono-node';
import { addDays, monthRange, weekRange } from '../utils/dates';
import { norm } from './text';

// The model copies dates as the user said them ("next Monday", "1 Nov"); it is not trusted
// with calendar maths (it turned "next Monday" into a Sunday in testing). This does it.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toIso(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * "next Monday", "tomorrow", "1 Nov", "15/08/1995" or "2026-10-19" -> YYYY-MM-DD, counted
 * from `reference` (YYYY-MM-DD, normally today in APP_TIMEZONE). Day-first, as in India.
 * Null when the text holds no date.
 */
export function resolveDate(text: string, reference: string): string | null {
  const trimmed = text.trim();
  const iso = ISO.exec(trimmed);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  // Noon UTC keeps the reference on the same calendar day in any server timezone.
  const parsed = chrono.en.GB.parse(trimmed, new Date(`${reference}T12:00:00Z`), { forwardDate: true })[0];
  if (!parsed) return null;
  const { start } = parsed;
  return toIso(start.get('year')!, start.get('month')!, start.get('day')!);
}

/** 2026-10-15 -> "Thu 15 Oct 2026". */
export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function weekdayOf(iso: string): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

export interface DueRange {
  from?: string;
  to?: string;
  /** The due day has passed. The caller adds "and not finished yet" (a status filter). */
  overdue?: boolean;
  /** "overdue", "due this week", "due by Thu 31 Dec 2026". */
  label: string;
}

/**
 * "overdue", "this week", "next month", "next 30 days", "before 31 Dec", "after 1 Nov"
 * or a single date -> a range of due days. Null when the words name no time.
 * Used by Projects (deadlines) and Tasks (due dates).
 */
export function dueRange(text: string, today: string): DueRange | null {
  const t = norm(text).replace(/\b(due|deadline|deadlines|is|are|that|which)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(overdue|late|past due|missed|delayed|behind)\b/.test(t)) return { to: addDays(today, -1), overdue: true, label: 'overdue' };
  if (t === 'today') return { from: today, to: today, label: 'due today' };
  if (t === 'tomorrow') return { from: addDays(today, 1), to: addDays(today, 1), label: 'due tomorrow' };
  if (/\bthis week\b/.test(t)) return { ...weekRange(today), label: 'due this week' };
  if (/\bnext week\b/.test(t)) return { ...weekRange(addDays(today, 7)), label: 'due next week' };
  const month = today.slice(0, 7);
  if (/\bthis month\b/.test(t)) return { ...monthRange(month), label: 'due this month' };
  if (/\bnext month\b/.test(t)) {
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return { ...monthRange(next), label: 'due next month' };
  }
  const days = /\b(?:next|coming|within)\s+(\d{1,3})\s+days?\b/.exec(t);
  if (days) return { from: today, to: addDays(today, Number(days[1])), label: `due in the next ${days[1]} days` };
  const before = /^(?:before|by|until|till)\s+(.+)$/.exec(t);
  if (before) {
    const day = resolveDate(before[1], today);
    return day ? { to: day, label: `due by ${formatDay(day)}` } : null;
  }
  const after = /^(?:after|from|since)\s+(.+)$/.exec(t);
  if (after) {
    const day = resolveDate(after[1], today);
    return day ? { from: day, label: `due from ${formatDay(day)}` } : null;
  }
  const day = t ? resolveDate(t, today) : null;
  return day ? { from: day, to: day, label: `due on ${formatDay(day)}` } : null;
}

// ---------------------------------------------------------------- days and times for the Me page
// (docs/AI_ME_ASSISTANTS.md): leave leans to the future, fixes and expenses to the past, and work
// from home to the future unless the date was in the last week.

export type Lean = 'future' | 'past' | 'recent';

/**
 * Hinglish day words, as people speak them: "kal" is tomorrow, or yesterday for a fix or an
 * expense (they are about the past); "aaj" is today; "parso" two days on, or back.
 */
function hindiDays(text: string, lean: Lean): string {
  const back = lean === 'past';
  return text
    .replace(/\b(?:aaj|aj)\b/gi, 'today')
    .replace(/\b(?:kal|kl)\b/gi, back ? 'yesterday' : 'tomorrow')
    .replace(/\b(?:parso|parson|parsoon)\b/gi, back ? '2 days ago' : 'in 2 days');
}

const ref = (today: string) => new Date(`${today}T12:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const BACKWARD = /\b(?:last|past|previous|ago)\b/i;

/** The first day chrono finds (a date or a weekday, not a bare time), with its range end if it has one. */
function chronoDay(text: string, today: string, forward: boolean) {
  return chrono.en.GB.parse(text, ref(today), { forwardDate: forward }).find((r) => r.start.isCertain('day') || r.start.isCertain('weekday'));
}

/**
 * One day, leaning as the page needs: "15 Oct" said on 22 Oct is next year's for leave
 * ('future'), this year's for a fix ('past'), and this year's for work from home ('recent'), as
 * long as it was at most `recentDays` back. Weekdays alone ("Friday") mean the coming one, except
 * for 'past', where they mean the last one.
 */
export function dayOf(text: string, today: string, lean: Lean, recentDays = 7): string | null {
  const t = hindiDays(text, lean).trim();
  const iso = ISO.exec(t);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const backward = BACKWARD.test(t);
  const found = chronoDay(t, today, lean !== 'past' && !backward);
  if (!found) return null;
  const { start } = found;
  let day = isoOf(start.date());
  const weekdayOnly = !start.isCertain('day') && start.isCertain('weekday');
  if (lean === 'past' && day > today && !start.isCertain('year')) day = weekdayOnly ? addDays(day, -7) : `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;
  if (lean === 'recent' && !weekdayOnly && !start.isCertain('year')) {
    // A dated day this year, unless that is more than `recentDays` back: then next year's.
    const thisYear = chronoDay(t, today, false);
    const near = thisYear ? isoOf(thisYear.start.date()) : day;
    day = near >= addDays(today, -recentDays) ? near : day;
  }
  return day;
}

export interface DayRange {
  from: string;
  to: string;
}

const WEEKDAY_NAMES = /^(?:mon|tue|wed|thu|fri|sat|sun)/i;
const MONTH_NAME = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\b/i;

/** `count` weekdays from `start` (Saturday and Sunday skipped; the API leaves out holidays). */
function weekdaysFrom(start: string, count: number): string {
  let day = start;
  let left = count - (isWeekday(start) ? 1 : 0);
  while (left > 0) {
    day = addDays(day, 1);
    if (isWeekday(day)) left -= 1;
  }
  return day;
}
const isWeekday = (iso: string) => ![0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

/**
 * The days a request covers: "from 3 Nov to 5 Nov", "3rd to 5th November", "Monday to
 * Wednesday", "next week", "for 3 days from Monday", or one day ("tomorrow"). Null when the words
 * name no day. The end is read from the start, so "Monday to Wednesday" is one week.
 */
export function dayRangeOf(text: string, today: string, lean: Lean): DayRange | null {
  const t = hindiDays(text, lean).replace(/\s+/g, ' ');
  const n = norm(t);
  if (/\bnext week\b/.test(n)) {
    const w = weekRange(addDays(today, 7));
    return { from: w.from, to: addDays(w.from, 4) };
  }
  if (/\bthis week\b/.test(n) && lean !== 'past') {
    const w = weekRange(today);
    const friday = addDays(w.from, 4);
    return { from: today > w.from ? today : w.from, to: friday < today ? today : friday };
  }
  const count = /\b(?:for\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:working\s+|work\s+)?days?\s+(?:(?:of\s+)?(?:leave|off|wfh|work from home|holiday)\s+)?(?:from|starting(?:\s+from)?|beginning)\s+(.+?)(?=[,.;]|\s+(?:for|because|as|since|due|with|reason)\b|$)/i.exec(t);
  if (count) {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const days = /^\d+$/.test(count[1]) ? Number(count[1]) : words.indexOf(count[1].toLowerCase()) + 1;
    const from = dayOf(count[2], today, lean);
    if (from && days >= 1) return { from, to: weekdaysFrom(from, days) };
  }
  // "from X to Y": each end on its own (chrono reads these unreliably). A bare day number takes
  // the other end's month ("from 3 to 5 Nov").
  const between = /\b(?:from|between)\s+(.+?)\s+(?:to|and|till|until|through|-|–)\s+(.+?)(?=[,.;]|\s+(?:for|because|as|since|due|with|reason|clock|in at|out at)\b|$)/i.exec(t);
  if (between) {
    const month = MONTH_NAME.exec(between[2])?.[0];
    const first = /^\d{1,2}(?:st|nd|rd|th)?$/i.test(between[1].trim()) && month ? `${between[1].trim()} ${month}` : between[1];
    const from = dayOf(first, today, lean);
    // A weekday end counts from the start: "from Monday to Wednesday".
    const to = from && WEEKDAY_NAMES.test(between[2].trim()) ? dayOf(between[2], from, 'future') : dayOf(between[2], from ?? today, lean === 'past' ? 'past' : 'future');
    if (from && to) return from <= to ? { from, to } : { from: to, to: from };
  }
  const forward = lean !== 'past' && !BACKWARD.test(t);
  // "3 days" alone is a length of time, not a date (chrono reads it as three days from now).
  const all = chrono.en.GB.parse(t, ref(today), { forwardDate: forward }).filter((r) => (r.start.isCertain('day') || r.start.isCertain('weekday')) && !/^(?:for\s+)?\d+\s+(?:days?|weeks?)$/i.test(r.text.trim()));
  const found = all[0];
  if (!found) return null;
  const from = dayOf(found.text, today, lean);
  if (!from) return null;
  // "Monday and Tuesday", "Friday and Monday": next to each other, so one range. Days further
  // apart aren't joined: a request covers one run of days.
  const second = all[1];
  if (!found.end && second && /^\s*(?:and|&|\+|,)\s*$/.test(t.slice(found.index + found.text.length, second.index))) {
    const next = dayOf(second.text, from, 'future');
    if (next && next > from && next <= addDays(from, 3) && weekdaysBetween(from, next) <= 1) return { from, to: next };
  }
  const to = found.end ? isoOf(found.end.date()) : from;
  return to >= from ? { from, to } : { from, to: from };
}

/** Weekdays after `from` up to and including `to`: 1 for adjacent working days (Fri → Mon too). */
function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWeekday(d)) n += 1;
  return n;
}

export interface Times {
  clockIn?: string;
  clockOut?: string;
}

const TIME = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)?';
const IN_WORDS = '(?:clock(?:ed)?\\s*-?\\s*in|in time|in at|came(?:\\s+in)?|arrived|reached|started|logged in|log in|login|punched in)';
const OUT_WORDS = '(?:clock(?:ed)?\\s*-?\\s*out|out time|out at|left|went home|logged out|log out|logout|punched out|finished)';

function hm(h: string, m: string | undefined, meridiem: string | undefined): { hour: number; minute: number; meridiem: boolean } | null {
  let hour = Number(h);
  const minute = m ? Number(m) : 0;
  if (hour > 23 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = /^p/i.test(meridiem);
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  return { hour, minute, meridiem: Boolean(meridiem) };
}

const fmt = (t: { hour: number; minute: number }) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

/**
 * Clock-in and clock-out times: "clock in 9:30, clock out 6:30", "9:30 am to 6:30 pm", "from 10 to 7",
 * "09:30–18:30". Without am/pm, a clock-out earlier than the clock-in is the afternoon ("9:30 to
 * 6:30" is 09:30–18:30), and so is a clock-in before 7. `text` should not hold the date.
 */
export function timesIn(text: string): Times {
  const t = text.toLowerCase();
  const inMatch = new RegExp(`\\b${IN_WORDS}\\s*(?:at|time|was|is|by|around|:|-)?\\s*${TIME}`).exec(t);
  const outMatch = new RegExp(`\\b${OUT_WORDS}\\s*(?:at|time|was|is|by|around|:|-)?\\s*${TIME}`).exec(t);
  let start = inMatch ? hm(inMatch[1], inMatch[2], inMatch[3]) : null;
  let end = outMatch ? hm(outMatch[1], outMatch[2], outMatch[3]) : null;
  if (!start && !end) {
    const pair = new RegExp(`(?:^|\\b(?:from|between)\\s+|\\s)${TIME}\\s*(?:to|till|until|and|-|–)\\s*${TIME}(?![\\w/])`).exec(t);
    if (pair) {
      start = hm(pair[1], pair[2], pair[3]);
      end = hm(pair[4], pair[5], pair[6]);
    }
  }
  if (start && !start.meridiem && start.hour < 7) start = { ...start, hour: start.hour + 12 };
  if (end && !end.meridiem && end.hour < 12 && (start ? end.hour * 60 + end.minute <= start.hour * 60 + start.minute : end.hour <= 9)) end = { ...end, hour: end.hour + 12 };
  return { ...(start ? { clockIn: fmt(start) } : {}), ...(end ? { clockOut: fmt(end) } : {}) };
}
