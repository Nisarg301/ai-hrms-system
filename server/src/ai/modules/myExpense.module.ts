import { z } from 'zod';
import { addDays } from '../../utils/dates';
import { basePrompt } from '../prompts/base.prompt';
import { dayOf, dayRangeOf, formatDay } from '../dates';
import { andList, grounded, heardText, isBlank, Match, matchByName, mentions, norm, str } from '../text';
import { AiButton, AiModule, AiResult, AiTool, AiUserError, ApiCall, ApiClient, ClaimCategoryOption, ClaimFormValues, ConfirmCard, PendingActionView, ToolContext } from '../types';
import { amountFrom, inr, MAX_RUPEES, toPaise } from './expense.helpers';
import { otherTab } from './me.helpers';

// The Expenses assistant on the Me page's Expenses tab (docs/AI_ME_ASSISTANTS.md, section 5): the
// user's own claims. A new claim's card makes the claim, adds its first expense, attaches the
// receipt and submits it, all on one Confirm (calls chained with {0.id}, ApiCall.path).

type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';

interface MyClaim {
  id: string;
  number: string | null;
  title: string;
  status: ClaimStatus;
  totalPaise: number;
  itemCount: number;
}

interface ClaimItem {
  id: string;
  date: string;
  categoryName: string | null;
  amountPaise: number;
  merchant: string;
  receipts: unknown[];
  missingReceipt: boolean;
}

interface ClaimDetail extends MyClaim {
  items: ClaimItem[];
}

interface Category extends ClaimCategoryOption {
  isActive: boolean;
}

const MAX_AGE_DAYS = 90;
const STATUS_LABELS: Record<ClaimStatus, string> = { draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved – to be paid', rejected: 'Rejected', paid: 'Paid' };

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

// ---------------------------------------------------------------- reading an expense

/** "Add a new claim, client visit to Pune", "New claim for the September internet bill, ₹1,299 …" → the title. */
export function claimTitleFrom(message: string): string | undefined {
  const m = /\b(?:claim|reimbursement)\b[\s,:–-]*(?:for|called|named|titled|of)?\s*(?:the|my|a|an)?\s*([^,.;₹\n]+?)(?=\s*(?:[,.;₹]|\s(?:on|dated|amount|at|from|paid|worth|rs\.?|inr|for rs)\b|$))/i.exec(message);
  const title = m?.[1].trim();
  return title && isTitle(title) && !/\d{2,}/.test(title) ? title.slice(0, 120) : undefined;
}

/** A title says what the claim is for: "New claim" or "an expense claim" doesn't (the model once sent it as one). */
export const isTitle = (title: string) => norm(title).split(' ').some((w) => w.length >= 3 && !/^(?:new|claim|claims|expense|expenses|add|create|start|apply|for|the|and|reimbursement)$/.test(w));

/** "₹850", "850 rupees", "Rs 1,299.50", "1.2k": marked amounts first; then a bare number that isn't part of a date. */
export function amountIn(message: string): number | null {
  const marked = /(?:₹|\brs\.?|\binr)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b|thousand\b|lakhs?\b)?|(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b|thousand\b|lakhs?\b)?\s*(?:rupees|rupaye|rs\b|\/-)/i.exec(message);
  if (marked) return amountFrom(marked[0].replace(/rupees|rupaye|\/-/gi, ''));
  return amountFrom(withoutDates(message));
}

/** The date's own numbers taken out, so "15 Oct" isn't ₹15. */
export function withoutDates(message: string): string {
  return message
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?/gi, ' ')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s+\d{4})?/gi, ' ')
    .replace(/\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/gi, ' ');
}

/** "at Airtel", "from Amazon", "paid to Ola", "merchant: Uber". */
export function merchantIn(message: string): string | undefined {
  return /\b(?:at|from|paid to|merchant\s*:?|vendor\s*:?|via|with)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,2})/.exec(message)?.[1];
}

// Words that point to a category when none is named: the category whose name holds the key.
const CATEGORY_HINTS: [string, RegExp][] = [
  ['travel', /\b(?:travel|cab|taxi|uber|ola|rapido|auto|flight|train|bus|metro|fuel|petrol|diesel|toll|parking|airport)\b/],
  ['food', /\b(?:food|meals?|lunch|dinner|breakfast|snacks?|coffee|tea|restaurant|swiggy|zomato)\b/],
  ['accommodation', /\b(?:hotel|stay|accommodation|lodging|airbnb|oyo)\b/],
  ['internet', /\b(?:internet|broadband|wi ?fi|phone|mobile|airtel|jio|data pack|recharge)\b/],
  ['office', /\b(?:stationery|office supplies|printer|paper|supplies)\b/],
];

const categoryKey = (name: string) => name.replace(/&/g, ' and ');

/** The category the words name, by name, or else hinted at ("cab" → Travel). Undefined when none or unclear. */
export function categoryIn(message: string, categories: Category[]): Category | undefined {
  const t = ` ${norm(message)} `;
  const named = categories.filter((c) => [c.name, categoryKey(c.name), c.name.split(/\s*&\s*|\s+/)[0]].some((n) => t.includes(` ${norm(n)} `)));
  if (named.length === 1) return named[0];
  const hinted = new Set(CATEGORY_HINTS.filter(([, words]) => words.test(t)).flatMap(([key]) => categories.filter((c) => norm(c.name).includes(key))));
  return hinted.size === 1 ? [...hinted][0] : undefined;
}

function findCategory(categories: Category[], words: string): Category | undefined {
  const exact = matchByName(categories, words, (c) => c.name, (c) => c.id);
  const match = exact.kind === 'none' ? matchByName(categories, words, (c) => categoryKey(c.name), (c) => c.id) : exact;
  return match.kind === 'one' ? match.item : categoryIn(words, categories);
}

/** "save it as a draft", "don't submit yet", "I have more to add": Submit now off. */
export const asksForDraft = (message: string) => /\b(?:draft|don ?t submit|do not submit|not submit|submit later|more to add|add more|another expense later|hold it)\b/.test(norm(message));

interface Expense {
  date?: string;
  categoryId?: string;
  amount?: number;
  merchant?: string;
  note?: string;
}

/**
 * The expense's details, from the user's words without the claim's title (which can hold a month
 * or a place: "September internet bill", "client visit to Pune"). The model's copies count only
 * when the message holds them. A button or a reply the server read passes its own.
 */
function readExpense(args: Record<string, unknown>, ctx: ToolContext, categories: Category[], title: string | undefined): Expense {
  if (ctx.fromButton) return savedExpense(args, categories);
  const message = ctx.latestText;
  const rest = title ? message.replace(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ') : message;
  const out: Expense = {};
  const date = dayRangeOf(rest, ctx.today, 'past')?.from ?? (str(args.date) && grounded(String(args.date), message) ? dayOf(String(args.date), ctx.today, 'past') : null);
  if (date) out.date = date;
  const amount = amountIn(rest) ?? (str(args.amount) && amountFrom(String(args.amount)) !== null && rest.replace(/,/g, '').includes(String(amountFrom(String(args.amount)))) ? amountFrom(String(args.amount)) : null);
  if (amount !== null) out.amount = amount;
  const named = str(args.category) && grounded(String(args.category), message) ? findCategory(categories, String(args.category)) : undefined;
  const category = named ?? categoryIn(rest, categories) ?? (title ? categoryIn(title, categories) : undefined);
  if (category) out.categoryId = category.id;
  const merchant = str(args.merchant) && mentions(message, String(args.merchant)) && !categories.some((c) => norm(c.name) === norm(String(args.merchant))) ? String(args.merchant) : merchantIn(rest);
  if (merchant) out.merchant = merchant.slice(0, 120);
  const note = str(args.note);
  if (note && heardText(note, message) && !(title && norm(title).includes(norm(note))) && norm(note) !== norm(out.merchant ?? '')) out.note = note.slice(0, 500);
  return out;
}

const FIELD_LABELS: Record<string, string> = { date: 'the **date**', categoryId: 'the **category**', amount: 'the **amount**', merchant: 'the **merchant**' };
const REQUIRED = ['date', 'categoryId', 'amount', 'merchant'] as const;

/** A date the API would refuse, in its own words. */
function dateProblem(date: string, today: string): string | null {
  if (date > today) return "An expense can't be dated in the future.";
  if (date < addDays(today, -MAX_AGE_DAYS)) return `Expenses can be claimed up to ${MAX_AGE_DAYS} days after they happen.`;
  return null;
}

const needsReceipt = (amountRupees: number | null, c: ClaimCategoryOption | undefined) => Boolean(c && amountRupees !== null && toPaise(amountRupees) > c.receiptRequiredAbovePaise);
const receiptRule = (c: ClaimCategoryOption) => (c.receiptRequiredAbovePaise === 0 ? `${c.name} always needs a receipt.` : `${c.name} needs a receipt above ${inr(c.receiptRequiredAbovePaise)}.`);

// ---------------------------------------------------------------- the claim card

const claimValuesSchema = z.object({
  title: z.string().trim().max(120, 'At most 120 characters'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date'),
  categoryId: z.string().min(1, 'Choose a category'),
  amountRupees: z.number({ message: 'Enter the amount' }).gt(0, 'Enter the amount').max(MAX_RUPEES, 'At most ₹10,00,000 per expense'),
  merchant: z.string().trim().min(1, 'Say where you spent it').max(120, 'At most 120 characters'),
  note: z.string().trim().max(500, 'At most 500 characters'),
  submitNow: z.boolean(),
});

const itemBody = (v: ClaimFormValues) => ({ date: v.date, categoryId: v.categoryId, amountPaise: toPaise(v.amountRupees ?? 0), merchant: v.merchant.trim(), note: v.note.trim() });

/**
 * The calls for one expense: on a new claim (`claimId` null) the claim comes first and the rest
 * use its id; then the expense, the receipt (skipped when optional and none was chosen) and the submit.
 */
function expenseCalls(v: ClaimFormValues, claimId: string | null, receiptRequired: boolean): ApiCall[] {
  const claim = claimId ?? '{0.id}';
  const itemIndex = claimId ? 0 : 1;
  return [
    ...(claimId ? [] : [{ method: 'POST' as const, path: '/expenses', body: { title: v.title.trim() } }]),
    { method: 'POST', path: `/expenses/${claim}/items`, body: itemBody(v) },
    { method: 'POST', path: `/expenses/${claim}/items/{${itemIndex}.items.newest.id}/receipts`, body: {}, attachFile: true, skipWithoutFile: !receiptRequired },
    ...(v.submitNow ? [{ method: 'POST' as const, path: `/expenses/${claim}/submit` }] : []),
  ];
}

function claimCard(title: string, v: ClaimFormValues, categories: Category[], mode: 'create' | 'update'): ConfirmCard {
  const category = categories.find((c) => c.id === v.categoryId);
  const required = needsReceipt(v.amountRupees, category);
  const warnings = category && category.limitPaise !== null && v.amountRupees !== null && toPaise(v.amountRupees) > category.limitPaise ? [`Over the ${inr(category.limitPaise)} limit for ${category.name}: allowed, but your admin sees it flagged.`] : [];
  const valid = claimValuesSchema.safeParse(v).success && (mode === 'update' || v.title.trim().length > 0);
  return {
    title,
    tone: 'default',
    rows: [
      ...(mode === 'create' ? [{ label: 'Claim', value: v.title || '—' }] : []),
      { label: 'Date', value: v.date ? formatDay(v.date) : '—' },
      { label: 'Category', value: category?.name ?? '—' },
      { label: 'Amount', value: v.amountRupees !== null ? inr(toPaise(v.amountRupees)) : '—' },
      { label: 'Merchant', value: v.merchant || '—' },
      { label: 'Note', value: v.note || '—' },
    ],
    warnings: warnings.length ? warnings : undefined,
    notes: [category ? (required ? receiptRule(category) : 'A receipt is optional for this amount.') : null, v.submitNow ? 'Confirm sends it to your admin for approval.' : 'It stays a draft until you submit it.'].filter((n): n is string => Boolean(n)),
    confirmLabel: v.submitNow ? 'Submit claim' : mode === 'create' ? 'Save as draft' : 'Save expense',
    form: { kind: 'claim', mode, values: v, categories: categories.map(({ id, name, limitPaise, receiptRequiredAbovePaise }) => ({ id, name, limitPaise, receiptRequiredAbovePaise })) },
    incomplete: !valid,
    file: { required, kind: 'receipt' },
  };
}

/** The values the card's form sends back, checked with the page's rules (and the receipt now needed). */
async function reviseClaim(pending: PendingActionView, values: unknown, api: ApiClient, today: string, hasFile: boolean): Promise<ApiCall[]> {
  const parsed = claimValuesSchema.safeParse(values);
  if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
  const v = parsed.data;
  const claimId = typeof pending.meta.claimId === 'string' ? pending.meta.claimId : null;
  if (!claimId && !v.title) throw new AiUserError('Give the claim a title.');
  const problem = dateProblem(v.date, today);
  if (problem) throw new AiUserError(problem);
  const categories = await api.get<Category[]>('/expense-categories');
  const category = categories.find((c) => c.id === v.categoryId);
  if (!category) throw new AiUserError('Choose one of the categories in use.');
  const required = needsReceipt(v.amountRupees, category);
  if (required && !hasFile) throw new AiUserError(`${receiptRule(category)} Choose the receipt file.`);
  return expenseCalls(v, claimId, required);
}

/** The reply when the claim was made but a later step failed: the card closes, so Confirm can't make it twice. */
function partialReply(results: unknown[], error: string, pending: PendingActionView): AiResult {
  const failed = pending.calls[results.length]?.path ?? '';
  const step = failed.endsWith('/receipts') ? 'the receipt couldn\'t be attached' : failed.endsWith('/submit') ? "it couldn't be submitted" : "the expense couldn't be added";
  const title = String(pending.meta.title ?? (results[0] as { title?: string } | undefined)?.title ?? 'The claim');
  return { text: `The claim **${title}** was saved as a draft, but ${step}: ${error} Finish it on the Expenses tab, or ask me again.`, warnings: [error] };
}

function claimDone(results: unknown[], pending: PendingActionView): AiResult {
  const last = [...results].reverse().find((r) => r && typeof r === 'object') as ClaimDetail | undefined;
  if (!last) return { text: '✅ Done.' };
  const submitted = last.status === 'submitted';
  return {
    text: submitted
      ? `✅ **Claim submitted:** ${last.title}${last.number ? ` · ${last.number}` : ''} · ${inr(last.totalPaise)}. Your admin has been notified.`
      : `✅ **${pending.meta.claimId ? 'Expense added' : 'Saved as a draft'}:** ${last.title} · ${last.itemCount} expense${last.itemCount === 1 ? '' : 's'} · ${inr(last.totalPaise)}. Say "submit my ${last.title} claim" when it's ready.`,
  };
}

// ---------------------------------------------------------------- finding claims

async function findDraft(api: ApiClient, words: string | undefined): Promise<{ match: Match<MyClaim>; drafts: MyClaim[] }> {
  const drafts = await api.get<MyClaim[]>('/expenses/mine', { status: 'draft' });
  if (!words) return { match: drafts.length === 1 ? { kind: 'one', item: drafts[0] } : drafts.length ? { kind: 'many', items: drafts } : { kind: 'none' }, drafts };
  const query = words.replace(/\b(?:my|the|claim|expense|draft)\b/gi, ' ').replace(/\s+/g, ' ').trim() || words;
  return { match: matchByName(drafts, query, (c) => c.title, (c) => c.id), drafts };
}

const draftButtons = (drafts: MyClaim[], tool: string, extra: Record<string, unknown> = {}): AiButton[] =>
  drafts.slice(0, 6).map((c) => ({ label: `${c.title} · ${c.itemCount} expense${c.itemCount === 1 ? '' : 's'} · ${inr(c.totalPaise)}`, toolCall: { name: tool, args: { ...extra, claim: c.id } } }));

// ---------------------------------------------------------------- list_my_claims

const listInput = z.object({ status: text('"draft", "submitted", "approved", "rejected" or "paid", only if the user said one') });

const STATUS_WORDS: [ClaimStatus, RegExp][] = [
  ['draft', /\bdrafts?\b|\bnot submitted\b/],
  ['approved', /\bapproved\b|\bto be paid\b/],
  ['rejected', /\brejected\b|\bdeclined\b/],
  ['submitted', /\bsubmitted\b|\bpending\b|\bwaiting\b/],
  ['paid', /\bpaid\b|\breimbursed\b/],
];

const listMyClaims: AiTool<z.infer<typeof listInput>> = {
  name: 'list_my_claims',
  label: 'Looking up your claims',
  kind: 'read',
  description: "List the user's own expense claims with their totals and status.",
  input: listInput,
  async run(args, api, ctx) {
    const t = norm(ctx.fromButton ? (str(args.status) ?? '') : ctx.latestText);
    const status = STATUS_WORDS.find(([, w]) => w.test(t))?.[0];
    const claims = await api.get<MyClaim[]>('/expenses/mine', status ? { status } : {});
    if (!claims.length) return { text: status ? `You have no ${STATUS_LABELS[status].toLowerCase()} claims.` : 'You have no claims yet.', buttons: [{ label: 'New claim', toolCall: { name: 'create_claim', args: {} } }] };
    return {
      text: `**${claims.length} claim${claims.length === 1 ? '' : 's'}**${status ? ` · ${STATUS_LABELS[status]}` : ''}.`,
      table: {
        columns: [
          { key: 'title', title: 'Claim' },
          { key: 'number', title: 'Number' },
          { key: 'items', title: 'Expenses' },
          { key: 'total', title: 'Total' },
          { key: 'status', title: 'Status' },
        ],
        rows: claims.slice(0, 20).map((c) => ({ title: c.title, number: c.number ?? '—', items: String(c.itemCount), total: inr(c.totalPaise), status: STATUS_LABELS[c.status] })),
      },
      buttons: claims
        .filter((c) => c.status === 'draft' && c.itemCount > 0)
        .slice(0, 3)
        .map((c) => ({ label: `Submit ${c.title}`, toolCall: { name: 'submit_claim', args: { claim: c.id } } })),
    };
  },
};

// ---------------------------------------------------------------- create_claim / add_expense

const expenseFields = {
  date: text('The date of the expense exactly as the user said it'),
  category: text('The category exactly as the user said it'),
  amount: text('The amount exactly as the user said it'),
  merchant: text('Where the money was spent, exactly as the user said it'),
  note: text("A note in the user's words, only if they gave one"),
};

const createInput = z.object({ title: text("What the claim is for, in the user's words"), ...expenseFields, categoryId: text('Leave empty'), submit: text('Leave empty') });
const addInput = z.object({ claim: text('Which claim, in the user\'s words'), ...expenseFields, categoryId: text('Leave empty'), submit: text('Leave empty') });

/** A claim's draft args: what is known so far, for a button, the draft and the reply fast path. */
function draftArgs(title: string | undefined, e: Expense, submitNow: boolean, claim?: string) {
  return Object.fromEntries(
    Object.entries({ claim, title, date: e.date, categoryId: e.categoryId, amount: e.amount !== undefined ? String(e.amount) : undefined, merchant: e.merchant, note: e.note, submit: submitNow ? undefined : 'no' }).filter(([, v]) => v !== undefined)
  );
}

function merge(kept: Expense, said: Expense): Expense {
  return { ...kept, ...Object.fromEntries(Object.entries(said).filter(([, v]) => v !== undefined)) };
}

/** What a draft or a button saved (ids, ISO dates, rupees), read back. */
function savedExpense(args: Record<string, unknown>, categories: Category[]): Expense {
  const amount = str(args.amount) ? Number(args.amount) : undefined;
  return Object.fromEntries(
    Object.entries({
      date: str(args.date),
      categoryId: categories.find((c) => c.id === str(args.categoryId))?.id,
      amount: amount !== undefined && Number.isFinite(amount) ? amount : undefined,
      merchant: str(args.merchant),
      note: str(args.note),
    }).filter(([, v]) => v !== undefined)
  ) as Expense;
}

/** The shared second half of create_claim and add_expense: ask for what's missing, or show the card. */
function expenseStep(opts: {
  tool: 'create_claim' | 'add_expense';
  ctx: ToolContext;
  title: string;
  claimId: string | null;
  expense: Expense;
  categories: Category[];
  submitNow: boolean;
}) {
  const { tool, ctx, title, claimId, expense, categories, submitNow } = opts;
  const missing = REQUIRED.filter((f) => expense[f] === undefined);
  const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: tool, args: { ...draftArgs(title, expense, submitNow, claimId ?? undefined) }, form: true } };
  if (missing.length && !ctx.form) {
    const all = missing.length === REQUIRED.length;
    return {
      kind: 'ask' as const,
      result: {
        text: all
          ? `For **${title}**, what did you spend? I need the **date**, **category**, **amount** and **merchant**. A note is optional.`
          : `For **${title}**, I still need ${andList(missing.map((f) => FIELD_LABELS[f]))}.${missing.includes('categoryId') ? ` Categories: ${andList(categories.map((c) => c.name))}.` : ''}`,
        buttons: [formButton],
      },
      draft: { tool, args: draftArgs(title, expense, submitNow, claimId ?? undefined), missing: [...missing], notSaved: [] },
    };
  }
  const problem = expense.date ? dateProblem(expense.date, ctx.today) : null;
  if (problem && !ctx.form) {
    return { kind: 'ask' as const, result: { text: `${problem} Which date was it?` }, draft: { tool, args: draftArgs(title, { ...expense, date: undefined }, submitNow, claimId ?? undefined), missing: ['date'], notSaved: [] } };
  }
  const values: ClaimFormValues = {
    title: claimId ? '' : title,
    date: expense.date ?? '',
    categoryId: expense.categoryId ?? '',
    amountRupees: expense.amount ?? null,
    merchant: expense.merchant ?? '',
    note: expense.note ?? '',
    submitNow,
  };
  const card = claimCard(claimId ? `Add to ${title}` : 'New claim', values, categories, claimId ? 'update' : 'create');
  const category = categories.find((c) => c.id === values.categoryId);
  return {
    kind: 'card' as const,
    card,
    calls: card.incomplete ? [] : expenseCalls(values, claimId, needsReceipt(values.amountRupees, category)),
    meta: { title, ...(claimId ? { claimId } : {}) },
  };
}

/**
 * A reply that fills everything the draft waits for, read without the model; a short reply is the
 * merchant when that's the only thing missing. Anything less goes to the model, which can read a
 * merchant said without "at" ("Uber to the airport"), with the server checking each value.
 */
async function fillExpense(draft: { tool: string; args: Record<string, unknown>; missing: string[] }, reply: string, api: ApiClient, ctx: ToolContext) {
  if (draft.missing.includes('title')) {
    const title = reply.trim().replace(/[.!]+$/, '');
    return title && title.split(/\s+/).length <= 12 && !/^(?:cancel|stop|no|show|list)\b/i.test(title) ? { ...draft.args, title: claimTitleFrom(title) ?? title } : null;
  }
  const categories = await api.get<Category[]>('/expense-categories');
  const said = readExpense({}, { ...ctx, latestText: reply, fromButton: false }, categories, undefined);
  const out: Record<string, unknown> = { ...draft.args };
  for (const field of draft.missing) {
    const value = said[field as keyof Expense];
    if (value !== undefined) out[field] = field === 'amount' ? String(value) : value;
  }
  // Only the merchant missing, and the reply is short: that's the merchant ("Uber").
  if (draft.missing.length === 1 && draft.missing[0] === 'merchant' && out.merchant === undefined && reply.trim().split(/\s+/).length <= 4) out.merchant = reply.trim().replace(/[.!]+$/, '');
  if (asksForDraft(reply)) out.submit = 'no';
  return draft.missing.every((f) => out[f] !== undefined) ? out : null;
}

const createClaim: AiTool<z.infer<typeof createInput>> = {
  name: 'create_claim',
  label: 'Preparing the claim',
  kind: 'write',
  description: 'Start a new expense claim with its first expense (date, category, amount, merchant). The user checks it, adds the receipt and confirms.',
  input: createInput,

  async prepare(raw, api, ctx) {
    if (!ctx.fromButton && !ctx.form) {
      const elsewhere = otherTab(ctx.latestText, 'expenses');
      if (elsewhere) return { kind: 'ask', result: { text: elsewhere } };
      // "Add another expense to my Pune claim" came back as a new claim: it goes to a draft.
      if (/\b(?:another expense|add (?:an? )?expense to|to (?:my|the) .+ claim|in (?:my|the) .+ claim)\b/i.test(ctx.latestText)) {
        return { kind: 'reroute', tool: 'add_expense', args: { ...raw } };
      }
    }
    const draft = ctx.draft?.tool === 'create_claim' ? ctx.draft.args : {};
    const categories = await api.get<Category[]>('/expense-categories');
    const args: Record<string, unknown> = ctx.fromButton ? { ...draft, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => !isBlank(v))) } : raw;
    const modelTitle = str(raw.title) && heardText(String(raw.title), ctx.latestText) && isTitle(String(raw.title)) ? String(raw.title).slice(0, 120) : undefined;
    const title = ctx.fromButton ? (str(args.title) ?? str(draft.title)) : (claimTitleFrom(ctx.latestText) ?? modelTitle ?? str(draft.title));
    const kept = savedExpense(draft, categories);
    const expense = merge(kept, readExpense(args, ctx, categories, title));
    const submitNow = ctx.fromButton ? str(args.submit) !== 'no' : !asksForDraft(ctx.latestText) && str(draft.submit) !== 'no';
    if (!title && !ctx.form) {
      return {
        kind: 'ask',
        result: { text: 'What is the claim for? For example, a trip or a bill.' },
        draft: { tool: 'create_claim', args: draftArgs(undefined, expense, submitNow), missing: ['title'], notSaved: [] },
      };
    }
    return expenseStep({ tool: 'create_claim', ctx, title: title ?? '', claimId: null, expense, categories, submitNow });
  },

  async fillFromReply(draft, reply, api, ctx) {
    if (draft.tool !== 'create_claim') return null;
    return fillExpense(draft, reply, api, ctx);
  },

  async revise(pending, values, api, ctx, hasFile) {
    return reviseClaim(pending, values, api, ctx.today, hasFile);
  },

  done: claimDone,
  partial: partialReply,
};

const addExpense: AiTool<z.infer<typeof addInput>> = {
  name: 'add_expense',
  label: 'Preparing the expense',
  kind: 'write',
  description: 'Add an expense to one of the user\'s draft claims. The user checks it, adds the receipt and confirms.',
  input: addInput,

  async prepare(raw, api, ctx) {
    const draft = ctx.draft?.tool === 'add_expense' ? ctx.draft.args : {};
    const args: Record<string, unknown> = ctx.fromButton ? { ...draft, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => !isBlank(v))) } : raw;
    const which = str(args.claim) ?? str(draft.claim);
    const { match, drafts } = await findDraft(api, which);
    if (!drafts.length) return { kind: 'ask', result: { text: 'You have no draft claims to add to. Start one: say "new claim for" and what it is for.', buttons: [{ label: 'New claim', toolCall: { name: 'create_claim', args: {} } }] } };
    if (match.kind === 'none') return { kind: 'ask', result: { text: `There's no draft claim like "${which}". Which one?`, buttons: draftButtons(drafts, 'add_expense', draftArgs(undefined, {}, true)) } };
    if (match.kind === 'many') return { kind: 'ask', result: { text: 'Which claim do you want to add it to?', buttons: draftButtons(match.items, 'add_expense') } };
    const claim = match.item;
    const categories = await api.get<Category[]>('/expense-categories');
    const expense = merge(savedExpense(draft, categories), readExpense(args, ctx, categories, claim.title));
    const submitNow = ctx.fromButton ? str(args.submit) !== 'no' : !asksForDraft(ctx.latestText) && str(draft.submit) !== 'no';
    return expenseStep({ tool: 'add_expense', ctx, title: claim.title, claimId: claim.id, expense, categories, submitNow });
  },

  async fillFromReply(draft, reply, api, ctx) {
    if (draft.tool !== 'add_expense') return null;
    return fillExpense(draft, reply, api, ctx);
  },

  async revise(pending, values, api, ctx, hasFile) {
    return reviseClaim(pending, values, api, ctx.today, hasFile);
  },

  done: claimDone,
  partial: partialReply,
};

// ---------------------------------------------------------------- add_receipt

const receiptInput = z.object({ claim: text("Which claim, in the user's words"), expense: text("Which expense, in the user's words (its merchant or date)") });

const addReceipt: AiTool<z.infer<typeof receiptInput>> = {
  name: 'add_receipt',
  label: 'Finding the expense',
  kind: 'write',
  description: 'Attach a receipt file to an expense in one of the user\'s draft claims. The user chooses the file and confirms.',
  input: receiptInput,

  async prepare(args, api, ctx) {
    const { match, drafts } = await findDraft(api, str(args.claim));
    if (!drafts.length) return { kind: 'ask', result: { text: 'You have no draft claims. Receipts can be added while a claim is a draft.' } };
    if (match.kind !== 'one') return { kind: 'ask', result: { text: 'Which claim is the receipt for?', buttons: draftButtons(match.kind === 'many' ? match.items : drafts, 'add_receipt') } };
    const claim = await api.get<ClaimDetail>(`/expenses/${match.item.id}`);
    if (!claim.items.length) return { kind: 'ask', result: { text: `**${claim.title}** has no expenses yet. Add one first.` } };
    const words = ctx.fromButton ? (str(args.expense) ?? '') : `${str(args.expense) ?? ''} ${ctx.latestText}`;
    const byId = claim.items.find((i) => i.id === words.trim());
    const day = dayRangeOf(words, ctx.today, 'past')?.from;
    const named = claim.items.filter((i) => mentions(words, i.merchant) || i.date === day);
    const candidates = byId ? [byId] : named.length ? named : claim.items.filter((i) => i.missingReceipt).length ? claim.items.filter((i) => i.missingReceipt) : claim.items;
    if (candidates.length > 1) {
      return {
        kind: 'ask',
        result: {
          text: 'Which expense is the receipt for?',
          buttons: candidates.slice(0, 6).map((i) => ({ label: `${i.merchant} · ${formatDay(i.date)} · ${inr(i.amountPaise)}`, toolCall: { name: 'add_receipt', args: { claim: claim.id, expense: i.id } } })),
        },
      };
    }
    const item = candidates[0];
    if (item.receipts.length >= 5) return { kind: 'ask', result: { text: `${item.merchant} already has 5 receipts, the most an expense can have.` } };
    return {
      kind: 'card',
      card: {
        title: 'Add a receipt',
        tone: 'default',
        rows: [
          { label: 'Claim', value: claim.title },
          { label: 'Expense', value: `${item.merchant} · ${formatDay(item.date)} · ${inr(item.amountPaise)}` },
        ],
        confirmLabel: 'Add receipt',
        file: { required: true, kind: 'receipt' },
      },
      calls: [{ method: 'POST', path: `/expenses/${claim.id}/items/${item.id}/receipts`, body: {}, attachFile: true }],
      meta: { claimId: claim.id, title: claim.title, merchant: item.merchant },
    };
  },

  done(_results, pending) {
    return {
      text: `✅ Receipt added to **${String(pending.meta.merchant)}** in ${String(pending.meta.title)}.`,
      buttons: [{ label: `Submit ${String(pending.meta.title)}`, toolCall: { name: 'submit_claim', args: { claim: String(pending.meta.claimId) } } }],
    };
  },
};

// ---------------------------------------------------------------- submit_claim

const submitInput = z.object({ claim: text("Which claim, in the user's words") });

const submitClaim: AiTool<z.infer<typeof submitInput>> = {
  name: 'submit_claim',
  label: 'Checking the claim',
  kind: 'write',
  description: "Submit one of the user's draft claims to their admin for approval. The user must confirm.",
  input: submitInput,

  async prepare(args, api, ctx) {
    const { match, drafts } = await findDraft(api, str(args.claim));
    if (!drafts.length) return { kind: 'ask', result: { text: 'You have no draft claims to submit.' } };
    if (match.kind !== 'one') return { kind: 'ask', result: { text: 'Which claim do you want to submit?', buttons: draftButtons(match.kind === 'many' ? match.items : drafts, 'submit_claim') } };
    const claim = await api.get<ClaimDetail>(`/expenses/${match.item.id}`);
    // The API's own checks (submitClaim), first: a card that would fail helps no one.
    if (!claim.items.length) return { kind: 'ask', result: { text: `**${claim.title}** has no expenses yet. Add one first.`, buttons: [{ label: 'Add an expense', toolCall: { name: 'add_expense', args: { claim: claim.id } } }] } };
    const old = claim.items.filter((i) => dateProblem(i.date, ctx.today));
    if (old.length) return { kind: 'ask', result: { text: `${andList(old.map((i) => `${i.merchant} (${formatDay(i.date)})`))} ${old.length === 1 ? 'is' : 'are'} dated outside the last ${MAX_AGE_DAYS} days. Change ${old.length === 1 ? 'it' : 'them'} on the Expenses tab first.` } };
    const missing = claim.items.filter((i) => i.missingReceipt);
    if (missing.length) {
      return {
        kind: 'ask',
        result: {
          text: `${andList(missing.map((i) => `${i.merchant} (${formatDay(i.date)})`))} ${missing.length === 1 ? 'needs a receipt' : 'need receipts'} before the claim can be submitted.`,
          buttons: missing.slice(0, 4).map((i) => ({ label: `Add the receipt for ${i.merchant}`, toolCall: { name: 'add_receipt', args: { claim: claim.id, expense: i.id } } })),
        },
      };
    }
    return {
      kind: 'card',
      card: {
        title: `Submit ${claim.title}?`,
        tone: 'default',
        rows: [
          { label: 'Expenses', value: String(claim.items.length) },
          { label: 'Total', value: inr(claim.totalPaise) },
        ],
        notes: ['Your admin is notified, and it can no longer be changed unless it is sent back.'],
        confirmLabel: 'Submit claim',
      },
      calls: [{ method: 'POST', path: `/expenses/${claim.id}/submit` }],
      meta: { claimId: claim.id, title: claim.title },
    };
  },

  done: claimDone,
};

// ---------------------------------------------------------------- module

export const myExpenseModule: AiModule = {
  key: 'my-expenses',
  title: 'Expenses assistant',
  intro: () => 'Make an expense claim, add expenses and receipts, submit it, or see your claims, by typing or speaking. Nothing is sent until you Confirm.',
  requiredFeature: 'expenses',
  starters: [
    { label: 'New claim', toolCall: { name: 'create_claim', args: {} } },
    { label: 'My claims', toolCall: { name: 'list_my_claims', args: {} } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'expenses')}
You are the Expenses assistant on the user's own Expenses tab. You help them make an expense claim, add expenses and receipts to it, submit it, and see their claims.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- A new claim: call create_claim. The title is what the claim is for, in the user's words.
- Copy the date, category, amount, merchant and note exactly as the user said them. Leave out anything the user didn't say. Never make up an amount, a date or a merchant.
- Adding to a claim that already exists: call add_expense. Adding a receipt: call add_receipt.
- A note is optional. Never ask for one.
- Never say that a claim was created or submitted. The app shows that after the backend confirms it.`,
  tools: [listMyClaims, createClaim, addExpense, addReceipt, submitClaim],
  elsewhere: (message) => otherTab(message, 'expenses'),
  direct: (message, ctx) => (newClaimStatement(message, ctx.today) ? { name: 'create_claim', args: {} } : null),
};

/**
 * A new claim the server can read by itself, with no model call: its title alone ("Add a new claim,
 * client visit to Pune"), or its title with every detail of the expense. In the eval the model
 * once answered the second kind with broken JSON. Anything in between goes to the model, which
 * can read a merchant said without "at".
 */
export function newClaimStatement(message: string, today: string): boolean {
  if (!/\b(?:new|add|create|start|make|apply for|file|raise)\b[^.]*\bclaim\b|^\s*claim for\b/i.test(message)) return false;
  if (/\b(?:another expense|to (?:my|the) .+ claim|in (?:my|the) .+ claim|submit|receipt|show|list)\b/i.test(message)) return false;
  const title = claimTitleFrom(message);
  if (!title) return false;
  const rest = message.replace(title, ' ');
  const details = [dayRangeOf(rest, today, 'past'), amountIn(rest), merchantIn(rest)];
  return details.every((d) => d === null || d === undefined) || details.every((d) => d !== null && d !== undefined);
}
