import { z } from 'zod';
import { objectIdSchema } from '../../validators/objectId';
import { ApiCallError } from '../apiClient';
import { basePrompt } from '../prompts/base.prompt';
import { andList, grounded, isBlank, Match, matchByName, mergeArgs, norm, orList, str, stripCommandWords } from '../text';
import { AiButton, AiModule, AiResult, AiTool, AiUserError, ApiClient, ConfirmCard, DepartmentFormValues, Prepared, ToolContext } from '../types';
import {
  cleanDepartmentArgs,
  DEPARTMENT_STATUSES,
  DepartmentArgs,
  DepartmentStatus,
  fillDepartmentFromText,
  STATUS_LABELS,
  statusesIn,
  statusFromWords,
} from './department.helpers';

// The Departments assistant (docs/AI_DEPARTMENTS_ASSISTANT.md). Reads and writes go through
// the existing /departments (and /employees, for counts) endpoints with the user's own token.
// As on Employees, writes are ORG_ADMIN only: the routes use requireOrgAdmin.

interface DepartmentRow {
  id: string;
  title: string;
  description: string;
  status: DepartmentStatus;
}

const PAGE_SIZE = 20;
const isObjectId = (value: string) => objectIdSchema.safeParse(value).success;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);
const STATUS_HINT = 'Status in the user\'s words, e.g. "active", "inactive", "deactivate"';

/** Filter words, where "all" (as in "show all departments") means no filter. */
const filterWords = (value: unknown) => {
  const words = str(value);
  return words && !/^(?:all|any|both|every|everything)(?: departments?)?$/i.test(words) ? words : undefined;
};

const employees = (n: number) => `${n} employee${n === 1 ? '' : 's'}`;
const short = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 3)}…` : s);

// ---------------------------------------------------------------- lookups and display

async function loadDepartments(api: ApiClient): Promise<DepartmentRow[]> {
  return api.get<DepartmentRow[]>('/departments', { limit: 100, sortBy: 'title', sortDir: 'asc' });
}

/**
 * The department the user means, by id or by name among all departments: exact, initials
 * ("HR" = "Human Resources"), prefix or a whole word. `all` is there to list the options.
 */
async function findDepartment(api: ApiClient, said: string): Promise<{ match: Match<DepartmentRow>; all: DepartmentRow[] }> {
  const query = stripCommandWords(said);
  if (isObjectId(query)) {
    try {
      return { match: { kind: 'one', item: await api.get<DepartmentRow>(`/departments/${query}`) }, all: [] };
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 404) return { match: { kind: 'none' }, all: [] };
      throw err;
    }
  }
  const all = await loadDepartments(api);
  return { match: matchByName(all, query, (d) => d.title, (d) => d.id), all };
}

function noMatch(which: string, all: DepartmentRow[]): string {
  const titles = all.map((d) => d.title);
  const options = titles.length > 12 ? `${titles.slice(0, 12).join(', ')} and ${titles.length - 12} more` : andList(titles);
  return `There is no department called "${which}".${titles.length ? ` Departments: ${options}.` : ''}`;
}

/** How many employees are in the department, or null when the user may not read employees. */
async function employeeCount(api: ApiClient, departmentId: string): Promise<number | null> {
  try {
    return (await api.page<unknown[]>('/employees', { department: departmentId, limit: 1 })).meta.total ?? null;
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 403) return null;
    throw err;
  }
}

/** Employee counts for a page of departments; null when the user may not read employees (asked once). */
async function employeeCounts(api: ApiClient, ids: string[]): Promise<Map<string, number> | null> {
  if (!ids.length) return new Map();
  const first = await employeeCount(api, ids[0]);
  if (first === null) return null;
  const rest = await Promise.all(ids.slice(1).map((id) => employeeCount(api, id)));
  return new Map(ids.map((id, i) => [id, (i === 0 ? first : rest[i - 1]) ?? 0]));
}

function departmentLine(d: DepartmentRow, count: number | null): string {
  const parts = [STATUS_LABELS[d.status], count === null ? null : employees(count), d.description];
  return `**${d.title}** · ${parts.filter(Boolean).join(' · ')}`;
}

function whichOne(question: string, items: DepartmentRow[], toolCall: (id: string) => AiButton['toolCall']): Extract<Prepared, { kind: 'ask' }> {
  return {
    kind: 'ask',
    // Titles aren't unique, so each button also shows the status and the start of the description.
    result: { text: question, buttons: items.slice(0, 6).map((d) => ({ label: `${d.title} · ${STATUS_LABELS[d.status]} · ${short(d.description, 30)}`, toolCall: toolCall(d.id) })) },
  };
}

/** A warning when another department already has this title (titles aren't unique). */
async function sameTitle(api: ApiClient, title: string, exceptId?: string): Promise<string[]> {
  const t = title.trim().toLowerCase();
  const same = (await loadDepartments(api)).find((d) => d.id !== exceptId && d.title.trim().toLowerCase() === t);
  return same ? [`A department called "${same.title}" already exists.`] : [];
}

const unknownStatus = (said: string) => `"${said}" isn't a department status. Use ${orList(DEPARTMENT_STATUSES.map((s) => STATUS_LABELS[s]))}.`;

/**
 * The status to use from the model's words. Outside buttons it must be one the user actually
 * mentioned in `said` (the latest message, without the department's own name). When the
 * model's words are unclear but the message names exactly one status, the user's word wins.
 */
function pickStatus(words: string | undefined, ctx: ToolContext, said = ctx.latestText): { status?: DepartmentStatus; problem?: string } {
  if (!words) return {};
  const s = statusFromWords(words);
  if (ctx.fromButton) return s ? { status: s } : { problem: unknownStatus(words) };
  const mentioned = statusesIn(said);
  if (!mentioned.length) return {};
  if (s && mentioned.includes(s)) return { status: s };
  if (mentioned.length === 1) return { status: mentioned[0] };
  return { problem: unknownStatus(words) };
}

/** A status filter for reads, or the answer to give when the words name no status. */
function statusFilter(value: unknown): { status?: DepartmentStatus; answer?: AiResult } {
  const words = filterWords(value);
  if (!words) return {};
  const status = statusFromWords(words);
  return status ? { status } : { answer: { text: unknownStatus(words) } };
}

// ---------------------------------------------------------------- read tools

const listInput = z.object({
  search: text('Department name to search for'),
  status: text('Only "active" or only "inactive" departments'),
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

const listDepartments: AiTool<z.infer<typeof listInput>> = {
  name: 'list_departments',
  label: 'Looking up departments',
  kind: 'read',
  description:
    "List or search departments, with how many employees each has. Use for 'show departments', 'find <name>', 'which departments are inactive' and 'how many people work in <department>'.",
  input: listInput,
  async run(args, api) {
    const filter = statusFilter(args.status);
    if (filter.answer) return filter.answer;
    const search = filterWords(args.search);
    const page = args.page ?? 1;
    // A department named outright ("Find Engineering", "How many people are in HR?") gets its details line.
    if (search && page === 1) {
      const { match } = await findDepartment(api, search);
      if (match.kind === 'one' && (!filter.status || match.item.status === filter.status)) {
        return { text: departmentLine(match.item, await employeeCount(api, match.item.id)) };
      }
    }
    const { data, meta } = await api.page<DepartmentRow[]>('/departments', {
      search: search ? search.replace(/\b(?:departments?|dept)\b/gi, '').trim() || search : undefined,
      status: filter.status,
      page,
      limit: PAGE_SIZE,
      sortBy: 'title',
      sortDir: 'asc',
    });
    const total = meta.total ?? data.length;
    const noun = `${filter.status ? `${filter.status} ` : ''}department${total === 1 ? '' : 's'}`;
    const where = search ? ` matching "${search}"` : '';
    if (total === 0) return { text: search || filter.status ? `No ${noun}${where}.` : 'There are no departments yet.' };
    const counts = await employeeCounts(api, data.map((d) => d.id));
    if (total === 1 && page === 1) return { text: departmentLine(data[0], counts?.get(data[0].id) ?? null) };
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    return {
      text: `**${total} ${noun}**${where}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: {
        columns: [
          { key: 'title', title: 'Department' },
          { key: 'status', title: 'Status' },
          ...(counts ? [{ key: 'employees', title: 'Employees' }] : []),
          { key: 'description', title: 'Description' },
        ],
        rows: data.map((d) => ({
          title: d.title,
          status: STATUS_LABELS[d.status],
          ...(counts ? { employees: String(counts.get(d.id) ?? 0) } : {}),
          description: short(d.description),
        })),
      },
      buttons: to < total ? [{ label: 'Show more', toolCall: { name: 'list_departments', args: { ...args, page: page + 1 } } }] : undefined,
    };
  },
};

const HEADCOUNT_WORDS = /\b(?:head ?count|employees?|people|staff|members?|strength)\b/i;

const countInput = z.object({
  status: text('Only "active" or only "inactive" departments'),
  department: text('A department name, only to count the employees in that department'),
});

const countDepartments: AiTool<z.infer<typeof countInput>> = {
  name: 'count_departments',
  label: 'Counting',
  kind: 'read',
  description: 'Count departments, optionally by status. With a department name, count the employees in that department.',
  input: countInput,
  async run(args, api, ctx) {
    const which = filterWords(args.department);
    // "Headcount by department" came back as a plain count in the eval: a question about people
    // with no department named is answered with each department's employee count.
    if (!which && !str(args.status) && HEADCOUNT_WORDS.test(ctx.latestText)) return listDepartments.run!({}, api, ctx);
    if (which) {
      const { match, all } = await findDepartment(api, which);
      if (match.kind === 'none') return { text: noMatch(which, all) };
      if (match.kind === 'many') {
        return whichOne(`${match.items.length} departments match "${which}". Which one?`, match.items, (id) => ({ name: 'count_departments', args: { department: id } })).result;
      }
      const count = await employeeCount(api, match.item.id);
      if (count === null) return { text: "I can't count employees for you: your role doesn't include reading employees." };
      return { text: `**${employees(count)}** ${count === 1 ? 'works' : 'work'} in ${match.item.title}.` };
    }
    const filter = statusFilter(args.status);
    if (filter.answer) return filter.answer;
    const count = async (status: DepartmentStatus) => (await api.page<DepartmentRow[]>('/departments', { status, limit: 1 })).meta.total ?? 0;
    if (filter.status) {
      const total = await count(filter.status);
      return {
        text: `**${total} ${filter.status} department${total === 1 ? '' : 's'}**.`,
        buttons: total ? [{ label: 'Show them', toolCall: { name: 'list_departments', args: { status: filter.status } } }] : undefined,
      };
    }
    const [active, inactive] = await Promise.all([count('active'), count('inactive')]);
    const total = active + inactive;
    if (!total) return { text: 'There are no departments yet.' };
    return {
      text: `**${total} department${total === 1 ? '' : 's'}**: ${active} active and ${inactive} inactive.`,
      buttons: [{ label: 'Show them', toolCall: { name: 'list_departments', args: {} } }],
    };
  },
};

// ---------------------------------------------------------------- create

const createInput = z
  .object({
    name: text('Department name, e.g. "Design"'),
    description: text('What the department does'),
    status: text(STATUS_HINT),
  })
  // Kept: the model sometimes sends `title` for the name (see cleanDepartmentArgs).
  .passthrough();

const REQUIRED = ['name', 'description'] as const;
const ASK_LABELS: Record<string, string> = { name: 'the **name**', description: 'a short **description**' };

/** The form values the card edits, and what Confirm checks them against. */
const departmentValuesSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  status: z.enum(DEPARTMENT_STATUSES),
});

function departmentBody(v: DepartmentFormValues) {
  return { title: v.title.trim(), description: v.description.trim(), status: v.status };
}

const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_department', args: {}, form: true } };

const createDepartment: AiTool<z.infer<typeof createInput>> = {
  name: 'create_department',
  label: 'Preparing the new department',
  kind: 'write',
  adminOnly: true,
  description: 'Create a new department. The admin checks and confirms it before it is saved. Fill only what the user said.',
  input: createInput,

  async prepare(raw, api, ctx) {
    const draft = ctx.draft?.tool === 'create_department' ? ctx.draft : null;
    const given = cleanDepartmentArgs(raw, ctx.userText);
    const problems: string[] = [];
    // A status counts only when the user's own words hold it (the model adds one unasked).
    const picked = pickStatus(given.status, ctx);
    if (picked.problem) problems.push(picked.problem);
    if (picked.status) given.status = picked.status;
    else delete given.status;
    const args = mergeArgs<DepartmentArgs>((draft?.args ?? {}) as DepartmentArgs, given) as DepartmentArgs;
    const status: DepartmentStatus = (args.status as DepartmentStatus | undefined) ?? 'active';
    const warnings = args.name ? await sameTitle(api, args.name) : [];

    const values: DepartmentFormValues = { title: args.name ?? '', description: args.description ?? '', status };
    const missing = REQUIRED.filter((f) => !args[f]);
    if (missing.length && !ctx.form) {
      return {
        kind: 'ask',
        result: {
          text: `${problems.length ? `${problems.join(' ')} ` : ''}I'll create ${args.name ?? 'the department'}. I still need ${andList(missing.map((f) => ASK_LABELS[f]))}.`,
          buttons: [formButton],
          warnings,
        },
        draft: {
          tool: 'create_department',
          args: Object.fromEntries(Object.entries({ name: args.name, description: args.description, status: args.status }).filter(([, v]) => v)),
          missing,
          notSaved: [],
        },
      };
    }
    const card: ConfirmCard = {
      title: 'New department',
      tone: 'default',
      rows: [
        { label: 'Title', value: values.title || '—' },
        { label: 'Description', value: values.description || '—' },
        { label: 'Status', value: STATUS_LABELS[status] },
      ],
      warnings: [...problems, ...warnings],
      confirmLabel: 'Create department',
      form: { kind: 'department', mode: 'create', values },
      incomplete: missing.length > 0,
    };
    return { kind: 'card', card, calls: missing.length ? [] : [{ method: 'POST', path: '/departments', body: departmentBody(values) }] };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'create_department') return null;
    return fillDepartmentFromText(draft.missing, reply);
  },

  async revise(_pending, values) {
    const parsed = departmentValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/departments', body: departmentBody(parsed.data) }];
  },

  done([result]) {
    const d = result as DepartmentRow;
    return { text: `✅ **Department created:** ${d.title} · ${STATUS_LABELS[d.status]}.` };
  },
};

// ---------------------------------------------------------------- update

const updateInput = z
  .object({
    department: text('Name of the department to change'),
    newName: text('New name, only when renaming'),
    description: text('New description'),
    status: text(STATUS_HINT),
  })
  // Kept: the model sometimes sends `name` or `title` for the department itself (see prepare).
  .passthrough();

const FIELD_TITLES: Record<keyof DepartmentFormValues, string> = { title: 'Title', description: 'Description', status: 'Status' };

function toValues(d: DepartmentRow): DepartmentFormValues {
  return { title: d.title, description: d.description, status: d.status };
}

/** The changed fields, as API values. */
function diffValues(current: DepartmentRow, v: DepartmentFormValues): Partial<DepartmentFormValues> {
  const before = toValues(current);
  const changed: Partial<DepartmentFormValues> = {};
  (Object.keys(FIELD_TITLES) as (keyof DepartmentFormValues)[]).forEach((key) => {
    if (String(v[key]).trim() !== String(before[key]).trim()) (changed as Record<string, string>)[key] = String(v[key]).trim();
  });
  return changed;
}

const shown = (key: keyof DepartmentFormValues, value: string) => (key === 'status' ? STATUS_LABELS[value as DepartmentStatus] : value);

/**
 * The changes the user asked for, checked: a new name or description must come from the
 * user, and a status from the latest message. Only these go into "which one?" buttons.
 */
function requestedChanges(args: Record<string, unknown>, which: string, ctx: ToolContext) {
  const out: { newName?: string; description?: string; status?: DepartmentStatus } = {};
  const problems: string[] = [];
  const newName = str(args.newName);
  if (newName && grounded(newName, ctx.userText)) out.newName = newName;
  const description = str(args.description);
  if (description && grounded(description, ctx.userText)) out.description = description;
  // The department's own name can hold a status word ("Archive"): it doesn't count as one.
  const said = ` ${norm(ctx.latestText)} `.replace(` ${norm(which)} `, ' ');
  // "Deactivate Sales" sometimes comes back as just { department: "Sales" }: the message's own word counts.
  const mentioned = statusesIn(said);
  const words = str(args.status) ?? (!ctx.fromButton && !out.newName && !out.description && mentioned.length === 1 ? mentioned[0] : undefined);
  const picked = pickStatus(words, ctx, said);
  if (picked.status) out.status = picked.status;
  if (picked.problem) problems.push(picked.problem);
  return { changes: out, problems };
}

const updateDepartment: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_department',
  label: 'Preparing the change',
  kind: 'write',
  adminOnly: true,
  description: 'Change a department: rename it, change its description, or deactivate or reactivate it. The admin confirms before saving.',
  input: updateInput,

  async prepare(input, api, ctx) {
    // "Deactivate Sales" sometimes arrives as { name: "Sales" }: without `department`, that's the department.
    const args: Record<string, unknown> = { ...input };
    for (const key of ['name', 'title']) {
      if (str(args[key])) {
        if (!str(args.department)) args.department = args[key];
        else if (!str(args.newName)) args.newName = args[key];
      }
      delete args[key];
    }
    const which = str(args.department);
    if (!which) return { kind: 'ask', result: { text: 'Which department do you want to change?' } };
    const { changes, problems } = requestedChanges(args, stripCommandWords(which), ctx);
    const { match, all } = await findDepartment(api, which);
    if (match.kind === 'none') return { kind: 'ask', result: { text: noMatch(which, all) } };
    if (match.kind === 'many') {
      return whichOne(`${match.items.length} departments match "${which}". Which one?`, match.items, (id) => ({ name: 'update_department', args: { ...changes, department: id } }));
    }
    const current = match.item;
    const values = toValues(current);
    if (changes.newName) values.title = changes.newName;
    if (changes.description) values.description = changes.description;
    if (changes.status) values.status = changes.status;

    const changed = diffValues(current, values);
    const keys = Object.keys(changed) as (keyof DepartmentFormValues)[];
    const editButton: AiButton = { label: 'Edit in a form', toolCall: { name: 'update_department', args: { department: current.id }, form: true } };
    if (!keys.length && !ctx.form) {
      const textOut = problems.length ? problems.join(' ') : `Nothing to change for **${current.title}**. Tell me what to change: name, description or status.`;
      return { kind: 'ask', result: { text: textOut, buttons: [editButton] } };
    }
    const warnings = changed.title ? await sameTitle(api, changed.title, current.id) : [];
    if (changed.status === 'inactive') {
      const count = await employeeCount(api, current.id);
      if (count) warnings.push(`${employees(count)} ${count === 1 ? 'is' : 'are'} still in ${current.title}. Deactivating doesn't move them.`);
    }
    const before = toValues(current);
    return {
      kind: 'card',
      card: {
        title: `Update ${current.title}`,
        tone: 'default',
        rows: keys.length
          ? keys.map((key) => ({ label: FIELD_TITLES[key], value: shown(key, changed[key]!), previous: shown(key, before[key]) }))
          : [{ label: 'Department', value: current.title }],
        warnings: [...problems, ...warnings],
        confirmLabel: 'Save',
        form: { kind: 'department', mode: 'update', values },
        incomplete: keys.length === 0,
      },
      calls: keys.length ? [{ method: 'PUT', path: `/departments/${current.id}`, body: changed }] : [],
      meta: { departmentId: current.id },
    };
  },

  async revise(pending, values, api) {
    const parsed = departmentValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const id = String(pending.meta.departmentId);
    const changed = diffValues(await api.get<DepartmentRow>(`/departments/${id}`), parsed.data);
    if (!Object.keys(changed).length) throw new AiUserError('Nothing was changed.');
    return [{ method: 'PUT', path: `/departments/${id}`, body: changed }];
  },

  done([result], pending) {
    const d = result as DepartmentRow;
    const body = (pending.calls[0]?.body ?? {}) as Record<string, unknown>;
    const now = toValues(d);
    const changes = (Object.keys(body) as (keyof DepartmentFormValues)[]).map((key) => `${FIELD_TITLES[key].toLowerCase()} is now ${shown(key, now[key])}`);
    return { text: `✅ Updated **${d.title}**${changes.length ? `: ${andList(changes)}` : ''}.` };
  },
};

// ---------------------------------------------------------------- delete

const deleteInput = z.object({ department: text('Name of the department to delete') });

const deleteDepartment: AiTool<z.infer<typeof deleteInput>> = {
  name: 'delete_department',
  label: 'Finding the department',
  kind: 'write',
  adminOnly: true,
  description: 'Delete a department for good. The admin must confirm.',
  input: deleteInput,

  async prepare(args, api) {
    const which = str(args.department);
    if (!which) return { kind: 'ask', result: { text: 'Which department do you want to delete?' } };
    const { match, all } = await findDepartment(api, which);
    if (match.kind === 'none') return { kind: 'ask', result: { text: noMatch(which, all) } };
    // One at a time: chat never deletes several departments in one go.
    if (match.kind === 'many') {
      return whichOne(`${match.items.length} departments match "${which}". Which one do you want to delete?`, match.items, (id) => ({ name: 'delete_department', args: { department: id } }));
    }
    const d = match.item;
    // The API refuses while employees are in it, so say so now instead of showing a card that would fail.
    const count = await employeeCount(api, d.id);
    if (count) {
      return {
        kind: 'ask',
        result: {
          text: `**${d.title}** still has ${employees(count)}, so it can't be deleted. Move them to another department first, on the Employees page.`,
          buttons: d.status === 'active' ? [{ label: `Deactivate ${d.title} instead`, toolCall: { name: 'update_department', args: { department: d.id, status: 'inactive' } } }] : undefined,
        },
      };
    }
    return {
      kind: 'card',
      card: {
        title: `Delete ${d.title}?`,
        tone: 'danger',
        rows: [
          { label: 'Status', value: STATUS_LABELS[d.status] },
          { label: 'Description', value: d.description },
        ],
        notes: ['This is the same as Delete on the Departments page.'],
        confirmLabel: 'Delete department',
      },
      calls: [{ method: 'DELETE', path: `/departments/${d.id}` }],
      meta: { departmentId: d.id, title: d.title },
    };
  },

  done(_results, pending) {
    return { text: `✅ **${String(pending.meta.title)}** was deleted.` };
  },
};

// ---------------------------------------------------------------- module

const READ_TOOLS = ['list_departments', 'count_departments'];

export const departmentModule: AiModule = {
  key: 'departments',
  title: 'Departments assistant',
  intro: (role) =>
    role === 'ORG_ADMIN'
      ? 'Ask about departments and their employees, or create and change them by typing or speaking. Every change waits for your Confirm.'
      : 'Ask about departments and how many employees each has, by typing or speaking.',
  requiredPermission: { module: 'departments', action: 'read' },
  starters: [
    { label: 'New department', toolCall: { name: 'create_department', args: {}, form: true } },
    { label: 'Show all departments', toolCall: { name: 'list_departments', args: {} } },
    { label: 'Inactive departments', toolCall: { name: 'list_departments', args: { status: 'inactive' } } },
    { label: 'Count departments', toolCall: { name: 'count_departments', args: {} } },
  ],
  systemPrompt: (ctx) => {
    const writes = ctx.tools.some((t) => !READ_TOOLS.includes(t));
    return `${basePrompt(ctx, 'departments')}
You are the Departments assistant. You help list, find and count departments, and say how many employees each has${writes ? ', and create, rename, deactivate or delete departments' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a description.
- Copy department names and statuses exactly as the user said them. The server finds the departments.${
      writes ? '\n- To rename, deactivate or reactivate a department, call update_department.' : ''
    }
- Never say that a department was created, changed or deleted. The app shows that after the backend confirms it.`;
  },
  tools: [listDepartments, countDepartments, createDepartment, updateDepartment, deleteDepartment],
};
