// Pure helpers for the Performance assistant (docs/AI_ME_ASSISTANTS.md, section 6): the words of a
// goal (title, dates, weight), of a check-in (progress, status, comment) and of a review (rating,
// "skip", "done", "stop"), and finding the goal a message means. The module does the API work.

import { monthRange } from '../../utils/dates';
import { dayOf } from '../dates';
import { norm } from '../text';
import { GoalStatus } from '../types';

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  behind: 'Behind',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** The fixed 1–5 scale, as on the page. */
export const RATING_LABELS: Record<number, string> = {
  1: 'Needs improvement',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Outstanding',
};

export const ratingText = (rating: number | null | undefined) => (rating ? `${rating} · ${RATING_LABELS[rating]}` : '—');

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

// ---------------------------------------------------------------- check-ins (section 6.2)

// "because design is late", "since two candidates dropped out", "comment: …". Not "as": "mark it as done".
const COMMENT = /\b(?:because(?: of)?|since|due to|comment|note)\b\s*[:-]?\s*(.+)$/i;

/** The comment the user gave, or undefined. */
export function commentIn(text: string): string | undefined {
  const m = COMMENT.exec(text);
  const said = m?.[1].trim().replace(/[.!]+$/, '');
  return said && said.length >= 3 ? said.slice(0, 1000) : undefined;
}

/** The words before any comment: "Cancel" in "…because the client cancelled" isn't a status. */
export const withoutComment = (text: string) => text.replace(COMMENT, ' ');

// A percentage that is a weight ("20% weight", "weight 20%") isn't progress.
const WEIGHT = /\bweight(?:age)?\s*(?:of|is|at|to|=|:)?\s*(\d{1,3})\s*%?|\b(\d{1,3})\s*%\s*weight(?:age)?\b/i;

/** "60%", "60 percent", "progress to 60", "halfway". Undefined when not said. */
export function progressIn(text: string): number | undefined {
  const t = withoutComment(text).replace(WEIGHT, ' ').toLowerCase();
  const pct = /\b(\d{1,3})\s*(?:%|percent\b|per cent\b|pc\b)/.exec(t) ?? /\bprogress\s*(?:is|at|to|of|=|:)?\s*(\d{1,3})\b/.exec(t);
  if (pct) {
    const n = Number(pct[1]);
    return n >= 0 && n <= 100 ? n : undefined;
  }
  if (/\b(?:halfway|half way|half done|50 50)\b/.test(t)) return 50;
  return undefined;
}

/** "weight 20%", "20% weight", "weightage 20". Undefined when not said or out of 1–100. */
export function weightIn(text: string): number | undefined {
  const m = WEIGHT.exec(text);
  const n = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined;
}

/**
 * The status the user said, 'reopen' for a cancelled goal brought back, or undefined. "60% done"
 * is progress, not Completed; "done" alone, or with 100%, is Completed.
 */
export function goalStatusIn(text: string): GoalStatus | 'reopen' | undefined {
  const t = norm(withoutComment(text));
  if (/\b(?:cancel|cancell?ed|drop|dropped|abandon(?:ed)?|scrap(?:ped)?)\b/.test(t)) return 'cancelled';
  if (/\b(?:reopen|re open|restart|resume|revive)\b/.test(t)) return 'reopen';
  if (/\b(?:at risk|risky|in danger)\b/.test(t)) return 'at_risk';
  if (/\b(?:behind(?: schedule)?|delayed|lagging|slipping|off track)\b/.test(t)) return 'behind';
  if (/\b(?:on track|going well|on schedule)\b/.test(t)) return 'on_track';
  if (/\b(?:completed?|finished|achieved|accomplished)\b/.test(t)) return 'completed';
  const progress = progressIn(text);
  if (/\bdone\b/.test(t) && (progress === undefined || progress === 100)) return 'completed';
  return undefined;
}

// ---------------------------------------------------------------- a new goal (section 6.1)

/** "end of the year", "end of next month", "end of this quarter" → that last day. */
export function endOf(text: string, today: string): string | undefined {
  const m = /\bend of (?:the |this )?(next )?(year|month|quarter)\b/i.exec(text);
  if (!m) return undefined;
  const [y, mo] = today.split('-').map(Number);
  const next = Boolean(m[1]);
  if (m[2].toLowerCase() === 'year') return `${y + (next ? 1 : 0)}-12-31`;
  if (m[2].toLowerCase() === 'month') {
    const month = next ? (mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`) : today.slice(0, 7);
    return monthRange(month).to;
  }
  const quarterEnd = Math.ceil(mo / 3) * 3 + (next ? 3 : 0);
  const year = y + (quarterEnd > 12 ? 1 : 0);
  return monthRange(`${year}-${String(((quarterEnd - 1) % 12) + 1).padStart(2, '0')}`).to;
}

const DATE_STOP = '(?=\\s*(?:[,;.]|\\bweight|\\bstart|\\bfrom\\b|\\bwith\\b|\\bfor\\b|\\band\\b|$))';

/** The due date: "by 31 Jan", "due 15 Jan", "before 1 Dec", "by the end of the year". Leans to the future. */
export function dueIn(text: string, today: string): string | undefined {
  const m = new RegExp(`\\b(?:by|due(?: on| by| date(?: is| of)?)?|before|until|till|deadline(?: is| of)?)\\s+(?:the\\s+)?(.+?)${DATE_STOP}`, 'i').exec(text);
  if (!m) return undefined;
  return endOf(m[0], today) ?? dayOf(m[1], today, 'future') ?? undefined;
}

/** A new due date in a change: "move the due date to 15 Jan", "push it to 15 Jan", "extend it till 15 Jan". */
export function newDueIn(text: string, today: string): string | undefined {
  const m =
    /\b(?:due(?: date)?|deadline)\b.*?\b(?:to|as|on|till|until)\s+(.+)$/i.exec(text) ??
    /\b(?:push|move|extend|postpone|shift|delay|change)\b.*?\b(?:to|till|until)\s+(.+)$/i.exec(text);
  if (m) return endOf(m[1], today) ?? dayOf(m[1], today, 'future') ?? undefined;
  return dueIn(text, today);
}

/** The start: "starting 1 Nov", "from 1 Oct". A start a few months back is this year's. */
export function startIn(text: string, today: string): string | undefined {
  const m = new RegExp(`\\b(?:starting(?: on| from)?|start(?:s|ing)?(?: on| from| date(?: is)?)?|from|beginning)\\s+(.+?)(?=\\s*(?:[,;.]|\\bby\\b|\\bdue\\b|\\buntil\\b|\\btill\\b|\\bto\\b|\\bweight|$))`, 'i').exec(text);
  return m ? (dayOf(m[1], today, 'recent', 180) ?? undefined) : undefined;
}

// Where a title stops: a due date, a start, a weight, a description.
const TITLE_END = /\s*(?:[,;]\s*|\s+)(?:(?:by|due|before|until|till|deadline|starting|start(?:s|ing)?|from)\s+(?:the\s+)?(?:end of|\d{1,2}(?:st|nd|rd|th)?(?=[\s/.-]|$)|\d{4}-|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|next|this|tomorrow|today|mon|tue|wed|thu|fri|sat|sun)|with (?:a )?weight|weight(?:age)?\b|\d{1,3}\s*%\s*weight|description\s*:|details\s*:).*$/i;

/**
 * The title of a new goal: "Set a goal to launch the onboarding flow by 31 Dec" → "Launch the
 * onboarding flow". "New goal: hire a designer", "a goal called Ship v2", "a goal for Neha to
 * close 10 deals". Undefined when the message gives none.
 */
export function goalTitleFrom(text: string): string | undefined {
  const m =
    /\b(?:goal|objective|okr)\s+(?:called|named|titled)\s+(.+)$/i.exec(text) ??
    /\b(?:goal|objective|okr)(?:\s+for\s+[^:]+?)?\s*[:–-]\s*(.+)$/i.exec(text) ??
    /\b(?:goal|objective|okr)(?:\s+for\s+\S+(?:\s+[A-Z]\S*)?)?\s+(?:to|of|that i|that we)\s+(.+)$/i.exec(text);
  return m ? goalTitleOf(m[1]) : undefined;
}

/** A title as said in reply to "What's the goal?": "To hire a designer by 31 Jan" → "Hire a designer". */
export function titleFromReply(text: string): string | undefined {
  return goalTitleOf(text.replace(/^\s*(?:(?:it['’]?s|it is|the goal is|my goal is|goal is|i want to|i['’]?d like to|to)\s+)+/i, ''));
}

/** A title with its date, weight and description tails cut, capitalized; undefined when nothing is left. */
export function goalTitleOf(raw: string): string | undefined {
  const title = raw.replace(TITLE_END, '').replace(/^["“']|["”'.!]+$/g, '').trim();
  if (title.length < 3 || /^(?:a|an|the|new|goal|it|this|that)$/i.test(title)) return undefined;
  return (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 120);
}

/** "description: the three new screens", "details: …". */
export function descriptionIn(text: string): string | undefined {
  const m = /\b(?:description|details|describe it as)\s*[:-]\s*(.+)$/i.exec(text);
  return m ? m[1].trim().replace(/[.!]+$/, '').slice(0, 2000) : undefined;
}

// ---------------------------------------------------------------- finding a goal

const GOAL_STOP = new Set(['the', 'and', 'for', 'with', 'goal', 'goals', 'new', 'my', 'our', 'two', 'three', 'four', 'five', 'one', 'this', 'that', 'into', 'from', 'all']);
const wordsOf = (s: string) => norm(s).split(' ').filter((w) => w.length >= 3 && !GOAL_STOP.has(w));
const stem = (w: string) => w.replace(/(?:ing|ed|es|s|e)$/, '');

/** Whether two words are the same word, give or take an ending ("hiring" and "hire", "engineers" and "engineer"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true;
  return short.length >= 4 && stem(a).length >= 3 && stem(a) === stem(b);
}

/**
 * The goals a message names, best first: the goal whose title is said whole, else the ones with
 * the most title words in the message. Several equally good come back together (the caller asks).
 */
export function findGoals<T extends { title: string }>(text: string, goals: T[]): T[] {
  const said = ` ${norm(text)} `;
  const whole = goals.filter((g) => said.includes(` ${norm(g.title)} `));
  if (whole.length) return whole;
  const words = wordsOf(text);
  const scored = goals.map((g) => ({ g, score: wordsOf(g.title).filter((tw) => words.some((w) => sameWord(w, tw))).length }));
  const best = Math.max(0, ...scored.map((s) => s.score));
  return best ? scored.filter((s) => s.score === best).map((s) => s.g) : [];
}

// ---------------------------------------------------------------- reviews (section 6.3)

/** "4", "four", "4 out of 5", "4/5", "rate myself 4", "exceeds expectations". Undefined when not said. */
export function ratingIn(text: string): number | undefined {
  const t = norm(text.replace(/(\d)\s*\/\s*5\b/, '$1 out of 5'));
  const label = Object.entries(RATING_LABELS).find(([, l]) => t.includes(norm(l)));
  if (label) return Number(label[0]);
  const m =
    /\b([1-5]|one|two|three|four|five)\s*(?:out of|on|of)\s*(?:5|five)\b/.exec(t) ??
    /\b(?:rat(?:e|ing)|give|score)\b(?: \S+){0,3}? (?:a |as )?([1-5]|one|two|three|four|five)\b/.exec(t) ??
    /^(?:i d say |i would say |maybe |a )?([1-5]|one|two|three|four|five)$/.exec(t);
  if (!m) return undefined;
  return /^\d$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
}

export type ControlWord = 'skip' | 'done' | 'stop';

/** A reply that steers the questions instead of answering one. */
export function controlWord(text: string): ControlWord | null {
  const t = norm(text);
  if (/^(?:skip|skip it|skip this(?: one)?|skip for now|pass|next|next question|leave it|later|no answer)$/.test(t)) return 'skip';
  if (/^(?:done|that s all|that is all|that s it|finish|finished|i m done|im done|nothing more|enough|show (?:me )?the card)$/.test(t)) return 'done';
  if (/^(?:stop|cancel|never mind|nevermind|forget it|quit|exit|abort)$/.test(t)) return 'stop';
  return null;
}

/** "Submit my self review", but not "don't submit yet" or "save it as a draft". */
export function asksToSubmit(text: string): boolean {
  const t = norm(text);
  return /\bsubmit\b/.test(t) && !/\b(?:don t|do not|not|never)(?: \S+)? submit\b|\bdraft\b/.test(t);
}
