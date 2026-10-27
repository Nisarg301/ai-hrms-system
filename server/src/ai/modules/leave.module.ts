import { z } from 'zod';
import { basePrompt } from '../prompts/base.prompt';
import { dayRangeOf, DayRange, formatDay } from '../dates';
import { grounded, isBlank, matchByName, norm, orList, str } from '../text';
import { AiButton, AiModule, AiTool, AiUserError, ApiClient, LeaveFormValues, LeaveTypeOption, ToolContext } from '../types';
import { apiMessage, asksToCancel, daysText, otherTab, rangeText, reasonFrom, refusal } from './me.helpers';

// The Leave assistant on the Me page's Leave tab (docs/AI_ME_ASSISTANTS.md, section 3). The user's
// own leave only, through /leave/balances, /leave/preview and /leave/requests with their token.

interface Balance {
  leaveTypeId: string;
  name: string;
  code: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  yearlyQuota: number | null;
  approved: number;
  pending: number;
  /** null = unlimited. */
  available: number | null;
}

interface LeaveRow {
  id: string;
  leaveTypeName: string | null;
  startDate: string;
  endDate: string;
  halfDay: 'first' | 'second' | null;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  canCancel: boolean;
}

type HalfDay = 'first' | 'second' | null;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

const STATUS_LABELS: Record<LeaveRow['status'], string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

// Words that belong to the dates, the type or the half day, and never make a reason.
const NOT_REASON = /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|today|next|week|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*|\d+(?:st|nd|rd|th)?|paid|unpaid|half|morning|afternoon|leave|apply)\b/g;

// ---------------------------------------------------------------- reading the request

/** "half day", "first half", "morning" → first; "second half", "afternoon", "after lunch" → second. Null for a full day. */
export function halfDayIn(message: string): HalfDay {
  const t = norm(message);
  if (/\b(?:second half|2nd half|afternoon|after ?lunch|post ?lunch|evening)\b/.test(t)) return 'second';
  if (/\b(?:half ?day|half|first half|1st half|morning|pre ?lunch|before lunch)\b/.test(t)) return 'first';
  return null;
}

/** The type the words name: "unpaid", "LWP" → the unpaid type; "paid", "PL" → the paid one; or any type's name or code. */
export function typeIn(message: string, types: Balance[]): Balance | 'unknown' | null {
  const t = ` ${norm(message)} `;
  const byCode = types.find((b) => t.includes(` ${b.code.toLowerCase()} `));
  if (byCode) return byCode;
  const named = types.filter((b) => t.includes(` ${norm(b.name)} `) || t.includes(` ${norm(b.name.replace(/\s+leave$/i, ''))} leave `));
  if (named.length === 1) return named[0];
  if (/\b(?:unpaid|without pay|lwp|loss of pay|lop|no pay)\b/.test(t)) return types.find((b) => !b.isPaid) ?? 'unknown';
  if (/\bpaid\b/.test(t)) return paidType(types) ?? 'unknown';
  return null;
}

/** Paid Leave: the paid type coded PL, or else the only paid type with a yearly quota. */
function paidType(types: Balance[]): Balance | undefined {
  const quota = types.filter((b) => b.isPaid && b.yearlyQuota !== null);
  return types.find((b) => b.isPaid && b.code.toUpperCase() === 'PL') ?? (quota.length === 1 ? quota[0] : undefined);
}

/** Unpaid Leave: the unpaid type coded UL, or else the first unpaid type. */
const unpaidType = (types: Balance[]) => types.find((b) => !b.isPaid && b.code.toUpperCase() === 'UL') ?? types.find((b) => !b.isPaid);

const typeOptions = (types: Balance[]): LeaveTypeOption[] => types.map((b) => ({ id: b.leaveTypeId, name: b.name, isPaid: b.isPaid, allowHalfDay: b.allowHalfDay, available: b.available }));

const availableText = (b: Balance) => (b.available === null ? 'unlimited' : `${b.available} left`);

// ---------------------------------------------------------------- reads

const balanceInput = z.object({ type: text("A leave type, only if the user named one") });

const leaveBalance: AiTool<z.infer<typeof balanceInput>> = {
  name: 'leave_balance',
  label: 'Looking up your balance',
  kind: 'read',
  description: "Show the user's own leave balance for this year: each type's quota, days taken, pending and left.",
  input: balanceInput,
  async run(args, api, ctx) {
    const types = await api.get<Balance[]>('/leave/balances');
    const named = typeIn(ctx.fromButton ? (str(args.type) ?? '') : ctx.latestText, types);
    if (named && named !== 'unknown') {
      const b = named;
      return { text: `**${b.name}**: ${b.available === null ? 'unlimited' : `**${b.available}** of ${b.yearlyQuota} days left`} this year · ${b.approved} taken · ${b.pending} pending.` };
    }
    if (!types.length) return { text: 'There are no leave types yet. Ask your admin.' };
    return {
      text: `Your leave this year:`,
      table: {
        columns: [
          { key: 'type', title: 'Type' },
          { key: 'quota', title: 'Yearly quota' },
          { key: 'taken', title: 'Taken' },
          { key: 'pending', title: 'Pending' },
          { key: 'available', title: 'Left' },
        ],
        rows: types.map((b) => ({
          type: b.name,
          quota: b.yearlyQuota === null ? 'Unlimited' : String(b.yearlyQuota),
          taken: String(b.approved),
          pending: String(b.pending),
          available: b.available === null ? 'Unlimited' : String(b.available),
        })),
      },
      buttons: [{ label: 'Apply for leave', toolCall: { name: 'apply_leave', args: {}, form: true } }],
    };
  },
};

const listInput = z.object({ status: text('"pending", "approved", "rejected" or "cancelled", only if the user said one') });

const listMyLeave: AiTool<z.infer<typeof listInput>> = {
  name: 'list_my_leave',
  label: 'Looking up your requests',
  kind: 'read',
  description: "List the user's own leave requests with their status.",
  input: listInput,
  async run(args, api, ctx) {
    const rows = await api.get<LeaveRow[]>('/leave/requests/mine');
    const said = (ctx.fromButton ? (str(args.status) ?? '') : norm(ctx.latestText)).match(/\b(pending|approved|rejected|cancelled|canceled)\b/)?.[1]?.replace('canceled', 'cancelled') as LeaveRow['status'] | undefined;
    const shown = said ? rows.filter((r) => r.status === said) : rows;
    if (!shown.length) return { text: said ? `You have no ${said} leave requests.` : 'You have no leave requests yet.' };
    return {
      text: `**${shown.length} ${said ? `${said} ` : ''}leave request${shown.length === 1 ? '' : 's'}**.`,
      table: {
        columns: [
          { key: 'type', title: 'Type' },
          { key: 'dates', title: 'Dates' },
          { key: 'days', title: 'Days' },
          { key: 'status', title: 'Status' },
          { key: 'reason', title: 'Reason' },
        ],
        rows: shown.slice(0, 20).map((r) => ({
          type: r.leaveTypeName ?? '—',
          dates: rangeText(r.startDate, r.endDate, r.halfDay),
          days: String(r.days),
          status: STATUS_LABELS[r.status],
          reason: r.reason || '—',
        })),
      },
      buttons: shown
        .filter((r) => r.canCancel)
        .slice(0, 4)
        .map((r) => ({ label: `Cancel ${rangeText(r.startDate, r.endDate, r.halfDay)}`, toolCall: { name: 'cancel_leave', args: { which: r.id } } })),
    };
  },
};

// ---------------------------------------------------------------- apply_leave

const applyInput = z.object({
  dates: text("The leave dates exactly as the user said them"),
  type: text('A leave type, only if the user named one'),
  halfDay: text('"half day", "first half" or "second half", only if the user said so'),
  reason: text("The reason in the user's words, only if they gave one"),
  // From a button, a draft or the card: what the server already worked out.
  startDate: text('Leave empty'),
  endDate: text('Leave empty'),
  leaveTypeId: text('Leave empty'),
});

/** The leave request's details: the server's own (button, draft) or read from the user's words. */
function readRequest(args: z.infer<typeof applyInput>, ctx: ToolContext, types: Balance[]) {
  const draft = ctx.draft?.tool === 'apply_leave' ? ctx.draft.args : {};
  if (ctx.fromButton) {
    const range = str(args.startDate) && str(args.endDate) ? { from: String(args.startDate), to: String(args.endDate) } : null;
    const type = types.find((b) => b.leaveTypeId === str(args.leaveTypeId)) ?? null;
    const half = (['first', 'second'] as const).find((h) => h === str(args.halfDay)) ?? null;
    return { range, type: type as Balance | 'unknown' | null, half: half as HalfDay, reason: str(args.reason) ?? '', typeWords: undefined as string | undefined };
  }
  const message = ctx.latestText;
  const said = dayRangeOf(message, ctx.today, 'future');
  const modelRange = !said && str(args.dates) && grounded(String(args.dates), message) ? dayRangeOf(String(args.dates), ctx.today, 'future') : null;
  const kept = str(draft.startDate) && str(draft.endDate) ? { from: String(draft.startDate), to: String(draft.endDate) } : null;
  const range: DayRange | null = said ?? modelRange ?? kept;
  // The type and half day count only when the message says them (the model adds them unasked).
  const typeWords = str(args.type) && grounded(String(args.type), message) ? String(args.type) : undefined;
  const fromMessage = typeIn(message, types);
  const type = fromMessage ?? (typeWords ? typeIn(typeWords, types) ?? matchType(types, typeWords) : null) ?? types.find((b) => b.leaveTypeId === str(draft.leaveTypeId)) ?? null;
  const half = halfDayIn(message) ?? ((['first', 'second'] as const).find((h) => h === str(draft.halfDay)) ?? null);
  const reason = reasonFrom(message, args.reason, NOT_REASON) || (str(draft.reason) ?? '');
  return { range, type, half, reason, typeWords };
}

function matchType(types: Balance[], words: string): Balance | 'unknown' {
  const match = matchByName(types, words.replace(/\bleave\b/i, '').trim() || words, (b) => b.name, (b) => b.leaveTypeId);
  return match.kind === 'one' ? match.item : 'unknown';
}

interface Preview {
  days: number;
  availableAfter: number | null;
}

async function preview(api: ApiClient, type: Balance, range: DayRange, half: HalfDay): Promise<Preview> {
  return api.get<Preview>('/leave/preview', { leaveTypeId: type.leaveTypeId, startDate: range.from, endDate: half ? range.from : range.to, halfDay: half ?? undefined });
}

const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'apply_leave', args: {}, form: true } };

const leaveValuesSchema = z.object({
  leaveTypeId: z.string().min(1, 'Choose a leave type'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the dates'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the dates'),
  halfDay: z.enum(['first', 'second']).nullable(),
  reason: z.string().trim().max(500, 'At most 500 characters'),
});

function leaveBody(v: LeaveFormValues) {
  return { leaveTypeId: v.leaveTypeId, startDate: v.startDate, endDate: v.halfDay ? v.startDate : v.endDate, halfDay: v.halfDay, reason: v.reason.trim() };
}

const applyLeave: AiTool<z.infer<typeof applyInput>> = {
  name: 'apply_leave',
  label: 'Checking your leave',
  kind: 'write',
  description: 'Apply for leave for the user. The user checks and confirms it before it is sent to their admin.',
  input: applyInput,

  async prepare(args, api, ctx) {
    if (!ctx.fromButton && !ctx.form) {
      const elsewhere = otherTab(ctx.latestText, 'leave');
      if (elsewhere) return { kind: 'ask', result: { text: elsewhere } };
      // "Cancel my leave on 5 Nov" came back as an application.
      if (!ctx.rerouted && asksToCancel(ctx.latestText)) return { kind: 'reroute', tool: 'cancel_leave', args: { which: ctx.latestText } };
    }
    const types = await api.get<Balance[]>('/leave/balances');
    if (!types.length) return { kind: 'ask', result: { text: 'There are no leave types yet. Ask your admin to add them.' } };
    const { range, type, half, reason, typeWords } = readRequest(args, ctx, types);
    const draftArgs = (r: DayRange | null) =>
      Object.fromEntries(
        Object.entries({
          startDate: r?.from,
          endDate: r?.to,
          leaveTypeId: type && type !== 'unknown' ? type.leaveTypeId : undefined,
          halfDay: half ?? undefined,
          reason: reason || undefined,
        }).filter(([, v]) => v)
      );

    if (type === 'unknown') {
      return { kind: 'ask', result: { text: `There's no leave type called "${typeWords ?? 'that'}". Types: ${orList(types.map((b) => b.name))}.` } };
    }
    if (!range && !ctx.form) {
      return {
        kind: 'ask',
        result: { text: `Which dates do you want ${half ? 'the half day' : 'leave'} for?`, buttons: [formButton] },
        draft: { tool: 'apply_leave', args: draftArgs(null), missing: ['dates'], notSaved: [] },
      };
    }
    const today = ctx.today;
    const values: LeaveFormValues = {
      leaveTypeId: (type ?? paidType(types) ?? unpaidType(types) ?? types[0]).leaveTypeId,
      startDate: range?.from ?? today,
      endDate: half ? (range?.from ?? today) : (range?.to ?? today),
      halfDay: half,
      reason,
    };
    const form = { kind: 'leave' as const, mode: 'create' as const, values, types: typeOptions(types) };
    if (!range) {
      return {
        kind: 'card',
        card: { title: 'Apply for leave', tone: 'default', rows: [{ label: 'Dates', value: '—' }], confirmLabel: 'Apply', form, incomplete: true },
        calls: [],
      };
    }
    if (half && range.from !== range.to) {
      return {
        kind: 'ask',
        result: { text: `A half day is one date. Which day: ${formatDay(range.from)}, or another?` },
        draft: { tool: 'apply_leave', args: { ...draftArgs(null), halfDay: half }, missing: ['dates'], notSaved: [] },
      };
    }

    // Section 3.2: a type named, else paid leave if its balance covers the days, else unpaid leave.
    const notes: string[] = [];
    let chosen: Balance;
    let result: Preview;
    try {
      if (type) {
        chosen = type;
        result = await preview(api, chosen, range, half);
      } else {
        const fits = (b: Balance | undefined) => (b && (!half || b.allowHalfDay) ? b : undefined);
        const paid = fits(paidType(types));
        const unpaid = fits(unpaidType(types));
        const first = paid ?? unpaid ?? fits(types.find((b) => b.allowHalfDay || !half));
        if (!first) return { kind: 'ask', result: { text: 'None of your leave types can be taken as a half day.' } };
        chosen = first;
        try {
          result = await preview(api, chosen, range, half);
        } catch (err) {
          // Not enough paid leave: unpaid leave, saying why.
          if (!(refusal(err) && /\bleft\b/i.test(apiMessage(err)) && paid && chosen === paid && unpaid)) throw err;
          result = await preview(api, unpaid, range, half);
          notes.push(`${paid.name} has ${daysText(Math.max(paid.available ?? 0, 0))} left and this needs ${daysText(result.days)}, so this is ${unpaid.name}. You can change the type.`);
          chosen = unpaid;
        }
      }
    } catch (err) {
      if (!refusal(err)) throw err;
      return { kind: 'ask', result: { text: apiMessage(err), buttons: [formButton] } };
    }
    values.leaveTypeId = chosen.leaveTypeId;
    return {
      kind: 'card',
      card: {
        title: 'Apply for leave',
        tone: 'default',
        rows: [
          { label: 'Type', value: chosen.name },
          { label: 'Dates', value: rangeText(values.startDate, values.endDate, half) },
          { label: 'Days', value: String(result.days) },
          { label: 'Left after this', value: result.availableAfter === null ? 'Unlimited' : String(result.availableAfter) },
          { label: 'Reason', value: reason || '—' },
        ],
        notes: notes.length ? notes : undefined,
        confirmLabel: 'Apply',
        form,
      },
      calls: [{ method: 'POST', path: '/leave/requests', body: leaveBody(values) }],
      meta: { typeName: chosen.name },
    };
  },

  async fillFromReply(draft, reply, _api, ctx) {
    if (draft.tool !== 'apply_leave' || !draft.missing.includes('dates')) return null;
    const range = dayRangeOf(reply, ctx.today, 'future');
    return range ? { ...draft.args, startDate: range.from, endDate: range.to } : null;
  },

  async revise(_pending, values) {
    const parsed = leaveValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    if (parsed.data.endDate < parsed.data.startDate) throw new AiUserError('The end date is before the start date.');
    return [{ method: 'POST', path: '/leave/requests', body: leaveBody(parsed.data) }];
  },

  done([result]) {
    const r = result as LeaveRow;
    return { text: `✅ **Leave applied:** ${r.leaveTypeName ?? 'Leave'}, ${rangeText(r.startDate, r.endDate, r.halfDay)} (${daysText(r.days)}). Status: pending. Your admin has been notified.` };
  },
};

// ---------------------------------------------------------------- cancel_leave

const cancelInput = z.object({ which: text("Which request, in the user's words (its dates or type)") });

/** The cancellable requests the words point to: by id (a button), by a date they cover, by type, or the only one. */
function pickRequests(rows: LeaveRow[], words: string, today: string): LeaveRow[] {
  const open = rows.filter((r) => r.canCancel);
  const byId = open.find((r) => r.id === words);
  if (byId) return [byId];
  const range = dayRangeOf(words, today, 'future');
  if (range) {
    const hit = open.filter((r) => r.startDate <= range.to && r.endDate >= range.from);
    if (hit.length) return hit;
  }
  const t = norm(words);
  const byType = open.filter((r) => r.leaveTypeName && t.includes(norm(r.leaveTypeName)));
  if (byType.length) return byType;
  if (/\b(?:latest|last|recent|newest)\b/.test(t)) return open.slice(0, 1);
  return range ? [] : open;
}

const cancelLeave: AiTool<z.infer<typeof cancelInput>> = {
  name: 'cancel_leave',
  label: 'Finding the request',
  kind: 'write',
  description: "Cancel one of the user's own leave requests (pending, or approved and not started yet). The user must confirm.",
  input: cancelInput,

  async prepare(args, api, ctx) {
    // "Apply leave on 5 Nov" once came back as a cancel: with no word for cancelling, it's an application.
    if (!ctx.fromButton && !ctx.rerouted && !asksToCancel(ctx.latestText)) return { kind: 'reroute', tool: 'apply_leave', args: { dates: args.which } };
    const rows = await api.get<LeaveRow[]>('/leave/requests/mine');
    const words = ctx.fromButton ? (str(args.which) ?? '') : ctx.latestText;
    const found = pickRequests(rows, words, ctx.today);
    if (!rows.some((r) => r.canCancel)) return { kind: 'ask', result: { text: 'You have no leave requests that can be cancelled. Leave that has started, or was decided against, stays as it is.' } };
    if (!found.length) return { kind: 'ask', result: { text: "I couldn't find a request like that you can cancel.", buttons: rows.filter((r) => r.canCancel).slice(0, 4).map((r) => cancelButton(r)) } };
    if (found.length > 1) return { kind: 'ask', result: { text: 'Which request do you want to cancel?', buttons: found.slice(0, 6).map((r) => cancelButton(r)) } };
    const r = found[0];
    return {
      kind: 'card',
      card: {
        title: `Cancel ${r.leaveTypeName ?? 'leave'}?`,
        tone: 'danger',
        rows: [
          { label: 'Dates', value: rangeText(r.startDate, r.endDate, r.halfDay) },
          { label: 'Days', value: String(r.days) },
          { label: 'Status', value: STATUS_LABELS[r.status] },
        ],
        notes: r.status === 'approved' ? ['It was approved: your admin is told it was cancelled.'] : undefined,
        confirmLabel: 'Cancel request',
      },
      calls: [{ method: 'POST', path: `/leave/requests/${r.id}/cancel` }],
      meta: { dates: rangeText(r.startDate, r.endDate, r.halfDay) },
    };
  },

  done(_results, pending) {
    return { text: `✅ Your leave on ${String(pending.meta.dates)} was cancelled.` };
  },
};

const cancelButton = (r: LeaveRow): AiButton => ({ label: `${r.leaveTypeName ?? 'Leave'} · ${rangeText(r.startDate, r.endDate, r.halfDay)} · ${STATUS_LABELS[r.status]}`, toolCall: { name: 'cancel_leave', args: { which: r.id } } });

// ---------------------------------------------------------------- module

export const leaveModule: AiModule = {
  key: 'leave',
  title: 'Leave assistant',
  intro: () => 'Apply for leave, see your balance and requests, or cancel one, by typing or speaking. Nothing is sent until you Confirm.',
  starters: [
    { label: 'Apply for leave', toolCall: { name: 'apply_leave', args: {}, form: true } },
    { label: 'My balance', toolCall: { name: 'leave_balance', args: {} } },
    { label: 'My requests', toolCall: { name: 'list_my_leave', args: {} } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'leave')}
You are the Leave assistant on the user's own Leave tab. You help them apply for leave, see their balance and their requests, and cancel a request.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- To apply for leave, call apply_leave. Copy the dates, the leave type, "half day" and the reason exactly as the user said them.
- Leave the type empty unless the user named one. The server picks paid or unpaid leave.
- Leave halfDay empty unless the user said half day, first half, second half, morning or afternoon.
- A reason is optional. Never ask for one, and never make one up.
- If the user didn't say any date, ask which dates. Never guess dates.
- To cancel a request, call cancel_leave with the user's words for which one.
- Never say that leave was applied or cancelled. The app shows that after the backend confirms it.`,
  tools: [leaveBalance, listMyLeave, applyLeave, cancelLeave],
  elsewhere: (message) => otherTab(message, 'leave'),
};
