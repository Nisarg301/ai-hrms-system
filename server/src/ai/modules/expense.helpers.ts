// Pure helpers for the Expenses assistant (docs/AI_EXPENSES_ASSISTANT.md, sections 3–5). They
// read statuses, expense-date ranges and amounts from the user's own words; the model only
// copies them, and is never trusted with calendar maths or with which amount is which.

import * as chrono from 'chrono-node';
import { addDays, monthRange, weekRange } from '../../utils/dates';
import { formatDay } from '../dates';
import { norm } from '../text';

// ---------------------------------------------------------------- claim statuses

/** Admins never see drafts, as on the page. */
export const CLAIM_STATUSES = ['submitted', 'approved', 'rejected', 'paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** The page's labels (client/src/utils/expenseFormat.ts). */
export const STATUS_LABELS: Record<ClaimStatus, string> = {
  submitted: 'Awaiting approval',
  approved: 'Approved – to be paid',
  rejected: 'Rejected',
  paid: 'Paid',
};

// Checked in order, each match taken out before the next: "pending payment" is approved, not
// submitted, and "unpaid" is not paid.
const STATUS_WORDS: [ClaimStatus, RegExp][] = [
  ['approved', /\b(?:approved|to be paid|awaiting payment|pending payment|payment pending|unpaid|not paid|not yet paid|yet to be paid)\b/g],
  ['rejected', /\b(?:rejected|declined|refused|denied)\b/g],
  ['submitted', /\b(?:submitted|pending|waiting|awaiting(?: approval)?|to approve|for approval|to review|for review|under review|in review)\b/g],
  ['paid', /\b(?:paid|reimbursed|settled)\b/g],
];

/** Every status the words name, in the order above: "approved but not paid yet" → ['approved']. */
export function statusesIn(text: string): ClaimStatus[] {
  let t = ` ${norm(text)} `;
  const found: ClaimStatus[] = [];
  for (const [status, pattern] of STATUS_WORDS) {
    if (pattern.test(t)) found.push(status);
    t = t.replace(pattern, ' ');
  }
  return found;
}

/** "Show all claims", "any status": no status filter, on purpose. */
export const asksForAnyStatus = (text: string) => /\b(?:all|any|every)(?: the)? (?:claims?|status(?:es)?|of them)\b|\bwhatever status\b/.test(norm(text));

// ---------------------------------------------------------------- expense-date ranges

export interface DateRange {
  from?: string;
  to?: string;
  /** "1 Oct – 21 Oct 2026", "since Thu 1 Oct 2026". */
  label: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-01 → "1 Oct 2026". */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

/** "1 Oct – 21 Oct 2026", or "1 Dec 2025 – 21 Oct 2026" across years. */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDay(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? shortDay(from).replace(/ \d{4}$/, '') : shortDay(from)} – ${shortDay(to)}`;
}

/**
 * One end of a range ("1 Oct", "15/09/2026", "15") as a past-leaning day: expenses are in the
 * past, so "1 Dec" said in October is last December. `monthHint` completes a bare day number
 * ("between 1 and 15 October").
 */
function pastDay(piece: string, today: string, monthHint?: string): string | null {
  let text = piece.trim();
  if (/^\d{1,2}(?:st|nd|rd|th)?$/.test(text) && monthHint) text = `${text} ${monthHint}`;
  const parsed = chrono.en.GB.parse(text, new Date(`${today}T12:00:00Z`))[0];
  if (!parsed || parsed.index > 2) return null;
  const { start } = parsed;
  if (!start.isCertain('day') && !start.isCertain('month')) return null;
  let year = start.get('year')!;
  const iso = (y: number) => `${y}-${String(start.get('month')).padStart(2, '0')}-${String(start.get('day')).padStart(2, '0')}`;
  if (!start.isCertain('year') && iso(year) > today) year -= 1;
  return iso(year);
}

// One day as people write it, or as a button carries it (ISO).
const DAY = '\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+[a-z]+(?:\\s+\\d{4})?|[a-z]+\\s+\\d{1,2}(?:\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?';

const monthOf = (text: string) => new RegExp(`\\b${MONTH_WORD}(?:\\s+\\d{4})?\\b`).exec(text)?.[0];

/**
 * The expense dates the words name, or null when they name none. Counted from `today`
 * (YYYY-MM-DD in APP_TIMEZONE). Used for the claims filter, the summary and the export.
 */
export function dateRange(text: string, today: string): DateRange | null {
  // Hinglish, looking back: "kal" is yesterday, "aaj" today.
  text = text.replace(/\b(?:kal|kl)\b/gi, 'yesterday').replace(/\b(?:aaj|aj)\b/gi, 'today');
  const t = ` ${text.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ')} `;
  const n = ` ${norm(text)} `;
  const range = (from: string, to: string): DateRange => (from > to ? { from: to, to: from, label: rangeLabel(to, from) } : { from, to, label: rangeLabel(from, to) });

  // From–to first: its ends can hold month names that would otherwise read as a whole month.
  const between = /\b(?:from|between)\s+(.+?)\s+(?:to|and|till|until|through|upto|up to|-|–)\s+(.+?)(?=\s+(?:for|in|by|of|with|from|on)\b|\s*$)/.exec(t);
  const plain = /\b(\d{1,2}(?:st|nd|rd|th)?(?:\s+[a-z]+)?(?:\s+\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s*(?:to|-|–|till|until)\s*(\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+(?:\s+\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/.exec(t);
  for (const m of [between, plain]) {
    if (!m) continue;
    const hint = monthOf(m[2]);
    const from = pastDay(m[1], today, hint);
    const to = pastDay(m[2], today);
    if (from && to) return range(from, to);
  }

  if (/\btoday\b/.test(n)) return range(today, today);
  if (/\byesterday\b/.test(n)) return range(addDays(today, -1), addDays(today, -1));
  if (/\bthis week\b/.test(n)) {
    const w = weekRange(today);
    return range(w.from, today < w.to ? today : w.to);
  }
  if (/\blast week\b/.test(n)) {
    const w = weekRange(addDays(today, -7));
    return range(w.from, w.to);
  }
  const month = today.slice(0, 7);
  if (/\bthis month\b/.test(n)) return range(`${month}-01`, today);
  if (/\b(?:last|previous|past) month\b/.test(n)) {
    const [y, m] = month.split('-').map(Number);
    const prev = monthRange(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
    return range(prev.from, prev.to);
  }
  if (/\bthis year\b/.test(n)) return range(`${today.slice(0, 4)}-01-01`, today);
  if (/\b(?:last|previous|past) year\b/.test(n)) {
    const y = Number(today.slice(0, 4)) - 1;
    return range(`${y}-01-01`, `${y}-12-31`);
  }
  const days = /\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/.exec(n);
  if (days) return range(addDays(today, -(Number(days[1]) - 1)), today);

  const since = new RegExp(`\\b(?:since|after|starting|from)\\s+(${DAY})`).exec(t);
  const sinceDay = since ? pastDay(since[1], today) : null;
  if (sinceDay) return { from: sinceDay, to: today, label: rangeLabel(sinceDay, today) };
  const until = new RegExp(`\\b(?:until|till|before|up to|upto|by)\\s+(${DAY})`).exec(t);
  const untilDay = until ? pastDay(until[1], today) : null;
  if (untilDay) return { to: untilDay, label: `until ${shortDay(untilDay)}` };

  // One day: "on 5 Oct", "dated 15/09/2026".
  const single = new RegExp(`\\b(\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?:\\s+\\d{4})?|${MONTH_WORD}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?)`).exec(t);
  const singleDay = single ? pastDay(single[1], today) : null;
  if (singleDay) return range(singleDay, singleDay);

  // A whole month: "October", "in Sep 2025". "May" only with a year or after in/for/of/during,
  // as it is also a verb ("May I see …").
  const named = new RegExp(`\\b(?:(in|for|of|during)\\s+)?${MONTH_WORD}(?:\\s+(\\d{4}))?\\b`).exec(n);
  if (named && !(named[2] === 'may' && !named[1] && !named[3])) {
    const index = MONTHS.indexOf(named[2].slice(0, 3));
    let year = named[3] ? Number(named[3]) : Number(today.slice(0, 4));
    if (!named[3] && `${year}-${String(index + 1).padStart(2, '0')}` > month) year -= 1;
    const r = monthRange(`${year}-${String(index + 1).padStart(2, '0')}`);
    return range(r.from, r.to < today ? r.to : today);
  }

  return null;
}

export { formatDay };

// ---------------------------------------------------------------- amounts

/** "₹2,000", "2000 rupees", "2k", "1.5 lakh", "₹499.50" → rupees. */
const AMOUNT = /(?:₹|\brs\.?\s*|\binr\s*)?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(k\b|thousand\b|lakhs?\b|lacs?\b))?(?:\s*(?:rupees|rs)\b)?/gi;

interface AmountAt {
  rupees: number;
  index: number;
  end: number;
}

function amountsIn(text: string): AmountAt[] {
  const out: AmountAt[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    // A number glued to letters ("Q3", "2nd") is not an amount.
    if (/[a-z]/i.test(text[m.index! + m[0].length] ?? '') || /[a-z]/i.test(text[m.index! - 1] ?? '')) continue;
    const whole = Number(m[1].replace(/,/g, ''));
    let rupees = whole + (m[2] ? Number(m[2].padEnd(2, '0')) / 100 : 0);
    const unit = (m[3] ?? '').toLowerCase();
    if (unit === 'k' || unit === 'thousand') rupees *= 1000;
    else if (unit) rupees *= 100000;
    out.push({ rupees: Math.round(rupees * 100) / 100, index: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** "₹2,000" → 2000; null when the words hold no amount. */
export function amountFrom(text: string): number | null {
  return amountsIn(text)[0]?.rupees ?? null;
}

export const MAX_RUPEES = 1_000_000;

const LIMIT_WORD = /\b(?:limits?|max(?:imum)?|up\s*to|cap(?:ped)?|ceiling|per expense)\b/gi;
const RECEIPT_WORD = /\breceipts?\b/gi;
const NO_LIMIT = /\b(?:no|without|remove|removing|drop|clear|delete|take off|take away)\s+(?:the\s+|a\s+|any\s+|its\s+)?(?:\w+\s+)?limit\b|\bunlimited\b|\blimit\s+(?:to\s+)?(?:none|nothing)\b|\bno\s+cap\b/i;
const ALWAYS_RECEIPT = /\balways\s+(?:needs?|requires?|requiring|needing|with)\s+(?:a\s+)?receipts?\b|\breceipts?\s+(?:is\s+|are\s+)?(?:always|for (?:every|all|each)(?:thing| expenses?)?)\b|\b(?:every|each|all)\s+expenses?\s+(?:needs?|requires?)\s+(?:a\s+)?receipts?\b/i;

export interface CategoryAmounts {
  /** undefined = not said; null = no limit. */
  limitRupees?: number | null;
  receiptAboveRupees?: number;
}

/**
 * The limit and the receipt rule a message gives. Each amount belongs to the nearest field
 * word before it ("limit ₹2,000 and receipt needed above ₹500"), or after it when none comes
 * before ("₹2,000 limit").
 */
export function categoryAmounts(text: string): CategoryAmounts {
  const out: CategoryAmounts = {};
  if (NO_LIMIT.test(text)) out.limitRupees = null;
  if (ALWAYS_RECEIPT.test(text)) out.receiptAboveRupees = 0;
  const words = [
    ...[...text.matchAll(LIMIT_WORD)].map((m) => ({ field: 'limit' as const, index: m.index!, end: m.index! + m[0].length })),
    ...[...text.matchAll(RECEIPT_WORD)].map((m) => ({ field: 'receipt' as const, index: m.index!, end: m.index! + m[0].length })),
  ];
  for (const a of amountsIn(text)) {
    const before = words.filter((w) => w.end <= a.index && !amountsIn(text.slice(w.end, a.index)).length).sort((x, y) => y.end - x.end)[0];
    const after = words.filter((w) => w.index >= a.end && w.index - a.end <= 3).sort((x, y) => x.index - y.index)[0];
    const field = (before ?? after)?.field;
    if (field === 'limit' && out.limitRupees === undefined) out.limitRupees = a.rupees;
    if (field === 'receipt' && out.receiptAboveRupees === undefined) out.receiptAboveRupees = a.rupees;
  }
  return out;
}

/** A problem with an amount, in the page form's words, or null. */
export function amountProblem(field: 'limit' | 'receipt', rupees: number | null | undefined): string | null {
  if (rupees === undefined || rupees === null) return null;
  if (field === 'limit' && rupees <= 0) return 'A limit must be more than zero.';
  if (rupees > MAX_RUPEES) return `At most ₹10,00,000 (${field === 'limit' ? 'limit per expense' : 'receipt needed above'}).`;
  return null;
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 195050 paise → "₹1,950.50", as the page shows it (formatInrExact). */
export const inr = (paise: number) => INR.format(paise / 100);
export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const limitText = (paise: number | null) => (paise === null ? 'No limit' : inr(paise));
export const receiptText = (paise: number) => (paise === 0 ? 'Always' : `Above ${inr(paise)}`);

// ---------------------------------------------------------------- categories: active, names, intent

/** The active switch the words set: false for "inactive", "switch off"; null when they say nothing. */
export function activeFrom(text: string): boolean | null {
  const t = norm(text);
  if (/\b(?:inactive|not active|de ?activat\w*|disabled?|disable|switch(?:ed)? (?:it )?off|turn(?:ed)? (?:it )?off|band kar\w*)\b/.test(t)) return false;
  if (/\b(?:active|re ?activat\w*|activat\w*|enabled?|enable|switch(?:ed)? (?:it )?on|turn(?:ed)? (?:it )?on|chalu)\b/.test(t)) return true;
  return null;
}

/** A category's name as the model or the message gave it, without the request around it. */
export function cleanCategoryName(name: string): string {
  return name
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:(?:a|an|the|new|expense|category|called|named|titled)\s+)+/i, '')
    .replace(/\s+(?:expense\s+)?category$/i, '')
    .replace(/\s+(?:with|having|that|which|and|limit|receipt)\b.*$/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

/** The new category's name from the message: "category called X with …", "category X, limit …". */
export function categoryNameFrom(text: string): string | undefined {
  const m =
    /\b(?:called|named|titled)\s+["“']?([^"”',.:;₹]+?)["”']?(?=\s+(?:with|having|that|which|and|limit|receipt|for)\b|[,.:;₹]|$)/i.exec(text) ??
    /\bcategory\s+(?!(?:with|having|that|which|for|called|named|titled)\b)["“']?([^"”',.:;₹]+?)["”']?(?=\s+(?:with|having|that|which|and|limit|receipt|for)\b|[,.:;₹]|$)/i.exec(text);
  const name = m ? cleanCategoryName(m[1]) : '';
  return name && !/^(?:a|an|the|new|this|that|it)$/i.test(name) && !/\d/.test(name) ? name : undefined;
}

// Words for each change, as on Tasks, Documents and Roles: a field changes only when the message asks.
export const asksToRename = (text: string) => /\b(?:rename|renamed|call it|change (?:the |its )?name|new name)\b/.test(norm(text));
export const asksToDelete = (text: string) => /\b(?:delete|remove|drop|get rid of|hatao|hata do|mita do)\b/.test(norm(text)) && !NO_LIMIT.test(text);
/** A request for a new category: a creating verb first, or "new category". */
export const asksToCreate = (text: string) => /^(?:please )?(?:add|create|make|set up|setup|new)\b/.test(norm(text)) || /\bnew (?:expense )?categor(?:y|ies)\b/.test(norm(text));
/** A request to download now ("export the CSV", "download it"), not a question about exports. */
export const asksToExport = (text: string) => /\b(?:export|download|csv|excel|spreadsheet)\b/.test(norm(text));
