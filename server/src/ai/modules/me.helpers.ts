// Pure helpers shared by the Me page's assistants (docs/AI_ME_ASSISTANTS.md): Leave, Attendance
// and My expenses. Dates and times are read in ../dates.ts; these word the answers and read
// the small things every tab needs (reasons, cancel requests, the other tabs' work).

import { ApiCallError } from '../apiClient';
import { formatDay } from '../dates';
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

/** Work that belongs to another Me tab, and the line that says where. Null when it's this tab's. */
export function otherTab(text: string, here: 'leave' | 'attendance' | 'expenses'): string | null {
  const t = norm(text);
  const wfh = /\b(?:wfh|work(?:ing)? from home|remote(?:ly)?)\b/.test(t);
  const fix = /\b(?:fix|regulari[sz]\w*|clock(?:ed)?\s*(?:in|out)|punch)\b/.test(t);
  const leave = /\b(?:leave|leaves|day off|days off|holiday|vacation|chutti)\b/.test(t);
  const claim = /\b(?:claim|claims|reimburse\w*|receipt|expense|expenses)\b/.test(t);
  if (here !== 'attendance' && (wfh || fix) && !leave && !claim) return `${wfh ? 'Work from home' : 'Attendance fixes'} ${wfh ? 'is' : 'are'} on the **Attendance** tab: open it and ask there.`;
  if (here !== 'leave' && leave && !wfh && !fix && !claim) return 'Leave is on the **Leave** tab: open it and ask there.';
  if (here !== 'expenses' && claim && !leave && !wfh && !fix) return 'Expense claims are on the **Expenses** tab: open it and ask there.';
  return null;
}
