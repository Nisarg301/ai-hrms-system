// Pure helpers shared by the Me page's assistants (docs/AI_ME_ASSISTANTS.md): Leave, Attendance,
// My expenses, Profile, Team and Holidays (Performance has its own, performance.helpers.ts). Dates
// and times are read in ../dates.ts; these word the answers and read the small things every tab
// needs (reasons, cancel requests, the other tabs' work, a date of birth, a Team or Holidays question).

import { ApiCallError } from '../apiClient';
import { dayOf, formatDay } from '../dates';
import { heardText, norm } from '../text';

/** The API's own reason ("Only 2 day(s) of Paid Leave left this year"), not "Validation failed". */
export function apiMessage(err: unknown): string {
  if (err instanceof ApiCallError) {
    const fieldErrors = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
    const first = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
    return first ?? err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** The API refused the request itself (400/404/409), as opposed to failing. */
export const refusal = (err: unknown) => err instanceof ApiCallError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403;

/** "Tue 3 Nov → Thu 5 Nov 2026", "Fri 23 Oct 2026 (first half)". */
export function rangeText(from: string, to: string, halfDay?: 'first' | 'second' | null): string {
  if (from === to) return `${formatDay(from)}${halfDay ? ` (${halfDay} half)` : ''}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? formatDay(from).replace(/ \d{4}$/, '') : formatDay(from)} → ${formatDay(to)}`;
}

/** "3 days", "0.5 days", "1 day". */
export const daysText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;

/** Weekdays in [from, to] (the API also leaves out holidays). */
export function weekdaysIn(from: string, to: string): number {
  let count = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (![0, 6].includes(d.getUTCDay())) count += 1;
  }
  return count;
}

// "because …", "reason: …", "due to …", "for a family function", "I have fever".
const REASON = /(?:\b(?:because(?: of)?|reason(?: is)?\s*[:-]?|due to|as i(?:'m| am| have)?|since i(?:'m| am| have)?|i have|i've got|i am|i'm)\s+|\bfor (?=(?:a|an|my|the|some)\s)|[,;]\s*(?=[a-z]))(.+)$/i;

/**
 * The reason the user gave, or ''. The model's copy counts only when its words are in the message
 * and it isn't just the dates or the request again ("Leave on Monday" as a reason, in testing).
 * `notReason`: words that belong to other fields (the dates, the type) and never make a reason.
 */
export function reasonFrom(message: string, modelReason: unknown, notReason: RegExp): string {
  const model = typeof modelReason === 'string' ? modelReason.trim() : '';
  const usable = (r: string) => {
    const rest = norm(r)
      .replace(notReason, ' ')
      .replace(/\b(?:the|a|an|on|at|and|or|then|but|also|from|to|for|was|is|leave|day|days|half|first|second|request|requests|apply|want|need|please|i|me|my|came|left|regulari[sz]\w*)\b/g, ' ')
      .trim();
    return rest.length >= 3;
  };
  if (model && heardText(model, message) && usable(model)) return model.slice(0, 500);
  const m = REASON.exec(message);
  const said = m ? m[1].trim().replace(/[.!]+$/, '') : '';
  return said && usable(said) ? said.slice(0, 500) : '';
}

/** "cancel", "withdraw", "take back", "don't need it anymore". */
export const asksToCancel = (text: string) => /\b(?:cancel|cancell?ed|withdraw|take back|revoke|call off|don ?t need|no longer need|not needed)\b/.test(norm(text));

// ---------------------------------------------------------------- the other tabs' work (docs section 10, rule 6)

export type MeTab = 'leave' | 'attendance' | 'expenses' | 'performance' | 'profile' | 'team' | 'holidays';

const TAB_LINES = {
  leave: 'Leave is on the **Leave** tab: open it and ask there.',
  wfh: 'Work from home is on the **Attendance** tab: open it and ask there.',
  fix: 'Attendance fixes are on the **Attendance** tab: open it and ask there.',
  claims: 'Expense claims are on the **Expenses** tab: open it and ask there.',
  performance: 'Goals and reviews are on the **Performance** tab: open it and ask there.',
  profile: 'Your date of birth and introduction are on the **Profile** tab: open it and ask there.',
  team: 'Your team is on the **Team** tab: open it and ask there.',
  holidays: 'The holiday calendar is on the **Holidays** tab: open it and ask there.',
};

// Words are matched after norm(), so "who's" is "who s" and "self-review" is "self review".
const WFH = /\b(?:wfh|work(?:ing)? from home|remote(?:ly)?)\b/;
const FIX = /\b(?:fix|regulari[sz]\w*|clock(?:ed)?\s*(?:in|out)|punch)\b/;
const LEAVE = /\b(?:leave|leaves|day off|days off|holiday|vacation|chutti)\b/;
const CLAIM = /\b(?:claim|claims|reimburse\w*|receipt|expense|expenses)\b/;
// Asking for leave, not about it: "Who is on leave?" on the Team tab is the Team tab's question.
const LEAVE_ASK = /\b(?:apply(?:ing)?|take|book|request|cancel|withdraw)\b(?: \S+){0,4}? (?:leave|leaves|day off|days off|half day|chutti|vacation)\b|\b(?:leave balance|my leaves?|my leave requests?|half day|chutti)\b/;
const HOLIDAY_LIST = /\b(?:holidays|next holiday|upcoming holiday|public holidays?|holiday (?:list|calendar)|long weekends?|festivals?)\b/;
const ASKS_FOR = /\b(?:apply|take|book|request|cancel|want|need)\b/;
const GOALS = /\b(?:goals?|okrs?|self reviews?|appraisals?|performance reviews?|my reviews?|reviews? to write)\b/;
const PROFILE = /\b(?:my (?:date of birth|dob|birthday|introduction|intro|hobbies|bio|job title|designation|profile|department)|introduce myself|about me|when did i join)\b/;
const TEAM = /\b(?:my manager|my boss|my teammates?|who reports to me|my (?:direct )?reports|my team|who(?: s| is| are)? (?:on leave|off|out|away|absent))\b/;

/** A new tab's own words: a message with them is that tab's, whatever else it says. */
const OWN: Record<'performance' | 'profile' | 'team' | 'holidays', RegExp> = {
  performance: /\b(?:goals?|okrs?|reviews?|appraisals?|rating|rate|check ?ins?|progress|on track|at risk|behind|completed)\b/,
  profile: /\b(?:profile|job title|designation|department|manager|join(?:ed|ing)?|date of birth|dob|birthday|born|introduction|intro|introduce|about me|hobbies|hobby|love about my job|email|photo|password)\b/,
  team: /\b(?:team|teammates?|colleagues?|manager|boss|reports?|who|anyone|anybody|available|availability|on leave)\b/,
  holidays: /\b(?:holidays?|festivals?|long weekends?)\b/,
};

/**
 * Work that belongs to another Me tab, and the line that says where. Null when it's this tab's.
 * Leave, Attendance and Expenses keep their first rules; the four later tabs go by their own words.
 */
export function otherTab(text: string, here: MeTab): string | null {
  const t = norm(text);
  const wfh = WFH.test(t);
  const fix = FIX.test(t);
  const leave = LEAVE.test(t);
  const claim = CLAIM.test(t);
  const calendar = HOLIDAY_LIST.test(t) && !ASKS_FOR.test(t);
  if (here === 'leave' || here === 'attendance' || here === 'expenses') {
    if (calendar && !wfh && !fix && !claim) return TAB_LINES.holidays;
    if (here !== 'attendance' && (wfh || fix) && !leave && !claim) return wfh ? TAB_LINES.wfh : TAB_LINES.fix;
    if (here !== 'leave' && leave && !wfh && !fix && !claim) return TAB_LINES.leave;
    if (here !== 'expenses' && claim && !leave && !wfh && !fix) return TAB_LINES.claims;
    if (leave || wfh || fix || claim) return null;
    return GOALS.test(t) ? TAB_LINES.performance : PROFILE.test(t) ? TAB_LINES.profile : TEAM.test(t) ? TAB_LINES.team : null;
  }
  if (OWN[here].test(t)) return null;
  if (LEAVE_ASK.test(t)) return TAB_LINES.leave;
  if (wfh || fix) return wfh ? TAB_LINES.wfh : TAB_LINES.fix;
  if (claim) return TAB_LINES.claims;
  if (GOALS.test(t)) return TAB_LINES.performance;
  if (PROFILE.test(t)) return TAB_LINES.profile;
  if (TEAM.test(t)) return TAB_LINES.team;
  if (calendar) return TAB_LINES.holidays;
  return null;
}

// ---------------------------------------------------------------- Profile (docs section 7)

const MONTH_NUMBERS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_WORD = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

function isoDay(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
}

/**
 * A date of birth as said: "24 Oct 1995", "24/10/1995" (day first), "1995-10-24", "October 24,
 * 1995". `{ date }` with the year, `{ monthDay: 'MM-DD' }` without one (the year is then asked
 * for), or null. Not chrono: it would fill in a year the user never said.
 */
export function birthDateIn(text: string): { date: string } | { monthDay: string } | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return wrap(isoDay(Number(iso[1]), Number(iso[2]), Number(iso[3])));
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(t);
  if (numeric) return wrap(isoDay(Number(numeric[3]), Number(numeric[2]), Number(numeric[1])));
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD}(?:,?\\s+(\\d{4}))?`).exec(t);
  const monthFirst = new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(t);
  const found = dayFirst ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] } : monthFirst ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] } : null;
  if (!found) return null;
  const month = MONTH_NUMBERS[found.month];
  if (found.year) return wrap(isoDay(Number(found.year), month, Number(found.day)));
  // 2000 is a leap year, so 29 Feb is a valid day and month.
  const day = isoDay(2000, month, Number(found.day));
  return day ? { monthDay: day.slice(5) } : null;
}
const wrap = (date: string | null) => (date ? { date } : null);

export type IntroKey = 'about' | 'hobbies' | 'lovesAboutJob';
export const INTRO_TITLES: Record<IntroKey, string> = { about: 'About me', hobbies: 'My hobbies', lovesAboutJob: 'What I love about my job' };

// The answer's name, as people say it; the answer follows it.
const INTRO_LABELS: { key: IntroKey; re: RegExp }[] = [
  { key: 'lovesAboutJob', re: /\b(?:what i love about my (?:job|work)|love about my (?:job|work)|i love my (?:job|work)(?: because(?: of)?| for)?)\b/gi },
  { key: 'hobbies', re: /\b(?:my )?hobb(?:y|ies)\b/gi },
  { key: 'about', re: /\b(?:about me|my bio|bio)\b/gi },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The introduction answers a message sets: "Set my hobbies to cycling and chess" → hobbies
 * "Cycling and chess". Several in one message are split at each name. "Clear my hobbies" → ''.
 */
export function introductionIn(text: string): Partial<Record<IntroKey, string>> {
  const out: Partial<Record<IntroKey, string>> = {};
  const clear = /\b(?:clear|remove|delete|empty|erase)\b(?: \S+){0,2}? (hobbies|hobby|about me|bio|what i love about my (?:job|work)|introduction)\b/i.exec(text);
  if (clear) {
    const word = clear[1].toLowerCase();
    if (word === 'introduction') return { about: '', hobbies: '', lovesAboutJob: '' };
    return { [/hobb/.test(word) ? 'hobbies' : /love/.test(word) ? 'lovesAboutJob' : 'about']: '' };
  }
  const labels = INTRO_LABELS.flatMap(({ key, re }) => [...text.matchAll(re)].map((m) => ({ key, start: m.index!, end: m.index! + m[0].length }))).sort((a, b) => a.start - b.start);
  // A label inside a longer one ("about my job" inside "what I love about my job") isn't one.
  const kept = labels.filter((l, i) => !labels.some((o, j) => j !== i && o.start <= l.start && o.end >= l.end && o.end - o.start > l.end - l.start));
  kept.forEach((label, i) => {
    const next = kept[i + 1]?.start ?? text.length;
    const value = text
      .slice(label.end, next)
      .replace(/^\s*(?:is|are|as|to|=|:|-|–|would be|will be)\s*/i, '')
      .replace(/[\s,;]*(?:and|also|plus)?\s*(?:set|change|update|make)?\s*(?:my)?\s*$/i, '')
      .replace(/^[\s:,-]+|[\s.;,!]+$/g, '')
      .trim();
    if (value.length >= 2 && !out[label.key]) out[label.key] = capitalize(value).slice(0, 1000);
  });
  return out;
}

/** "Write my introduction", "Introduce myself": the three questions, one at a time. */
export const asksWholeIntroduction = (text: string) =>
  /\b(?:write|fill(?: in)?|do|update|redo|start)\b(?: \S+){0,2}? introduction\b|\bintroduce myself\b|\ball three\b/.test(norm(text)) && !Object.keys(introductionIn(text)).length;

// ---------------------------------------------------------------- Team (docs section 8)

export type TeamFocus = 'manager' | 'reports' | 'peers' | 'leave' | 'available' | 'wfh' | 'all';

/** What a Team question is about, or null when the words don't say (the model is asked then). */
export function teamFocus(text: string): TeamFocus | null {
  const t = norm(text);
  if (WFH.test(t)) return 'wfh';
  if (/\b(?:who reports to me|my (?:direct )?reports|reporting to me|my reportees|people under me|my juniors)\b/.test(t)) return 'reports';
  if (/\b(?:my manager|my boss|my reporting manager|my lead|who do i report to|whom do i report to|who approves)\b/.test(t)) return 'manager';
  if (/\b(?:my teammates?|my peers|my colleagues|who else reports to)\b/.test(t)) return 'peers';
  if (/\b(?:on leave|off|out|away|absent|not in|on holiday|on vacation|chutti|leave)\b/.test(t)) return 'leave';
  if (/\b(?:available|availability|in today|in office|around|free)\b|\bis \S+ (?:in|coming in|working)\b/.test(t)) return 'available';
  if (/\b(?:my team|team members|everyone|everybody|whole team|show (?:me )?(?:my )?team|list (?:my )?team|who is in my team|who s in my team)\b/.test(t)) return 'all';
  return null;
}

// ---------------------------------------------------------------- Holidays (docs section 9)

/** Days from `today` to `day`, for "in 17 days". */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export type HolidayQuestion =
  | { kind: 'next' }
  | { kind: 'left' }
  | { kind: 'long'; year?: number }
  | { kind: 'date'; date: string }
  | { kind: 'month'; month: string }
  | { kind: 'year'; year: number }
  | { kind: 'named'; name: string };

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * What a Holidays question asks. A month without a year is this year's, unless it is over: then
 * next year's ("Holidays in January", said in October). A date leans to this year.
 * Null when the words don't say (the model is asked then).
 */
export function holidayQuestion(text: string, today: string): HolidayQuestion | null {
  // "May I see the holidays?" doesn't name May.
  const t = norm(text).replace(/^may i\b/, '');
  const thisYear = Number(today.slice(0, 4));
  const yearSaid = /\b(20\d{2})\b/.exec(t);
  const year = yearSaid ? Number(yearSaid[1]) : /\bnext year\b/.test(t) ? thisYear + 1 : /\blast year\b/.test(t) ? thisYear - 1 : undefined;
  if (/\blong weekends?\b|\bbridge\b|\b3 day weekends?\b|\bthree day weekends?\b/.test(t)) return { kind: 'long', year };
  if (/\b(?:next|upcoming|coming)(?: public)? holiday\b(?! s)/.test(t) && !/\bholidays\b/.test(t)) return { kind: 'next' };
  if (/\b(?:left|remaining|upcoming|coming up|rest of the year|still to come)\b/.test(t)) return { kind: 'left' };
  const monthWord = MONTH_NAMES.findIndex((m) => new RegExp(`\\b${m}\\b|\\b${m.slice(0, 3)}\\b`).test(t));
  const day = /\b\d{1,2}(?:st|nd|rd|th)?\b|\b(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t.replace(/\b20\d{2}\b/g, ' ')) ? dayOf(text, today, 'recent', 366) : null;
  if (day) return { kind: 'date', date: day };
  if (monthWord >= 0 || /\b(?:this|next) month\b/.test(t)) {
    const [y, m] = today.split('-').map(Number);
    const next = /\bnext month\b/.test(t);
    const month = monthWord >= 0 ? monthWord + 1 : next ? (m % 12) + 1 : m;
    const inYear = year ?? (monthWord >= 0 ? (month < m ? y + 1 : y) : next && m === 12 ? y + 1 : y);
    return { kind: 'month', month: `${inYear}-${String(month).padStart(2, '0')}` };
  }
  if (year) return { kind: 'year', year };
  const when = /\bwhen (?:is|s|was|does|will)(?: the)? (.+?)(?: holiday| fall| come| be)?$/.exec(t);
  if (when && !/\b(?:next|holiday|holidays)\b/.test(when[1])) return { kind: 'named', name: when[1] };
  if (/\b(?:holidays|holiday list|holiday calendar|this year|all holidays)\b/.test(t)) return { kind: 'year', year: thisYear };
  return null;
}
