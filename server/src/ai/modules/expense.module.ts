import { z } from 'zod';
import { basePrompt } from '../prompts/base.prompt';
import { andList, grounded, isBlank, Match, matchByName, mentions, norm, str } from '../text';
import { AiButton, AiModule, AiResult, AiTool, AiUserError, ApiClient, CategoryFormValues, ConfirmCard, Prepared, ToolContext } from '../types';
import { isQuestion } from './exports.helpers';
import {
  activeFrom,
  amountFrom,
  amountProblem,
  asksForAnyStatus,
  asksToCreate,
  asksToDelete,
  asksToExport,
  asksToRename,
  categoryAmounts,
  CategoryAmounts,
  categoryNameFrom,
  CLAIM_STATUSES,
  ClaimStatus,
  cleanCategoryName,
  dateRange,
  DateRange,
  inr,
  limitText,
  MAX_RUPEES,
  rangeLabel,
  receiptText,
  shortDay,
  STATUS_LABELS,
  statusesIn,
  toPaise,
} from './expense.helpers';

// The Expenses assistant (docs/AI_EXPENSES_ASSISTANT.md), for the admin's Expenses page and its
// three tabs. Reads and writes go through the existing /expenses, /expense-categories, /people
// and /exports/expenses endpoints with the admin's own token. Lists also move the page behind
// the drawer to the same tab and filters (AiResult.view).

interface ClaimRow {
  id: string;
  number: string;
  title: string;
  status: ClaimStatus;
  totalPaise: number;
  itemCount: number;
  overLimitCount: number;
  employeeId: string;
  employeeName: string | null;
  submittedAt: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  limitPaise: number | null;
  receiptRequiredAbovePaise: number;
  isActive: boolean;
}

interface PersonRow {
  id: string;
  name: string;
  jobTitle: string | null;
  departmentName: string | null;
}

interface SpendRow {
  name: string;
  totalPaise: number;
  count: number;
}

interface Summary {
  from: string;
  to: string;
  approvedPaise: number;
  paidPaise: number;
  byCategory: SpendRow[];
  byDepartment: SpendRow[];
  awaitingApproval: { count: number; totalPaise: number };
  awaitingPayment: { count: number; totalPaise: number };
}

const PAGE = '/expenses';
const PAGE_SIZE = 20;
const MAX_RANGE_DAYS = 366;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);
const DATES_HINT = "Expense dates in the user's own words";

const claims = (n: number) => `${n} claim${n === 1 ? '' : 's'}`;
const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The page behind the drawer: the tab, with its filters. */
function viewOf(tab: 'claims' | 'summary' | 'categories', params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams();
  if (tab !== 'claims') query.set('tab', tab);
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const q = query.toString();
  return q ? `${PAGE}?${q}` : PAGE;
}

/** A range as button args, read back by dateRange(). */
function datesArg(range: { from?: string; to?: string } | null | undefined): string | undefined {
  if (!range) return undefined;
  if (range.from && range.to) return `from ${range.from} to ${range.to}`;
  if (range.from) return `since ${range.from}`;
  return range.to ? `until ${range.to}` : undefined;
}

/** A whole range for the summary and the export: an open end is filled in, as the API does. */
function closedRange(range: DateRange | null, today: string): { from: string; to: string } {
  const to = range?.to ?? today;
  const from = range?.from ?? `${to.slice(0, 7)}-01`;
  return from <= to ? { from, to } : { from: to, to: from };
}

const tooLong = (r: { from: string; to: string }) => (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86_400_000 > MAX_RANGE_DAYS;

/** The user's earlier messages in this chat, newest first (for "Export the CSV" after a list). */
const earlierMessages = (ctx: ToolContext) => ctx.userText.split('\n').slice(0, -1).reverse();

/** The text without the names already matched, so "June Smith" or "Paid leave" isn't read as a date or status. */
function without(textIn: string, names: (string | undefined)[]): string {
  let t = ` ${textIn} `;
  for (const name of names.filter((n): n is string => Boolean(n))) t = t.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ');
  return t.trim();
}

// ---------------------------------------------------------------- lookups

async function loadCategories(api: ApiClient): Promise<CategoryRow[]> {
  return api.get<CategoryRow[]>('/expense-categories', { all: 'true' });
}

async function loadPeople(api: ApiClient): Promise<PersonRow[]> {
  return api.get<PersonRow[]>('/people');
}

const categoryQuery = (said: string) => cleanCategoryName(said.replace(/\b(?:expense\s+)?categor(?:y|ies)\b/gi, ' ').replace(/\s+/g, ' ').trim()) || said.trim();
// "Food & meals" is said "food and meals".
const categoryKey = (name: string) => name.replace(/&/g, ' and ');

function findCategory(all: CategoryRow[], said: string): Match<CategoryRow> {
  const query = categoryQuery(said);
  const exact = matchByName(all, query, (c) => c.name, (c) => c.id);
  return exact.kind === 'none' ? matchByName(all, query, (c) => categoryKey(c.name), (c) => c.id) : exact;
}

function noCategory(which: string, all: CategoryRow[]): string {
  return `There is no category called "${which}". Categories: ${andList(all.map((c) => c.name))}.`;
}

function whichCategory(question: string, items: CategoryRow[], toolCall: (id: string) => AiButton['toolCall']): Extract<Prepared, { kind: 'ask' }> {
  return { kind: 'ask', result: { text: question, buttons: items.slice(0, 6).map((c) => ({ label: `${c.name}${c.isActive ? '' : ' · Inactive'}`, toolCall: toolCall(c.id) })) } };
}

/** A category the message names in a category's place ("in Travel", "Travel claims", "category Travel"). */
function categoryInMessage(all: CategoryRow[], message: string): CategoryRow | undefined {
  const named = all.filter((c) =>
    [c.name, categoryKey(c.name)].some((n) => {
      const k = norm(n);
      return [`in ${k}`, `for ${k}`, `under ${k}`, `category ${k}`, `${k} category`, `${k} claims`, `${k} expenses`].some((p) => mentions(message, p));
    })
  );
  return named.length === 1 ? named[0] : undefined;
}

/** A person the message names after from/by/of/for ("claims from Rahul"), when the model gave none. */
function personWordsIn(message: string): string | undefined {
  return /\b(?:from|by|of|for)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u.exec(message)?.[1];
}

/** How many submitted, approved, rejected or paid claims have an expense in this category. */
async function claimsUsing(api: ApiClient, categoryId: string): Promise<number> {
  return (await api.page<ClaimRow[]>('/expenses', { categoryId, limit: 1 })).meta.total ?? 0;
}

async function planHasExports(api: ApiClient): Promise<boolean> {
  const me = await api.get<{ user: { subscription: { modules: string[] } | null } }>('/auth/me');
  return Boolean(me.user.subscription?.modules.includes('exports'));
}

// ---------------------------------------------------------------- list_claims

const listInput = z.object({
  status: text('Claim status in the user\'s words'),
  employee: text('Employee name, as the user said it'),
  category: text('Expense category, as the user said it'),
  dates: text(DATES_HINT),
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

interface Filters {
  status?: ClaimStatus;
  employee?: PersonRow;
  category?: CategoryRow;
  range?: DateRange;
}

/**
 * The filters, from the user's words: a status, employee, category or dates count only when the
 * message names them (the model adds them unasked). From a button, the ids and dates it carries.
 */
async function readFilters(args: z.infer<typeof listInput>, api: ApiClient, ctx: ToolContext): Promise<{ filters: Filters; notes: string[]; ask?: AiResult }> {
  const filters: Filters = {};
  const notes: string[] = [];
  const latest = ctx.latestText;
  const noOne = /^(?:all|any|every(?:one| employee)?|anyone|everybody)$/i;

  const personWords = ctx.fromButton ? str(args.employee) : (str(args.employee) && grounded(String(args.employee), latest) ? str(args.employee) : personWordsIn(latest));
  if (personWords && !noOne.test(personWords)) {
    const people = await loadPeople(api);
    const mine = !ctx.fromButton && /^(?:me|my|mine|myself)$/i.test(personWords);
    const match: Match<PersonRow> = mine ? { kind: 'one', item: people.find((p) => p.id === ctx.user.id) ?? { id: ctx.user.id, name: ctx.user.name ?? 'You', jobTitle: null, departmentName: null } } : matchByName(people, personWords, (p) => p.name, (p) => p.id);
    if (match.kind === 'one') filters.employee = match.item;
    else if (match.kind === 'many') {
      return {
        filters,
        notes,
        ask: {
          text: `${match.items.length} people match "${personWords}". Whose claims?`,
          buttons: match.items.slice(0, 6).map((p) => ({ label: `${p.name}${p.departmentName ? ` · ${p.departmentName}` : ''}`, toolCall: { name: 'list_claims', args: { ...buttonArgs(args, ctx), employee: p.id } } })),
        },
      };
    } else if (str(args.employee) || ctx.fromButton) notes.push(`No one called "${personWords}", so the list isn't filtered by employee.`);
  }

  const categoryWords = ctx.fromButton ? str(args.category) : str(args.category) && grounded(String(args.category), latest) ? str(args.category) : undefined;
  if (categoryWords && !/^(?:all|any|every)(?: categor(?:y|ies))?$/i.test(categoryWords)) {
    const all = await loadCategories(api);
    const match = findCategory(all, categoryWords);
    if (match.kind === 'one') filters.category = match.item;
    else if (match.kind === 'many') {
      return { filters, notes, ask: whichCategory(`${match.items.length} categories match "${categoryWords}". Which one?`, match.items, (id) => ({ name: 'list_claims', args: { ...buttonArgs(args, ctx), category: id } })).result };
    } else notes.push(`No category called "${categoryWords}", so the list isn't filtered by category.`);
  } else if (!ctx.fromButton && !categoryWords) {
    const named = categoryInMessage(await loadCategories(api), latest);
    if (named) filters.category = named;
  }

  // Statuses and dates from the message, without the names just matched.
  const rest = without(latest, [filters.employee?.name, filters.employee?.name.split(' ')[0], filters.category?.name, personWords, categoryWords]);
  if (ctx.fromButton) {
    if ((CLAIM_STATUSES as readonly string[]).includes(String(args.status))) filters.status = args.status as ClaimStatus;
  } else {
    const said = statusesIn(rest);
    if (said.length) {
      filters.status = said[0];
      if (said.length > 1) notes.push(`One status at a time: showing ${STATUS_LABELS[said[0]]}.`);
    } else if (str(args.status) && !asksForAnyStatus(latest)) {
      // The model's status counts only when the user said one ("pending" came back as "approved" in testing).
      const model = statusesIn(String(args.status));
      if (model.length && grounded(String(args.status), latest)) filters.status = model[0];
    }
  }
  const range = ctx.fromButton ? (str(args.dates) ? dateRange(String(args.dates), ctx.today) : null) : (dateRange(rest, ctx.today) ?? (str(args.dates) && grounded(String(args.dates), latest) ? dateRange(String(args.dates), ctx.today) : null));
  if (range) filters.range = range;
  return { filters, notes };
}

/** The filters read so far, as a button's args (ids and ISO dates). */
function buttonArgs(args: z.infer<typeof listInput>, ctx: ToolContext): Record<string, unknown> {
  if (ctx.fromButton) return { ...args };
  const said = statusesIn(ctx.latestText)[0];
  const range = dateRange(ctx.latestText, ctx.today);
  return Object.fromEntries(Object.entries({ status: said, dates: datesArg(range) }).filter(([, v]) => v));
}

const listClaims: AiTool<z.infer<typeof listInput>> = {
  name: 'list_claims',
  label: 'Looking up claims',
  kind: 'read',
  adminOnly: true,
  description: 'List expense claims, filtered by status, employee, category and expense dates. Also moves the Claims tab to the same filters.',
  input: listInput,
  async run(args, api, ctx) {
    const { filters, notes, ask } = await readFilters(args, api, ctx);
    if (ask) return ask;
    const page = args.page ?? 1;
    const { data, meta } = await api.page<ClaimRow[]>('/expenses', {
      status: filters.status,
      employeeId: filters.employee?.id,
      categoryId: filters.category?.id,
      from: filters.range?.from,
      to: filters.range?.to,
      page,
      limit: PAGE_SIZE,
    });
    const total = meta.total ?? data.length;
    const parts = [filters.status ? STATUS_LABELS[filters.status] : null, filters.employee?.name, filters.category?.name, filters.range?.label].filter(Boolean);
    const view = viewOf('claims', { status: filters.status, employee: filters.employee?.id, category: filters.category?.id, from: filters.range?.from, to: filters.range?.to });
    const next: Record<string, unknown> = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.employee ? { employee: filters.employee.id } : {}),
      ...(filters.category ? { category: filters.category.id } : {}),
      ...(filters.range ? { dates: datesArg(filters.range) } : {}),
    };
    if (total === 0) return { text: `No claims${parts.length ? ` · ${parts.join(' · ')}` : ''}.`, warnings: notes, view };
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    const buttons: AiButton[] = [];
    if (to < total) buttons.push({ label: 'Show more', toolCall: { name: 'list_claims', args: { ...next, page: page + 1 } } });
    if (await planHasExports(api)) buttons.push({ label: 'Export CSV for these dates', toolCall: { name: 'export_claims', args: filters.range ? { dates: datesArg(filters.range) } : {} } });
    return {
      text: `**${claims(total)}**${parts.length ? ` · ${parts.join(' · ')}` : ''}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: {
        columns: [
          { key: 'employee', title: 'Employee' },
          { key: 'claim', title: 'Claim' },
          { key: 'submitted', title: 'Submitted' },
          { key: 'items', title: 'Expenses' },
          { key: 'total', title: 'Total' },
          { key: 'status', title: 'Status' },
        ],
        rows: data.map((c) => ({
          employee: c.employeeName ?? 'Former member',
          claim: `${short(c.title)} · ${c.number}`,
          submitted: c.submittedAt ? shortDay(String(c.submittedAt).slice(0, 10)) : '—',
          items: `${c.itemCount}${c.overLimitCount ? ` (${c.overLimitCount} over limit)` : ''}`,
          total: inr(c.totalPaise),
          status: STATUS_LABELS[c.status],
        })),
      },
      buttons: buttons.length ? buttons : undefined,
      warnings: notes.length ? notes : undefined,
      view,
    };
  },
};

// ---------------------------------------------------------------- export_claims

const exportInput = z.object({ dates: text(DATES_HINT) });

/** The dates to export: the message's, else the latest named in this chat, else this month (the page's default). */
function exportRange(args: z.infer<typeof exportInput>, ctx: ToolContext): { range: { from: string; to: string }; source: 'said' | 'earlier' | 'default' } {
  const said = ctx.fromButton ? (str(args.dates) ? dateRange(String(args.dates), ctx.today) : null) : dateRange(ctx.latestText, ctx.today);
  if (said) return { range: closedRange(said, ctx.today), source: 'said' };
  if (!ctx.fromButton) {
    for (const earlier of earlierMessages(ctx)) {
      const found = dateRange(earlier, ctx.today);
      if (found) return { range: closedRange(found, ctx.today), source: 'earlier' };
    }
  }
  return { range: closedRange(null, ctx.today), source: 'default' };
}

const exportClaims: AiTool<z.infer<typeof exportInput>> = {
  name: 'export_claims',
  label: 'Preparing the CSV',
  kind: 'read',
  adminOnly: true,
  description: 'Download the expenses CSV (one row per expense) for a range of expense dates, as the Export CSV button on the Claims tab does.',
  input: exportInput,
  async run(args, api, ctx) {
    if (!(await planHasExports(api))) return { text: "Exports aren't included in your plan, so the CSV can't be downloaded." };
    const { range, source } = exportRange(args, ctx);
    if (tooLong(range)) return { text: 'Choose a range of at most a year for the CSV.' };
    const label = rangeLabel(range.from, range.to);
    // Only a request to download now downloads: "What's in the CSV?" gets a button instead.
    const wanted = ctx.fromButton || (asksToExport(ctx.latestText) && !isQuestion(ctx.latestText));
    const which = source === 'default' ? `${label} (this month: no dates were given)` : label;
    return {
      text: `${wanted ? 'Downloading' : 'Here is'} the **Expenses CSV** for ${which}. It has one row per expense dated in that range, for every employee and status, as the page's export does.`,
      downloads: [{ label: 'Expenses CSV', path: `/exports/expenses?from=${range.from}&to=${range.to}` }],
      autoDownload: wanted,
    };
  },
};

// ---------------------------------------------------------------- expense_summary

/** Claims themselves ("Show paid claims for September"), not what was spent. */
const asksForClaims = (message: string) => /\bclaims?\b/.test(norm(message)) && !/\b(?:summary|spending|spend|spent|totals?|breakdown|how much)\b/.test(norm(message));

const summaryInput = z.object({
  dates: text(DATES_HINT),
  by: text('"category" or "department"'),
});

const expenseSummary: AiTool<z.infer<typeof summaryInput>> = {
  name: 'expense_summary',
  label: 'Adding up spending',
  kind: 'read',
  adminOnly: true,
  description: "Show approved and paid spending for a range of expense dates, by category or by department, and what is waiting now. Also moves the Summary tab to the same dates.",
  input: summaryInput,
  async run(args, api, ctx) {
    // "Show paid claims from 1 Sep to 30 Sep" came back as a summary: a message about claims, not spending, is a list.
    if (!ctx.fromButton && asksForClaims(ctx.latestText)) return listClaims.run!({}, api, ctx);
    const said = ctx.fromButton ? (str(args.dates) ? dateRange(String(args.dates), ctx.today) : null) : (dateRange(ctx.latestText, ctx.today) ?? (str(args.dates) && grounded(String(args.dates), ctx.latestText) ? dateRange(String(args.dates), ctx.today) : null));
    const range = closedRange(said, ctx.today);
    if (tooLong(range)) return { text: 'Choose a range of at most a year for the summary.' };
    const s = await api.get<Summary>('/expenses/summary', range);
    const by: 'category' | 'department' = ctx.fromButton ? (args.by === 'department' ? 'department' : 'category') : /\b(?:departments?|depts?|teams?)\b/.test(norm(ctx.latestText)) ? 'department' : 'category';
    const label = rangeLabel(s.from, s.to);
    const waiting = `Waiting now: ${claims(s.awaitingApproval.count)} (${inr(s.awaitingApproval.totalPaise)}) to approve, ${s.awaitingPayment.count} (${inr(s.awaitingPayment.totalPaise)}) to pay.`;
    const spent = s.approvedPaise ? `${inr(s.approvedPaise)} approved, ${inr(s.paidPaise)} of it paid.` : 'No approved expenses in these dates.';
    const rows = by === 'department' ? s.byDepartment : s.byCategory;
    const other = by === 'department' ? 'category' : 'department';
    return {
      text: `**${label}**: ${spent} ${waiting}`,
      table: rows.length
        ? {
            columns: [
              { key: 'name', title: by === 'department' ? 'Department' : 'Category' },
              { key: 'total', title: 'Total' },
              { key: 'count', title: 'Expenses' },
            ],
            rows: rows.map((r) => ({ name: r.name, total: inr(r.totalPaise), count: String(r.count) })),
          }
        : undefined,
      buttons: rows.length ? [{ label: `By ${other}`, toolCall: { name: 'expense_summary', args: { dates: datesArg(range), by: other } } }] : undefined,
      view: viewOf('summary', range),
    };
  },
};

// ---------------------------------------------------------------- list_categories

const categoriesInput = z.object({ search: text('Category name to look up') });

const categoryLine = (c: CategoryRow) => `**${c.name}** · Limit per expense: ${limitText(c.limitPaise)} · Receipt needed: ${receiptText(c.receiptRequiredAbovePaise)} · ${c.isActive ? 'Active' : 'Inactive'}`;

const listCategories: AiTool<z.infer<typeof categoriesInput>> = {
  name: 'list_categories',
  label: 'Looking up categories',
  kind: 'read',
  adminOnly: true,
  description: "List expense categories with their limit per expense, receipt rule and whether they're active, or show one category.",
  input: categoriesInput,
  async run(args, api) {
    const all = await loadCategories(api);
    const view = viewOf('categories');
    const search = str(args.search);
    if (search && !/^(?:all|every|any)(?: categor(?:y|ies))?$/i.test(search)) {
      const match = findCategory(all, search);
      if (match.kind === 'one') return { text: categoryLine(match.item), view };
    }
    if (!all.length) return { text: 'There are no categories yet.', view };
    const active = all.filter((c) => c.isActive).length;
    return {
      text: `**${all.length} categor${all.length === 1 ? 'y' : 'ies'}**${active < all.length ? `, ${active} active` : ''}.`,
      table: {
        columns: [
          { key: 'name', title: 'Name' },
          { key: 'limit', title: 'Limit per expense' },
          { key: 'receipt', title: 'Receipt needed' },
          { key: 'active', title: 'Active' },
        ],
        rows: all.map((c) => ({ name: c.name, limit: limitText(c.limitPaise), receipt: receiptText(c.receiptRequiredAbovePaise), active: c.isActive ? 'Yes' : 'No' })),
      },
      view,
    };
  },
};

// ---------------------------------------------------------------- category values

/** The form values the card edits, and what Confirm checks them against: the page form's rules. */
const categoryValuesSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Keep it under 60 characters'),
  limitRupees: z.number().gt(0, 'A limit must be more than zero').max(MAX_RUPEES, 'At most ₹10,00,000').nullable(),
  receiptAboveRupees: z.number().min(0, 'Can’t be negative').max(MAX_RUPEES, 'At most ₹10,00,000'),
  isActive: z.boolean(),
});

function categoryBody(v: CategoryFormValues) {
  return { name: v.name.trim(), limitPaise: v.limitRupees === null ? null : toPaise(v.limitRupees), receiptRequiredAbovePaise: toPaise(v.receiptAboveRupees), isActive: v.isActive };
}

const toValues = (c: CategoryRow): CategoryFormValues => ({ name: c.name, limitRupees: c.limitPaise === null ? null : c.limitPaise / 100, receiptAboveRupees: c.receiptRequiredAbovePaise / 100, isActive: c.isActive });

/** Saved in a draft or a button: "none" = no limit. */
const amountArg = (rupees: number | null | undefined) => (rupees === undefined ? undefined : rupees === null ? 'none' : String(rupees));
const activeArg = (active: boolean | null | undefined) => (active === undefined || active === null ? undefined : active ? 'yes' : 'no');

/**
 * The limit, receipt rule and active switch asked for: from a button or a draft, the values it
 * saved; otherwise the user's own words, without the category's name ("Active Wear").
 */
function requestedValues(args: Record<string, unknown>, ctx: ToolContext, names: (string | undefined)[]): CategoryAmounts & { isActive?: boolean } {
  if (ctx.fromButton) {
    const out: CategoryAmounts & { isActive?: boolean } = {};
    const limit = str(args.limit);
    if (limit) out.limitRupees = /^(?:none|no limit|null)$/i.test(limit) ? null : (amountFrom(limit) ?? undefined);
    const receipt = str(args.receiptAbove);
    if (receipt) out.receiptAboveRupees = /^always$/i.test(receipt) ? 0 : (amountFrom(receipt) ?? undefined);
    const active = str(args.active);
    if (active) out.isActive = /^(?:yes|true|active|on)$/i.test(active);
    return out;
  }
  const said = without(ctx.latestText, names);
  const out: CategoryAmounts & { isActive?: boolean } = categoryAmounts(said);
  // The model's amount counts only when its number is in the message and the message's own reading has none.
  const digits = (v: unknown) => (str(v) ? amountFrom(String(v)) : null);
  const modelLimit = digits(args.limit);
  if (out.limitRupees === undefined && modelLimit !== null && said.replace(/,/g, '').includes(String(modelLimit))) out.limitRupees = modelLimit;
  const modelReceipt = digits(args.receiptAbove);
  if (out.receiptAboveRupees === undefined && modelReceipt !== null && said.replace(/,/g, '').includes(String(modelReceipt))) out.receiptAboveRupees = modelReceipt;
  const active = activeFrom(said);
  if (active !== null) out.isActive = active;
  return out;
}

function valueRows(v: CategoryFormValues, before?: CategoryFormValues): ConfirmCard['rows'] {
  const all: { label: string; value: string; key: keyof CategoryFormValues }[] = [
    { key: 'name', label: 'Name', value: v.name || '—' },
    { key: 'limitRupees', label: 'Limit per expense', value: limitText(v.limitRupees === null ? null : toPaise(v.limitRupees)) },
    { key: 'receiptAboveRupees', label: 'Receipt needed', value: receiptText(toPaise(v.receiptAboveRupees)) },
    { key: 'isActive', label: 'Active', value: v.isActive ? 'Yes' : 'No' },
  ];
  if (!before) return all.map(({ label, value }) => ({ label, value }));
  const old = valueRows(before);
  return all.filter((r, i) => r.value !== old[i].value).map((r) => ({ label: r.label, value: r.value, previous: old[all.indexOf(r)].value }));
}

const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_category', args: {}, form: true } };

// ---------------------------------------------------------------- create_category

const createInput = z.object({
  name: text("The new category's name, exactly as the user said it"),
  limit: text("Limit per expense in the user's words"),
  receiptAbove: text("The amount above which a receipt is needed, in the user's words"),
  active: text('"active" or "inactive", only if the user said so'),
});

// A reply that is a new request rather than the missing name.
const NEW_REQUEST = /^(?:cancel|stop|never ?mind|no|nope|show|list|find|delete|remove|rename|update|edit|export|download|summary|how many|what|which|who)\b/i;

const createCategory: AiTool<z.infer<typeof createInput>> = {
  name: 'create_category',
  label: 'Preparing the new category',
  kind: 'write',
  adminOnly: true,
  description: 'Create an expense category. The admin checks and confirms it before it is saved. Fill only what the user said.',
  input: createInput,

  async prepare(raw, api, ctx) {
    const draft = ctx.draft?.tool === 'create_category' ? ctx.draft : null;
    const args: Record<string, unknown> = { ...(draft?.args ?? {}), ...Object.fromEntries(Object.entries(raw).filter(([, v]) => !isBlank(v))) };
    const all = await loadCategories(api);
    const model = str(raw.name) ? cleanCategoryName(String(raw.name)) : undefined;
    const name = ctx.fromButton ? (model ?? str(draft?.args.name)) : (model && mentions(ctx.latestText, model) ? model : (categoryNameFrom(ctx.latestText) ?? (model && grounded(model, ctx.userText) ? model : str(draft?.args.name))));
    const existing = name ? all.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
    // "Set Travel's limit to 10k" came back as a create named after the category.
    if (existing && !ctx.fromButton && !ctx.form && !draft && !ctx.rerouted && !asksToCreate(ctx.latestText)) {
      return { kind: 'reroute', tool: 'update_category', args: { category: existing.name, limit: raw.limit, receiptAbove: raw.receiptAbove, active: raw.active } };
    }
    if (existing) {
      return {
        kind: 'ask',
        result: {
          text: `There is already a category called **${existing.name}** (${categoryLine(existing).replace(/^\*\*.*?\*\* · /, '')}).`,
          buttons: [{ label: `Edit ${existing.name}`, toolCall: { name: 'update_category', args: { category: existing.id }, form: true } }],
        },
      };
    }
    const asked = requestedValues(ctx.fromButton ? args : raw, ctx, [name]);
    // Values from an earlier turn (the draft) stay unless this message says otherwise.
    const kept = draft && !ctx.fromButton ? requestedValues(draft.args, { ...ctx, fromButton: true }, []) : {};
    const values: CategoryFormValues = {
      name: name ?? '',
      limitRupees: asked.limitRupees !== undefined ? asked.limitRupees : (kept.limitRupees ?? null),
      receiptAboveRupees: asked.receiptAboveRupees ?? kept.receiptAboveRupees ?? 500,
      isActive: asked.isActive ?? kept.isActive ?? true,
    };
    const problems = [amountProblem('limit', values.limitRupees), amountProblem('receipt', values.receiptAboveRupees)].filter((p): p is string => Boolean(p));
    if (!name && !ctx.form) {
      return {
        kind: 'ask',
        result: { text: `${problems.length ? `${problems.join(' ')} ` : ''}What should the new category be called?`, buttons: [formButton] },
        draft: {
          tool: 'create_category',
          args: Object.fromEntries(
            Object.entries({ limit: amountArg(asked.limitRupees ?? kept.limitRupees), receiptAbove: amountArg(asked.receiptAboveRupees ?? kept.receiptAboveRupees), active: activeArg(asked.isActive ?? kept.isActive) }).filter(([, v]) => v !== undefined)
          ),
          missing: ['name'],
          notSaved: [],
        },
      };
    }
    const valid = categoryValuesSchema.safeParse(values).success;
    return {
      kind: 'card',
      card: {
        title: 'New category',
        tone: 'default',
        rows: valueRows(values),
        warnings: problems.length ? problems : undefined,
        confirmLabel: 'Create category',
        form: { kind: 'category', mode: 'create', values },
        incomplete: !valid,
      },
      calls: valid ? [{ method: 'POST', path: '/expense-categories', body: categoryBody(values) }] : [],
    };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'create_category' || draft.missing.join() !== 'name') return null;
    const t = reply.trim().replace(/[.!]+$/, '');
    if (!t || NEW_REQUEST.test(t) || /\d/.test(t)) return null;
    const name = cleanCategoryName(t.replace(/^(?:call it|name it|it'?s called|it is called|the name is|name:)\s+/i, ''));
    return name && name.split(/\s+/).length <= 6 ? { ...draft.args, name } : null;
  },

  async revise(_pending, values) {
    const parsed = categoryValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/expense-categories', body: categoryBody(parsed.data) }];
  },

  done([result]) {
    const c = result as CategoryRow;
    return { text: `✅ **Category created:** ${c.name} · Limit ${limitText(c.limitPaise)} · Receipt ${receiptText(c.receiptRequiredAbovePaise).toLowerCase()} · ${c.isActive ? 'Active' : 'Inactive'}.`, view: viewOf('categories') };
  },
};

// ---------------------------------------------------------------- update_category

const updateInput = z
  .object({
    category: text('Name of the category to change'),
    newName: text('New name, only when renaming'),
    limit: text("New limit per expense in the user's words"),
    receiptAbove: text("New receipt amount in the user's words"),
    active: text('"active" or "inactive", only if the user said so'),
  })
  // Kept: the model sometimes sends `name` for the category itself (see prepare).
  .passthrough();

function diffBody(current: CategoryRow, v: CategoryFormValues): Record<string, unknown> {
  const next = categoryBody(v);
  const body: Record<string, unknown> = {};
  if (next.name !== current.name) body.name = next.name;
  if (next.limitPaise !== current.limitPaise) body.limitPaise = next.limitPaise;
  if (next.receiptRequiredAbovePaise !== current.receiptRequiredAbovePaise) body.receiptRequiredAbovePaise = next.receiptRequiredAbovePaise;
  if (next.isActive !== current.isActive) body.isActive = next.isActive;
  return body;
}

const updateCategory: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_category',
  label: 'Preparing the change',
  kind: 'write',
  adminOnly: true,
  description: 'Change an expense category: rename it, change its limit or receipt rule, or switch it on or off. The admin confirms before saving.',
  input: updateInput,

  async prepare(input, api, ctx) {
    const args: Record<string, unknown> = { ...input };
    if (str(args.name)) {
      if (!str(args.category)) args.category = args.name;
      else if (!str(args.newName)) args.newName = args.name;
    }
    delete args.name;
    const which = str(args.category);
    if (!which) return { kind: 'ask', result: { text: 'Which category do you want to change?' } };
    const all = await loadCategories(api);
    const match = findCategory(all, which);
    // "Add a category Fuel with …" once came back as an update of a category that doesn't exist yet.
    if (match.kind === 'none' && !ctx.fromButton && !ctx.rerouted && asksToCreate(ctx.latestText)) {
      return { kind: 'reroute', tool: 'create_category', args: { name: which, limit: args.limit, receiptAbove: args.receiptAbove, active: args.active } };
    }
    if (match.kind === 'none') return { kind: 'ask', result: { text: noCategory(which, all) } };
    if (match.kind === 'many') {
      const asked = requestedValues(args, ctx, [which]);
      return whichCategory(`${match.items.length} categories match "${which}". Which one?`, match.items, (id) => ({
        name: 'update_category',
        args: Object.fromEntries(Object.entries({ category: id, limit: amountArg(asked.limitRupees), receiptAbove: amountArg(asked.receiptAboveRupees), active: activeArg(asked.isActive) }).filter(([, v]) => v !== undefined)),
      }));
    }
    const current = match.item;
    const before = toValues(current);
    const asked = requestedValues(args, ctx, [current.name, categoryKey(current.name), which]);
    const values: CategoryFormValues = { ...before };
    let newName: string | undefined;
    if (ctx.fromButton) newName = str(args.newName);
    else if (asksToRename(ctx.latestText)) {
      const said = /\b(?:to|as|into)\s+["“']?([^"”']+?)["”']?\s*[.!]?$/i.exec(ctx.latestText)?.[1];
      newName = said ? cleanCategoryName(said) : str(args.newName) && grounded(String(args.newName), ctx.userText) ? cleanCategoryName(String(args.newName)) : undefined;
    }
    if (newName && newName.toLowerCase() !== current.name.toLowerCase()) values.name = newName;
    if (asked.limitRupees !== undefined) values.limitRupees = asked.limitRupees;
    if (asked.receiptAboveRupees !== undefined) values.receiptAboveRupees = asked.receiptAboveRupees;
    if (asked.isActive !== undefined) values.isActive = asked.isActive;

    const rows = valueRows(values, before);
    const editButton: AiButton = { label: 'Edit in a form', toolCall: { name: 'update_category', args: { category: current.id }, form: true } };
    if (!rows.length && !ctx.form) {
      return { kind: 'ask', result: { text: `What should change for **${current.name}**? Now: ${categoryLine(current).replace(/^\*\*.*?\*\* · /, '')}.`, buttons: [editButton] } };
    }
    const problems = [amountProblem('limit', values.limitRupees), amountProblem('receipt', values.receiptAboveRupees)].filter((p): p is string => Boolean(p));
    const taken = values.name !== current.name && all.some((c) => c.id !== current.id && c.name.toLowerCase() === values.name.toLowerCase());
    if (taken) problems.push(`There is already a category called "${values.name}".`);
    const valid = categoryValuesSchema.safeParse(values).success && !taken;
    const body = diffBody(current, values);
    const changed = valid && Object.keys(body).length > 0;
    return {
      kind: 'card',
      card: {
        title: `Update ${current.name}`,
        tone: 'default',
        rows: rows.length ? rows : [{ label: 'Category', value: current.name }],
        warnings: problems.length ? problems : undefined,
        notes: body.isActive === false ? ["Inactive categories can't be chosen for new expenses. Claims that already use it keep it."] : undefined,
        confirmLabel: 'Save',
        form: { kind: 'category', mode: 'update', values },
        incomplete: !changed,
      },
      calls: changed ? [{ method: 'PUT', path: `/expense-categories/${current.id}`, body }] : [],
      meta: { categoryId: current.id },
    };
  },

  async revise(pending, values, api) {
    const parsed = categoryValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const id = String(pending.meta.categoryId);
    const current = (await loadCategories(api)).find((c) => c.id === id);
    if (!current) throw new AiUserError('That category no longer exists.');
    const body = diffBody(current, parsed.data);
    if (!Object.keys(body).length) throw new AiUserError('Nothing was changed.');
    return [{ method: 'PUT', path: `/expense-categories/${id}`, body }];
  },

  done([result], pending) {
    const c = result as CategoryRow;
    const body = (pending.calls[0]?.body ?? {}) as Record<string, unknown>;
    const parts = [
      'name' in body ? `the name is now ${c.name}` : null,
      'limitPaise' in body ? `the limit is now ${limitText(c.limitPaise).toLowerCase() === 'no limit' ? 'none' : limitText(c.limitPaise)}` : null,
      'receiptRequiredAbovePaise' in body ? `a receipt is needed ${receiptText(c.receiptRequiredAbovePaise).toLowerCase()}` : null,
      'isActive' in body ? `it is now ${c.isActive ? 'active' : 'inactive'}` : null,
    ].filter((p): p is string => Boolean(p));
    return { text: `✅ Updated **${c.name}**${parts.length ? `: ${andList(parts)}` : ''}.`, view: viewOf('categories') };
  },
};

// ---------------------------------------------------------------- delete_category

const deleteInput = z.object({ category: text('Name of the category to delete') }).passthrough();

const deleteCategory: AiTool<z.infer<typeof deleteInput>> = {
  name: 'delete_category',
  label: 'Finding the category',
  kind: 'write',
  adminOnly: true,
  description: 'Delete an expense category for good. The admin must confirm.',
  input: deleteInput,

  async prepare(args, api, ctx) {
    const which = str(args.category) ?? str((args as Record<string, unknown>).name);
    // "Remove the limit on Snacks" came back as a delete: with no word for deleting the category, it's an update.
    if (!ctx.fromButton && !ctx.rerouted && !asksToDelete(ctx.latestText)) return { kind: 'reroute', tool: 'update_category', args: which ? { category: which } : {} };
    if (!which) return { kind: 'ask', result: { text: 'Which category do you want to delete?' } };
    const all = await loadCategories(api);
    const match = findCategory(all, which);
    if (match.kind === 'none') return { kind: 'ask', result: { text: noCategory(which, all) } };
    // One at a time: chat never deletes several categories in one go.
    if (match.kind === 'many') {
      return whichCategory(`${match.items.length} categories match "${which}". Which one do you want to delete?`, match.items, (id) => ({ name: 'delete_category', args: { category: id } }));
    }
    const c = match.item;
    // The API refuses while expenses use it, so say so now instead of showing a card that would fail.
    const used = await claimsUsing(api, c.id);
    if (used) {
      return {
        kind: 'ask',
        result: {
          text: `**${c.name}** is used by ${claims(used)}, so it can't be deleted. Past claims must keep their category.${c.isActive ? ' You can deactivate it instead, so it isn\'t used for new expenses.' : ' It is already inactive.'}`,
          buttons: c.isActive ? [{ label: `Deactivate ${c.name} instead`, toolCall: { name: 'update_category', args: { category: c.id, active: 'no' } } }] : undefined,
        },
      };
    }
    return {
      kind: 'card',
      card: {
        title: `Delete ${c.name}?`,
        tone: 'danger',
        rows: valueRows(toValues(c)).slice(1),
        notes: ['This is the same as Delete on the Categories tab. It is refused if a draft claim uses the category.'],
        confirmLabel: 'Delete category',
      },
      calls: [{ method: 'DELETE', path: `/expense-categories/${c.id}` }],
      meta: { categoryId: c.id, name: c.name },
    };
  },

  done(_results, pending) {
    return { text: `✅ **${String(pending.meta.name)}** was deleted.`, view: viewOf('categories') };
  },
};

// ---------------------------------------------------------------- module

/** "Export the CSV", "Download October's expenses as CSV": no model call (section 9.5). */
function exportStatement(message: string): boolean {
  const t = norm(message);
  return asksToExport(message) && !isQuestion(message) && !/\bcategor(?:y|ies)\b/.test(t) && !/\b(?:summary|by department|by category)\b/.test(t);
}

export const expenseModule: AiModule = {
  key: 'expenses',
  title: 'Expenses assistant',
  intro: () => 'List and filter claims, export them as CSV, see the spending summary, and manage categories, by typing or speaking. Category changes wait for your Confirm.',
  adminOnly: true,
  requiredFeature: 'expenses',
  starters: [
    { label: 'Submitted claims', toolCall: { name: 'list_claims', args: { status: 'submitted' } } },
    { label: "This month's summary", toolCall: { name: 'expense_summary', args: {} } },
    { label: 'Show categories', toolCall: { name: 'list_categories', args: {} } },
    { label: 'New category', toolCall: { name: 'create_category', args: {}, form: true } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'expenses')}
You are the Expenses assistant. You help list expense claims, export them as CSV, show the spending summary, and list, create, change or delete expense categories.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Copy names, statuses, dates and amounts exactly as the user said them. The server works them out.
- To change a category (its name, limit, receipt rule, or switching it on or off), call update_category.
- Never say that a category was created, changed or deleted. The app shows that after the backend confirms it.`,
  tools: [listClaims, exportClaims, expenseSummary, listCategories, createCategory, updateCategory, deleteCategory],
  direct: (message) => (exportStatement(message) ? { name: 'export_claims', args: {} } : null),
};
