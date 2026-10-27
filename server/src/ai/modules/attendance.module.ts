import { z } from 'zod';
import { addDays, minutesOfDay, now } from '../../utils/dates';
import { basePrompt } from '../prompts/base.prompt';
import { dayOf, dayRangeOf, DayRange, formatDay, timesIn, Times } from '../dates';
import { grounded, isBlank, norm, str } from '../text';
import { AiButton, AiModule, AiTool, AiUserError, ApiClient, FixFormValues, ToolContext, WfhFormValues } from '../types';
import { dateRange } from './expense.helpers';
import { apiMessage, asksToCancel, otherTab, rangeText, reasonFrom, refusal, weekdaysIn } from './me.helpers';

// The Attendance assistant on the Me page's Attendance tab (docs/AI_ME_ASSISTANTS.md, section 4):
// work from home, fixes to a day's clock-in and clock-out, the month, and cancelling a request.
// The user's own attendance only, through /attendance/me and /attendance/requests with their token.

interface RequestRow {
  id: string;
  kind: 'regularization' | 'wfh';
  startDate: string;
  endDate: string;
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  canCancel: boolean;
}

interface LeaveRow {
  startDate: string;
  endDate: string;
  halfDay: 'first' | 'second' | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  leaveTypeName: string | null;
}

interface MonthView {
  month: string;
  days: { date: string; missingClockOut: boolean; status: string }[];
  totals: { present: number; halfDay: number; absent: number; late: number; onLeave: number; averageMinutes: number };
}

/** The API's limits (attendanceRequest.service.ts). */
const MAX_WFH_BACK_DAYS = 7;
const MAX_FIX_BACK_DAYS = 30;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

const KIND_LABELS: Record<RequestRow['kind'], string> = { wfh: 'Work from home', regularization: 'Attendance fix' };
const STATUS_LABELS: Record<RequestRow['status'], string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
const active = (s: string) => s === 'pending' || s === 'approved';

// Words that belong to the dates or times, and never make a reason.
const NOT_REASON = /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|today|yesterday|next|last|week|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*|\d+(?:st|nd|rd|th)?|am|pm|clock\w*|in|out|wfh|work|home|fix|from|regulari[sz]\w*)\b/g;

/** The reason for a fix: the user's own, or "Forgot to clock out" when that's what they said. */
function fixReason(message: string, modelReason: unknown): string {
  const said = reasonFrom(message, modelReason, NOT_REASON);
  if (said) return said;
  const forgot = /\b(?:forgot|forget|missed|didn ?t)\s+(?:to\s+)?(?:clock|punch)\s*-?\s*(in|out)\b/i.exec(message);
  return forgot ? `Forgot to clock ${forgot[1].toLowerCase()}` : '';
}

/** "Fix 15 Oct, 9 to 6": the date's own numbers taken out, so they aren't read as times. */
function withoutDates(message: string): string {
  return message
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?/gi, ' ')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s+\d{4})?/gi, ' ');
}

const hmText = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${hm} (${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'})`;
};

const minutesText = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');

async function myRequests(api: ApiClient): Promise<RequestRow[]> {
  return api.get<RequestRow[]>('/attendance/requests/mine');
}

// ---------------------------------------------------------------- my_attendance

const monthInput = z.object({ month: text("The month in the user's words, only if they named one") });

const myAttendance: AiTool<z.infer<typeof monthInput>> = {
  name: 'my_attendance',
  label: 'Looking up your month',
  kind: 'read',
  description: "Show the user's own attendance for a month: days present, half days, absent, late, on leave, the average day, and days with a missing clock-out.",
  input: monthInput,
  async run(args, api, ctx) {
    const words = ctx.fromButton ? (str(args.month) ?? '') : ctx.latestText;
    const month = /^\d{4}-\d{2}$/.test(words) ? words : (dateRange(words, ctx.today)?.from ?? ctx.today).slice(0, 7);
    const m = await api.get<MonthView>('/attendance/me', { month });
    const t = m.totals;
    const label = new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const missing = m.days.filter((d) => d.missingClockOut);
    return {
      text: `**${label}:** ${t.present} present, ${t.halfDay} half day${t.halfDay === 1 ? '' : 's'}, ${t.absent} absent, **${t.late} late**, ${t.onLeave} leave day${t.onLeave === 1 ? '' : 's'}. Average day ${minutesText(t.averageMinutes)}.${
        missing.length ? ` You didn't clock out on ${missing.map((d) => formatDay(d.date)).join(', ')}.` : ''
      }`,
      buttons: missing.slice(0, 3).map((d) => ({ label: `Fix ${formatDay(d.date)}`, toolCall: { name: 'request_fix', args: { date: d.date } } })),
    };
  },
};

// ---------------------------------------------------------------- list_attendance_requests

const listInput = z.object({
  kind: text('"work from home" or "fix", only if the user said which'),
  status: text('"pending", "approved", "rejected" or "cancelled", only if the user said one'),
});

const requestDates = (r: RequestRow) => `${rangeText(r.startDate, r.endDate)}${r.kind === 'regularization' && r.clockIn ? ` · ${r.clockIn}–${r.clockOut}` : ''}`;

const listRequests: AiTool<z.infer<typeof listInput>> = {
  name: 'list_attendance_requests',
  label: 'Looking up your requests',
  kind: 'read',
  description: "List the user's own work-from-home and attendance-fix requests with their status.",
  input: listInput,
  async run(args, api, ctx) {
    const rows = await myRequests(api);
    const t = ctx.fromButton ? `${str(args.kind) ?? ''} ${str(args.status) ?? ''}` : norm(ctx.latestText);
    const kind = /\b(?:wfh|work from home|remote)\b/.test(t) ? 'wfh' : /\b(?:fix|fixes|regulari[sz]\w*)\b/.test(t) ? 'regularization' : undefined;
    const status = t.match(/\b(pending|approved|rejected|cancelled|canceled)\b/)?.[1]?.replace('canceled', 'cancelled');
    const shown = rows.filter((r) => (!kind || r.kind === kind) && (!status || r.status === status));
    const noun = kind === 'wfh' ? 'work-from-home request' : kind ? 'fix request' : 'request';
    if (!shown.length) return { text: `You have no ${status ? `${status} ` : ''}${noun}s.` };
    return {
      text: `**${shown.length} ${status ? `${status} ` : ''}${noun}${shown.length === 1 ? '' : 's'}**.`,
      table: {
        columns: [
          { key: 'kind', title: 'Request' },
          { key: 'dates', title: 'Dates' },
          { key: 'reason', title: 'Reason' },
          { key: 'status', title: 'Status' },
        ],
        rows: shown.slice(0, 20).map((r) => ({ kind: KIND_LABELS[r.kind], dates: requestDates(r), reason: r.reason || '—', status: STATUS_LABELS[r.status] })),
      },
      buttons: shown.filter((r) => r.canCancel).slice(0, 4).map(cancelButton),
    };
  },
};

// ---------------------------------------------------------------- request_wfh

const wfhInput = z.object({
  dates: text('The work-from-home dates exactly as the user said them'),
  reason: text("The reason in the user's words, only if they gave one"),
  startDate: text('Leave empty'),
  endDate: text('Leave empty'),
});

const wfhValuesSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the dates'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the dates'),
  reason: z.string().trim().max(500, 'At most 500 characters'),
});

const wfhBody = (v: WfhFormValues) => ({ kind: 'wfh' as const, startDate: v.startDate, endDate: v.endDate, reason: v.reason.trim() });

/** Section 4.1: the API's rules, checked first so the answer explains instead of a card that would fail. */
async function wfhProblem(api: ApiClient, range: DayRange, today: string): Promise<string | null> {
  if (range.from < addDays(today, -MAX_WFH_BACK_DAYS)) return `Work from home can be asked for at most ${MAX_WFH_BACK_DAYS} days back.`;
  if (range.from.slice(0, 4) !== range.to.slice(0, 4)) return 'Keep it within one calendar year: ask for each year separately.';
  if (!weekdaysIn(range.from, range.to)) return 'Those dates are all weekends.';
  const [requests, leave] = await Promise.all([myRequests(api), api.get<LeaveRow[]>('/leave/requests/mine')]);
  const overlaps = (r: { startDate: string; endDate: string }) => r.startDate <= range.to && r.endDate >= range.from;
  const wfh = requests.find((r) => r.kind === 'wfh' && active(r.status) && overlaps(r));
  if (wfh) return `You already have ${wfh.status} work from home on ${rangeText(wfh.startDate, wfh.endDate)}.`;
  const off = leave.find((l) => active(l.status) && l.halfDay === null && overlaps(l));
  if (off) return `That overlaps your ${off.status} ${off.leaveTypeName ?? 'leave'} on ${rangeText(off.startDate, off.endDate)}.`;
  return null;
}

const formWfh: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'request_wfh', args: {}, form: true } };

const requestWfh: AiTool<z.infer<typeof wfhInput>> = {
  name: 'request_wfh',
  label: 'Checking the dates',
  kind: 'write',
  description: 'Ask to work from home on one day or a range of days. The user confirms before it is sent to their admin.',
  input: wfhInput,

  async prepare(args, api, ctx) {
    if (!ctx.fromButton && !ctx.form) {
      const elsewhere = otherTab(ctx.latestText, 'attendance');
      if (elsewhere) return { kind: 'ask', result: { text: elsewhere } };
      // "Cancel my WFH request for 2 Nov" came back as a new request.
      if (!ctx.rerouted && asksToCancel(ctx.latestText)) return { kind: 'reroute', tool: 'cancel_attendance_request', args: { which: ctx.latestText } };
    }
    const draft = ctx.draft?.tool === 'request_wfh' ? ctx.draft.args : {};
    const button = str(args.startDate) && str(args.endDate) ? { from: String(args.startDate), to: String(args.endDate) } : null;
    const said = ctx.fromButton ? button : (dayRangeOf(ctx.latestText, ctx.today, 'recent') ?? (str(args.dates) && grounded(String(args.dates), ctx.latestText) ? dayRangeOf(String(args.dates), ctx.today, 'recent') : null));
    const range = said ?? (str(draft.startDate) && str(draft.endDate) ? { from: String(draft.startDate), to: String(draft.endDate) } : null);
    const reason = ctx.fromButton ? (str(args.reason) ?? '') : reasonFrom(ctx.latestText, args.reason, NOT_REASON) || (str(draft.reason) ?? '');
    const values: WfhFormValues = { startDate: range?.from ?? '', endDate: range?.to ?? '', reason };
    const form = { kind: 'wfh' as const, mode: 'create' as const, values };
    if (!range) {
      if (ctx.form) return { kind: 'card', card: { title: 'Request work from home', tone: 'default', rows: [{ label: 'Dates', value: '—' }], confirmLabel: 'Send request', form, incomplete: true }, calls: [] };
      return {
        kind: 'ask',
        result: { text: 'Which day or days do you want to work from home?', buttons: [formWfh] },
        draft: { tool: 'request_wfh', args: reason ? { reason } : {}, missing: ['dates'], notSaved: [] },
      };
    }
    const problem = await wfhProblem(api, range, ctx.today);
    if (problem) return { kind: 'ask', result: { text: problem, buttons: [formWfh] } };
    const working = weekdaysIn(range.from, range.to);
    return {
      kind: 'card',
      card: {
        title: 'Request work from home',
        tone: 'default',
        rows: [
          { label: 'Dates', value: rangeText(range.from, range.to) },
          { label: 'Working days', value: String(working) },
          { label: 'Reason', value: reason || '—' },
        ],
        notes: range.from < ctx.today ? ['This is for days already past: your admin sees it as a late request.'] : undefined,
        confirmLabel: 'Send request',
        form,
      },
      calls: [{ method: 'POST', path: '/attendance/requests', body: wfhBody(values) }],
    };
  },

  async fillFromReply(draft, reply, _api, ctx) {
    if (draft.tool !== 'request_wfh') return null;
    const range = dayRangeOf(reply, ctx.today, 'recent');
    return range ? { ...draft.args, startDate: range.from, endDate: range.to } : null;
  },

  async revise(_pending, values) {
    const parsed = wfhValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    if (parsed.data.endDate < parsed.data.startDate) throw new AiUserError('The end date is before the start date.');
    return [{ method: 'POST', path: '/attendance/requests', body: wfhBody(parsed.data) }];
  },

  done([result]) {
    const r = result as RequestRow;
    return { text: `✅ **Work from home requested** for ${rangeText(r.startDate, r.endDate)}. Status: pending.` };
  },
};

// ---------------------------------------------------------------- request_fix

const fixInput = z.object({
  date: text('The day to fix, exactly as the user said it'),
  clockIn: text('The clock-in time exactly as the user said it'),
  clockOut: text('The clock-out time exactly as the user said it'),
  reason: text("The reason in the user's words, only if they gave one"),
});

const fixValuesSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date'),
    clockIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:30'),
    clockOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 18:30'),
    reason: z.string().trim().max(500, 'At most 500 characters'),
  })
  .refine((v) => v.clockOut > v.clockIn, { path: ['clockOut'], message: 'Clock-out must be after clock-in' });

const fixBody = (v: FixFormValues) => ({ kind: 'regularization' as const, date: v.date, clockIn: v.clockIn, clockOut: v.clockOut, reason: v.reason.trim() });

/** The times the user gave: the message's own reading, else the model's copy when its digits are in the message. */
function readTimes(args: z.infer<typeof fixInput>, ctx: ToolContext, kept: Times): Times {
  if (ctx.fromButton) return { clockIn: str(args.clockIn) ?? kept.clockIn, clockOut: str(args.clockOut) ?? kept.clockOut };
  const message = withoutDates(ctx.latestText);
  const said = timesIn(message);
  // The model's time counts only when each of its numbers is in the message.
  const model = (v: unknown, words: 'clock in' | 'clock out') => {
    const s = str(v);
    const numbers = s?.match(/\d+/g) ?? [];
    if (!s || !numbers.length || !numbers.every((n) => new RegExp(`\\b0*${Number(n)}\\b`).test(message))) return undefined;
    return timesIn(`${words} ${s}`)[words === 'clock in' ? 'clockIn' : 'clockOut'];
  };
  let clockIn = said.clockIn ?? model(args.clockIn, 'clock in') ?? kept.clockIn;
  let clockOut = said.clockOut ?? model(args.clockOut, 'clock out') ?? kept.clockOut;
  // A bare time in a reply that only lacks one of them ("6:30") is that one.
  if (!said.clockIn && !said.clockOut && (clockIn ? !clockOut : clockOut)) {
    const bare = /\b(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\b/i.exec(message)?.[1];
    if (bare && clockIn && !clockOut) clockOut = timesIn(`from ${clockIn} to ${bare}`).clockOut;
    else if (bare && clockOut && !clockIn) clockIn = timesIn(`clock in ${bare}`).clockIn;
  }
  return { clockIn, clockOut };
}

/** Section 4.2: the API's rules, checked first. */
async function fixProblem(api: ApiClient, v: { date: string; clockIn: string; clockOut: string }, today: string): Promise<string | null> {
  if (v.date > today) return "You can't fix a day that hasn't happened yet.";
  if (v.date < addDays(today, -MAX_FIX_BACK_DAYS)) return `Fixes can go back at most ${MAX_FIX_BACK_DAYS} days.`;
  if (v.clockOut <= v.clockIn) return 'Clock-out must be after clock-in.';
  if (v.date === today) {
    const [h, m] = v.clockOut.split(':').map(Number);
    if (h * 60 + m > minutesOfDay(now())) return "Clock-out can't be later than now.";
  }
  const [requests, leave] = await Promise.all([myRequests(api), api.get<LeaveRow[]>('/leave/requests/mine')]);
  if (requests.some((r) => r.kind === 'regularization' && r.status === 'pending' && r.startDate === v.date)) return `You already have a fix waiting for approval on ${formatDay(v.date)}.`;
  const off = leave.find((l) => active(l.status) && l.halfDay === null && l.startDate <= v.date && l.endDate >= v.date);
  if (off) return `You're on ${off.leaveTypeName ?? 'leave'} on ${formatDay(v.date)}, so there's nothing to fix.`;
  return null;
}

const formFix: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'request_fix', args: {}, form: true } };

const requestFix: AiTool<z.infer<typeof fixInput>> = {
  name: 'request_fix',
  label: 'Checking the day',
  kind: 'write',
  description: "Ask for a fix to a day's clock-in and clock-out times (a missed or wrong punch). The user confirms before it is sent to their admin.",
  input: fixInput,

  async prepare(args, api, ctx) {
    if (!ctx.fromButton && !ctx.form) {
      const elsewhere = otherTab(ctx.latestText, 'attendance');
      if (elsewhere) return { kind: 'ask', result: { text: elsewhere } };
      if (!ctx.rerouted && asksToCancel(ctx.latestText)) return { kind: 'reroute', tool: 'cancel_attendance_request', args: { which: ctx.latestText } };
    }
    const draft = ctx.draft?.tool === 'request_fix' ? ctx.draft.args : {};
    const kept: Times = { clockIn: str(draft.clockIn), clockOut: str(draft.clockOut) };
    const dateArg = str(args.date);
    const date = ctx.fromButton
      ? (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : (str(draft.date) ?? null))
      : (dayRangeOf(withoutTimes(ctx.latestText), ctx.today, 'past')?.from ?? (dateArg && grounded(dateArg, ctx.latestText) ? dayOf(dateArg, ctx.today, 'past') : null) ?? str(draft.date) ?? null);
    const { clockIn, clockOut } = readTimes(args, ctx, kept);
    const reason = ctx.fromButton ? (str(args.reason) ?? str(draft.reason) ?? '') : fixReason(ctx.latestText, args.reason) || (str(draft.reason) ?? '');
    const missing = [...(date ? [] : ['date']), ...(clockIn ? [] : ['clockIn']), ...(clockOut ? [] : ['clockOut'])];
    const values: FixFormValues = { date: date ?? '', clockIn: clockIn ?? '', clockOut: clockOut ?? '', reason };
    const form = { kind: 'fix' as const, mode: 'create' as const, values };
    if (missing.length) {
      if (ctx.form) return { kind: 'card', card: { title: 'Request an attendance fix', tone: 'default', rows: [{ label: 'Date', value: date ? formatDay(date) : '—' }], confirmLabel: 'Send request', form, incomplete: true }, calls: [] };
      const asked = missing.includes('date')
        ? `Which day do you want to fix${clockIn || clockOut ? '' : ', and what were your clock-in and clock-out times'}?`
        : missing.length === 2
          ? `What were your clock-in and clock-out times on ${formatDay(date!)}?`
          : `What time did you ${missing[0] === 'clockIn' ? 'clock in' : 'clock out'} on ${formatDay(date!)}?`;
      return {
        kind: 'ask',
        result: { text: asked, buttons: [formFix] },
        draft: { tool: 'request_fix', args: Object.fromEntries(Object.entries({ date, clockIn, clockOut, reason }).filter(([, v]) => v)), missing, notSaved: [] },
      };
    }
    const problem = await fixProblem(api, { date: date!, clockIn: clockIn!, clockOut: clockOut! }, ctx.today);
    if (problem) return { kind: 'ask', result: { text: problem, buttons: [formFix] } };
    return {
      kind: 'card',
      card: {
        title: 'Request an attendance fix',
        tone: 'default',
        rows: [
          { label: 'Date', value: formatDay(date!) },
          { label: 'Clock in', value: hmText(clockIn!) },
          { label: 'Clock out', value: hmText(clockOut!) },
          { label: 'Reason', value: reason || '—' },
        ],
        confirmLabel: 'Send request',
        form,
      },
      calls: [{ method: 'POST', path: '/attendance/requests', body: fixBody(values) }],
    };
  },

  async fillFromReply(draft, reply, _api, ctx) {
    if (draft.tool !== 'request_fix') return null;
    const out: Record<string, unknown> = { ...draft.args };
    if (draft.missing.includes('date')) {
      const day = dayRangeOf(withoutTimes(reply), ctx.today, 'past')?.from;
      if (day) out.date = day;
    }
    const times = readTimes({}, { ...ctx, latestText: reply, fromButton: false }, { clockIn: str(draft.args.clockIn), clockOut: str(draft.args.clockOut) });
    if (times.clockIn) out.clockIn = times.clockIn;
    if (times.clockOut) out.clockOut = times.clockOut;
    // Nothing new: leave it to the model.
    return (['date', 'clockIn', 'clockOut'] as const).some((k) => out[k] !== draft.args[k]) ? out : null;
  },

  async revise(_pending, values) {
    const parsed = fixValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/attendance/requests', body: fixBody(parsed.data) }];
  },

  done([result]) {
    const r = result as RequestRow;
    return { text: `✅ **Fix requested** for ${formatDay(r.startDate)}: ${r.clockIn}–${r.clockOut}. Status: pending.` };
  },
};

/** "Fix yesterday from 9:30 to 6:30": the times taken out, so "from 9:30 to 6:30" isn't read as dates. */
function withoutTimes(message: string): string {
  return message
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)/gi, ' ')
    .replace(/(?:\b(?:from|between)\s+)?\b\d{1,2}\s*(?:to|and|till|until|-|–)\s*\d{1,2}\b(?!\s*(?:st|nd|rd|th|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/gi, ' ')
    .replace(/\b(?:clock(?:ed)?\s*-?\s*(?:in|out)|came|left|in at|out at)\s*(?:at)?\s*\d{1,2}\b/gi, ' ');
}

// ---------------------------------------------------------------- cancel_attendance_request

const cancelInput = z.object({ which: text("Which request, in the user's words (work from home or a fix, and its date)") });

const cancelButton = (r: RequestRow): AiButton => ({ label: `Cancel ${KIND_LABELS[r.kind].toLowerCase()} · ${requestDates(r)}`, toolCall: { name: 'cancel_attendance_request', args: { which: r.id } } });

const cancelRequest: AiTool<z.infer<typeof cancelInput>> = {
  name: 'cancel_attendance_request',
  label: 'Finding the request',
  kind: 'write',
  description: "Cancel one of the user's own work-from-home or fix requests. The user must confirm.",
  input: cancelInput,

  async prepare(args, api, ctx) {
    if (!ctx.fromButton && !ctx.rerouted && !asksToCancel(ctx.latestText)) {
      return { kind: 'reroute', tool: /\b(?:fix|clock|regulari)/i.test(ctx.latestText) ? 'request_fix' : 'request_wfh', args: {} };
    }
    const rows = (await myRequests(api)).filter((r) => r.canCancel);
    if (!rows.length) return { kind: 'ask', result: { text: 'You have no requests that can be cancelled.' } };
    const words = ctx.fromButton ? (str(args.which) ?? '') : ctx.latestText;
    let found = rows.filter((r) => r.id === words);
    if (!found.length) {
      const t = norm(words);
      const kind = /\b(?:wfh|work from home|remote)\b/.test(t) ? 'wfh' : /\b(?:fix|regulari[sz]\w*|clock)\b/.test(t) ? 'regularization' : undefined;
      const range = dayRangeOf(words, ctx.today, 'recent');
      found = rows.filter((r) => (!kind || r.kind === kind) && (!range || (r.startDate <= range.to && r.endDate >= range.from)));
    }
    if (!found.length) return { kind: 'ask', result: { text: "I couldn't find a request like that you can cancel.", buttons: rows.slice(0, 4).map(cancelButton) } };
    if (found.length > 1) return { kind: 'ask', result: { text: 'Which request do you want to cancel?', buttons: found.slice(0, 6).map(cancelButton) } };
    const r = found[0];
    return {
      kind: 'card',
      card: {
        title: `Cancel this ${KIND_LABELS[r.kind].toLowerCase()} request?`,
        tone: 'danger',
        rows: [
          { label: 'Dates', value: requestDates(r) },
          { label: 'Status', value: STATUS_LABELS[r.status] },
          { label: 'Reason', value: r.reason || '—' },
        ],
        confirmLabel: 'Cancel request',
      },
      calls: [{ method: 'POST', path: `/attendance/requests/${r.id}/cancel` }],
      meta: { what: `${KIND_LABELS[r.kind].toLowerCase()} request for ${requestDates(r)}` },
    };
  },

  done(_results, pending) {
    return { text: `✅ Your ${String(pending.meta.what)} was cancelled.` };
  },
};

// ---------------------------------------------------------------- module

export const attendanceModule: AiModule = {
  key: 'attendance',
  title: 'Attendance assistant',
  intro: () => 'Ask to work from home, ask for a fix to a day, see your month, or cancel a request, by typing or speaking. Nothing is sent until you Confirm.',
  starters: [
    { label: 'Request WFH', toolCall: { name: 'request_wfh', args: {}, form: true } },
    { label: 'Request a fix', toolCall: { name: 'request_fix', args: {}, form: true } },
    { label: 'My month', toolCall: { name: 'my_attendance', args: {} } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'attendance')}
You are the Attendance assistant on the user's own Attendance tab. You help them ask to work from home, ask for a fix to a day's clock-in and clock-out times, see their month, and cancel a request.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Work from home: call request_wfh with the dates exactly as the user said them.
- A fix (wrong or missing clock-in or clock-out on a day): call request_fix with the date, the clock-in time and the clock-out time exactly as the user said them.
- A reason is optional. Never ask for one, and never make one up.
- If the user didn't say the date or a time, ask for it. Never guess.
- Clocking in or out for today is done with the buttons on the Home page, not here.
- Never say that a request was sent or cancelled. The app shows that after the backend confirms it.`,
  tools: [myAttendance, listRequests, requestWfh, requestFix, cancelRequest],
  elsewhere: (message) => otherTab(message, 'attendance'),
};
