import { z } from 'zod';
import { objectIdSchema } from '../../validators/objectId';
import { createEmployeeSchema, updateEmployeeSchema } from '../../validators/employee.validators';
import { ApiCallError } from '../apiClient';
import { formatDay, resolveDate } from '../dates';
import { basePrompt } from '../prompts/base.prompt';
import {
  AiButton,
  AiModule,
  AiResult,
  AiTool,
  AiUserError,
  ApiClient,
  ConfirmCard,
  EmployeeFormValues,
  Prepared,
  ToolContext,
  ToolDraft,
} from '../types';
import {
  andList,
  CreateArgs,
  isBlank,
  cleanCreateArgs,
  FIELD_LABELS,
  fillFromText,
  findEmails,
  grounded,
  looksLikeJobTitle,
  matchByName,
  mentions,
  mergeArgs,
  normalizeEmail,
  orList,
  str,
} from './employee.helpers';
import { stripCommandWords } from '../text';

// The Employees assistant (docs/AI_EMPLOYEE_ASSISTANT.md). Every read and write goes
// through the existing /employees, /departments, /roles and /people endpoints with the
// user's own token; this file only decides which call to make and what to show.

interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  departmentName: string | null;
  roleId: string | null;
  roleName: string | null;
  status: 'active' | 'disabled';
  reportsTo: string | null;
  reportsToName: string | null;
  joiningDate: string | null;
  dateOfBirth: string | null;
}
interface Department {
  id: string;
  title: string;
}
interface Role {
  id: string;
  name: string;
}
interface Person {
  id: string;
  name: string;
  jobTitle: string | null;
  departmentName: string | null;
  email?: string;
}

const PAGE_SIZE = 20;
const isObjectId = (value: string) => objectIdSchema.safeParse(value).success;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);
const optionalStatus = (description: string) => z.preprocess((v) => (isBlank(v) ? undefined : v), z.enum(['active', 'disabled']).optional()).describe(description);

// ---------------------------------------------------------------- lookups

async function loadDepartments(api: ApiClient): Promise<Department[]> {
  return api.get<Department[]>('/departments', { limit: 100, sortBy: 'title', sortDir: 'asc' });
}

async function loadRoles(api: ApiClient): Promise<Role[]> {
  return api.get<Role[]>('/roles', { limit: 100, sortBy: 'name', sortDir: 'asc' });
}

/**
 * Departments the user can filter by. An ORG_USER may read employees without the
 * 'departments' permission, so then they come from the employee list itself.
 */
async function departmentOptions(api: ApiClient): Promise<Department[]> {
  try {
    return await loadDepartments(api);
  } catch (err) {
    if (!(err instanceof ApiCallError) || err.status !== 403) throw err;
    const seen = new Map<string, string>();
    for (let page = 1; page <= 5; page++) {
      const { data, meta } = await api.page<EmployeeRow[]>('/employees', { limit: 100, page });
      data.forEach((e) => e.department && e.departmentName && seen.set(e.department, e.departmentName));
      if (page * 100 >= (meta.total ?? 0)) break;
    }
    return [...seen].map(([id, title]) => ({ id, title }));
  }
}

const describeEmployee = (e: EmployeeRow) => [e.departmentName, e.email].filter(Boolean).join(', ');

/** The employee the user means: by id, exact name, or a single search hit. */
async function findEmployee(api: ApiClient, said: string): Promise<{ kind: 'one'; item: EmployeeRow } | { kind: 'none' } | { kind: 'many'; items: EmployeeRow[] }> {
  const query = stripCommandWords(said);
  if (isObjectId(query)) {
    try {
      return { kind: 'one', item: await api.get<EmployeeRow>(`/employees/${query}`) };
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 404) return { kind: 'none' };
      throw err;
    }
  }
  const email = normalizeEmail(query);
  const hits = await api.get<EmployeeRow[]>('/employees', { search: email ?? query, limit: 10 });
  if (email) {
    const exact = hits.find((h) => h.email === email);
    return exact ? { kind: 'one', item: exact } : { kind: 'none' };
  }
  const named = matchByName(hits, query, (e) => e.name, (e) => e.id);
  if (named.kind !== 'none') return named;
  return hits.length === 1 ? { kind: 'one', item: hits[0] } : hits.length ? { kind: 'many', items: hits } : { kind: 'none' };
}

/** A manager: anyone active in the organization, admins included (/employees lists ORG_USERs only). */
async function findPerson(api: ApiClient, query: string): Promise<{ kind: 'one'; item: Person } | { kind: 'none' } | { kind: 'many'; items: Person[] }> {
  if (isObjectId(query)) {
    try {
      return { kind: 'one', item: await api.get<Person>(`/people/${query}`) };
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 404) return { kind: 'none' };
      throw err;
    }
  }
  const hits = await api.get<Person[]>('/people/search', { q: query });
  const named = matchByName(hits, query, (p) => p.name, (p) => p.id);
  if (named.kind !== 'none') return named;
  return hits.length === 1 ? { kind: 'one', item: hits[0] } : hits.length ? { kind: 'many', items: hits } : { kind: 'none' };
}

function whichOne(question: string, items: EmployeeRow[], toolCall: (id: string) => AiButton['toolCall']): Extract<Prepared, { kind: 'ask' }> {
  return {
    kind: 'ask',
    result: {
      text: question,
      buttons: items.slice(0, 6).map((e) => ({ label: `${e.name} · ${describeEmployee(e)}`, toolCall: toolCall(e.id) })),
    },
  };
}

// ---------------------------------------------------------------- display

const dash = (v: string | null | undefined) => (v ? v : '—');

function employeeLine(e: EmployeeRow): string {
  const parts = [e.jobTitle, e.departmentName, e.email, e.reportsToName ? `reports to ${e.reportsToName}` : null, e.joiningDate ? `joined ${formatDay(e.joiningDate)}` : null, e.status];
  return `**${e.name}** · ${parts.filter(Boolean).join(' · ')}`;
}

function employeeTable(rows: EmployeeRow[]): AiResult['table'] {
  return {
    columns: [
      { key: 'name', title: 'Name' },
      { key: 'jobTitle', title: 'Job title' },
      { key: 'department', title: 'Department' },
      { key: 'email', title: 'Email' },
      { key: 'status', title: 'Status' },
    ],
    rows: rows.map((e) => ({ name: e.name, jobTitle: dash(e.jobTitle), department: dash(e.departmentName), email: e.email, status: e.status })),
  };
}

const notSavedWarning = (notSaved: string[]) =>
  notSaved.length ? [`Not saved: ${andList(notSaved)}. The employee record has no field for ${notSaved.length === 1 ? 'it' : 'these'}.`] : [];

// ---------------------------------------------------------------- read tools

const listInput = z.object({
  search: text('Name or email to search for'),
  department: text('Department name'),
  status: optionalStatus('Only active or only disabled accounts'),
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

/** A department filter from the user's words, or the answer to give when there is none. */
async function departmentFilter(api: ApiClient, name: string | undefined): Promise<{ id?: string; title?: string; answer?: AiResult }> {
  if (!name) return {};
  const departments = await departmentOptions(api);
  const match = matchByName(departments, name, (d) => d.title, (d) => d.id);
  if (match.kind === 'one') return { id: match.item.id, title: match.item.title };
  const titles = departments.map((d) => d.title);
  return {
    answer: {
      text:
        match.kind === 'many'
          ? `"${name}" matches ${orList(match.items.map((d) => d.title))}. Which department do you mean?`
          : `There is no department called "${name}".${titles.length ? ` Departments: ${andList(titles)}.` : ''}`,
    },
  };
}

const listEmployees: AiTool<z.infer<typeof listInput>> = {
  name: 'list_employees',
  label: 'Searching employees',
  kind: 'read',
  description: "List or search employees. Use for 'show employees', 'find <name>' and 'who works in <department>'.",
  input: listInput,
  async run(args, api) {
    const search = str(args.search);
    const filter = await departmentFilter(api, str(args.department));
    if (filter.answer) return filter.answer;
    const page = args.page ?? 1;
    const { data, meta } = await api.page<EmployeeRow[]>('/employees', {
      search,
      department: filter.id,
      status: args.status,
      page,
      limit: PAGE_SIZE,
      sortBy: 'name',
      sortDir: 'asc',
    });
    const total = meta.total ?? data.length;
    const noun = args.status ? `${args.status} employees` : 'employees';
    const where = [search ? `matching "${search}"` : null, filter.title ? `in ${filter.title}` : null].filter(Boolean).join(' ');
    if (total === 0) return { text: where || args.status ? `No ${noun}${where ? ` ${where}` : ''}.` : 'There are no employees yet.' };
    if (total === 1 && page === 1) return { text: employeeLine(data[0]) };
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    const more = to < total;
    return {
      text: `**${total} ${noun}**${where ? ` ${where}` : ''}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: employeeTable(data),
      buttons: more ? [{ label: 'Show more', toolCall: { name: 'list_employees', args: { ...args, department: filter.id, page: page + 1 } } }] : undefined,
    };
  },
};

const countInput = z.object({
  department: text('Department name'),
  status: optionalStatus('Count active (default) or disabled accounts'),
});

const countEmployees: AiTool<z.infer<typeof countInput>> = {
  name: 'count_employees',
  label: 'Counting employees',
  kind: 'read',
  description: 'Count employees, optionally in one department.',
  input: countInput,
  async run(args, api) {
    const status = args.status ?? 'active';
    const filter = await departmentFilter(api, str(args.department));
    if (filter.answer) return filter.answer;
    const { meta } = await api.page<EmployeeRow[]>('/employees', { department: filter.id, status, limit: 1 });
    const total = meta.total ?? 0;
    const noun = `${status} employee${total === 1 ? '' : 's'}`;
    if (filter.id) {
      return {
        text: `**${total} ${noun}** ${total === 1 ? 'works' : 'work'} in ${filter.title}.`,
        buttons: total ? [{ label: 'Show them', toolCall: { name: 'list_employees', args: { department: filter.id, status } } }] : undefined,
      };
    }
    // No department: the total plus a breakdown, while the organization is small enough to page through.
    if (total === 0 || total > 500) return { text: `**${total} ${noun}** in total.` };
    const counts = new Map<string, number>();
    for (let page = 1; (page - 1) * 100 < total; page++) {
      const { data } = await api.page<EmployeeRow[]>('/employees', { status, limit: 100, page });
      data.forEach((e) => counts.set(e.departmentName ?? 'No department', (counts.get(e.departmentName ?? 'No department') ?? 0) + 1));
    }
    return {
      text: `**${total} ${noun}** in total.`,
      table: {
        columns: [
          { key: 'department', title: 'Department' },
          { key: 'count', title: 'Employees' },
        ],
        rows: [...counts].sort((a, b) => b[1] - a[1]).map(([department, count]) => ({ department, count: String(count) })),
      },
    };
  },
};

// ---------------------------------------------------------------- create

const createInput = z
  .object({
    name: text('Full name'),
    email: text('Email address'),
    jobTitle: text('Job title or designation, e.g. Software Engineer'),
    department: text('Department name, e.g. Engineering'),
    role: text('Permission role from the Roles page, e.g. Employee. Not the job title.'),
    manager: text('Name of the manager they report to'),
    joiningDate: text("Joining date in the user's words"),
    dateOfBirth: text("Date of birth in the user's words"),
    copyFrom: text('Name of an existing employee to copy department, job title, role and manager from'),
    otherDetails: text("Details that fit no field above, e.g. 'salary 75,000' or a phone number"),
  })
  // Kept: the model sometimes sends { employee: "Mike" } here (see prepare).
  .passthrough();

const REQUIRED_CREATE = ['name', 'email', 'jobTitle', 'department', 'role'] as const;

interface ResolvedCreate {
  department?: Department;
  role?: Role;
  manager?: Person;
  joiningDate?: string;
  dateOfBirth?: string;
  problems: string[];
  departments: Department[];
  roles: Role[];
}

/** Turns names into records. Anything that matches nothing is dropped and explained. */
async function resolveCreate(args: CreateArgs, api: ApiClient, ctx: ToolContext): Promise<ResolvedCreate> {
  const [departments, roles] = await Promise.all([loadDepartments(api), loadRoles(api)]);
  const out: ResolvedCreate = { problems: [], departments, roles };
  if (args.department) {
    const m = matchByName(departments, args.department, (d) => d.title, (d) => d.id);
    if (m.kind === 'one') out.department = m.item;
    else if (m.kind === 'many') out.problems.push(`"${args.department}" matches ${orList(m.items.map((d) => d.title))}.`);
    else out.problems.push(`There is no department called "${args.department}".`);
  }
  if (roles.length === 1) out.role = roles[0];
  else if (args.role) {
    const m = matchByName(roles, args.role, (r) => r.name, (r) => r.id);
    if (m.kind === 'one') out.role = m.item;
    else if (m.kind === 'many') out.problems.push(`"${args.role}" matches the roles ${orList(m.items.map((r) => r.name))}.`);
    else out.problems.push(`"${args.role}" is not an access role.`);
  }
  if (args.manager) {
    const m = await findPerson(api, args.manager);
    if (m.kind === 'one') out.manager = m.item;
    else if (m.kind === 'many') out.problems.push(`"${args.manager}" matches ${orList(m.items.slice(0, 5).map((p) => p.name))}. Say the manager's full name.`);
    // An id here is a copied record's manager who has since left.
    else out.problems.push(isObjectId(args.manager) ? 'The copied manager is no longer active, so no manager is set.' : `I couldn't find a manager called "${args.manager}".`);
  }
  if (args.joiningDate) {
    const date = resolveDate(args.joiningDate, ctx.today);
    if (date) out.joiningDate = date;
    else out.problems.push(`I couldn't read the joining date "${args.joiningDate}".`);
  }
  if (args.dateOfBirth) {
    const date = resolveDate(args.dateOfBirth, ctx.today);
    if (date && date < ctx.today) out.dateOfBirth = date;
    else out.problems.push(`I couldn't read the date of birth "${args.dateOfBirth}". Include the year, e.g. 15 Aug 1995.`);
  }
  return out;
}

function createMissing(args: CreateArgs, r: ResolvedCreate): string[] {
  return REQUIRED_CREATE.filter((f) => {
    if (f === 'department') return !r.department;
    if (f === 'role') return !r.role;
    return !args[f];
  });
}

function askForCreate(args: CreateArgs, r: ResolvedCreate, missing: string[], copiedFrom?: string): string {
  const who = args.name ?? 'the new employee';
  const options = (field: string) => {
    if (field === 'department' && r.departments.length) return ` (${orList(r.departments.slice(0, 8).map((d) => d.title))})`;
    if (field === 'role' && r.roles.length) return ` (${orList(r.roles.slice(0, 8).map((x) => x.name))})`;
    return '';
  };
  const asks = missing.map((f) => `**${FIELD_LABELS[f]}**${options(f)}`);
  const problems = r.problems.length ? `${r.problems.join(' ')} ` : '';
  if (copiedFrom) {
    const copied = [r.department ? `department (${r.department.title})` : null, args.jobTitle ? `job title (${args.jobTitle})` : null, r.role ? `role (${r.role.name})` : null, r.manager ? `manager (${r.manager.name})` : null].filter(Boolean) as string[];
    return `${problems}I'll copy ${copiedFrom}'s ${andList(copied)}. What ${missing.length === 1 ? 'is' : 'are'} the new employee's ${andList(asks)}?`;
  }
  const where = r.department ? ` in ${r.department.title}` : '';
  return `${problems}I'll create ${who}${where}. I still need the ${andList(asks)}.`;
}

function formValuesFrom(args: CreateArgs, r: ResolvedCreate): EmployeeFormValues {
  return {
    name: args.name ?? '',
    email: args.email ?? '',
    jobTitle: args.jobTitle ?? '',
    department: r.department?.id ?? '',
    roleId: r.role?.id ?? '',
    reportsTo: r.manager?.id ?? '',
    joiningDate: r.joiningDate ?? '',
    dateOfBirth: r.dateOfBirth ?? '',
  };
}

function createBody(v: EmployeeFormValues) {
  return {
    name: v.name,
    email: v.email,
    jobTitle: v.jobTitle,
    department: v.department,
    roleId: v.roleId,
    reportsTo: v.reportsTo || null,
    ...(v.joiningDate ? { joiningDate: v.joiningDate } : {}),
    ...(v.dateOfBirth ? { dateOfBirth: v.dateOfBirth } : {}),
  };
}

const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_employee', args: {}, form: true } };

const createEmployee: AiTool<z.infer<typeof createInput>> = {
  name: 'create_employee',
  label: 'Preparing the new employee',
  kind: 'write',
  adminOnly: true,
  description: 'Add, create, hire or onboard a new employee. The admin checks and confirms it before it is saved. Fill only what the user said.',
  input: createInput,

  async prepare(input, api, ctx) {
    // { employee: "Mike" }: the template in "create an employee from Mike", otherwise the new name.
    let raw: Record<string, unknown> = input;
    const alias = str(raw.employee);
    if (alias && !str(raw.copyFrom)) {
      if (/\b(from|like|copy|same as|based on)\b/i.test(ctx.latestText)) raw = { ...raw, copyFrom: alias };
      else if (!str(raw.name)) raw = { ...raw, name: alias };
    }
    const { args: given, notSaved: newlyNotSaved } = cleanCreateArgs(raw, ctx.userText, ctx.latestText);
    const draft = ctx.draft?.tool === 'create_employee' ? ctx.draft : null;
    let args = mergeArgs<CreateArgs>(draft?.args ?? {}, given) as CreateArgs;
    const notSaved = [...new Set([...(draft?.notSaved ?? []), ...newlyNotSaved])];

    // "Create an employee from Mike": Mike's record is the template; name and email stay the user's.
    let copiedFrom = typeof draft?.args.copiedFrom === 'string' ? draft.args.copiedFrom : undefined;
    if (given.copyFrom) {
      const source = await findEmployee(api, given.copyFrom);
      if (source.kind === 'many') {
        return {
          ...whichOne(`Several employees match "${given.copyFrom}". Which one should I copy?`, source.items, (id) => ({ name: 'create_employee', args: { copyFrom: id } })),
          draft: draftOf({ ...args, copyFrom: undefined }, [], notSaved),
        };
      }
      if (source.kind === 'none') {
        const name = given.copyFrom;
        return {
          kind: 'ask',
          result: {
            text: `I couldn't find an employee called "${name}" to copy. Did you mean to create a new employee named ${name}?`,
            buttons: grounded(name, ctx.userText) ? [{ label: `Yes, create ${name}`, toolCall: { name: 'create_employee', args: { name } } }] : undefined,
          },
          draft: null,
        };
      }
      const s = source.item;
      copiedFrom = s.name;
      // What the user said wins over the copied values.
      args = mergeArgs<CreateArgs>(
        { department: s.department ?? undefined, jobTitle: s.jobTitle ?? undefined, role: s.roleId ?? undefined, manager: s.reportsTo ?? undefined },
        { ...args, copyFrom: undefined }
      ) as CreateArgs;
    }
    delete args.copyFrom;

    const r = await resolveCreate(args, api, ctx);
    // Keep only what resolved, as ids, so the next turn's merge can't lose it.
    const kept: CreateArgs = {
      name: args.name,
      email: args.email,
      jobTitle: args.jobTitle,
      department: r.department?.id,
      role: r.role?.id,
      manager: r.manager?.id,
      joiningDate: r.joiningDate,
      dateOfBirth: r.dateOfBirth,
    };
    const missing = createMissing(args, r);

    if (missing.length && !ctx.form) {
      return {
        kind: 'ask',
        result: { text: askForCreate(args, r, missing, copiedFrom), buttons: [formButton], warnings: notSavedWarning(notSaved) },
        draft: draftOf({ ...kept, copiedFrom }, missing, notSaved),
      };
    }
    const values = formValuesFrom(args, r);
    return {
      kind: 'card',
      card: {
        title: 'New employee',
        tone: 'default',
        rows: [
          { label: 'Name', value: dash(values.name) },
          { label: 'Email', value: dash(values.email) },
          { label: 'Job title', value: dash(values.jobTitle) },
          { label: 'Department', value: dash(r.department?.title) },
          { label: 'Role', value: dash(r.role?.name) },
          { label: 'Reports to', value: dash(r.manager?.name) },
          { label: 'Joining date', value: r.joiningDate ? formatDay(r.joiningDate) : `${formatDay(ctx.today)} (today)` },
          ...(r.dateOfBirth ? [{ label: 'Date of birth', value: formatDay(r.dateOfBirth) }] : []),
        ],
        warnings: [...r.problems, ...notSavedWarning(notSaved)],
        notes: values.email ? [`A temporary password will be emailed to ${values.email}.`] : [],
        confirmLabel: 'Create employee',
        form: { kind: 'employee', mode: 'create', values },
        incomplete: missing.length > 0,
      },
      calls: missing.length ? [] : [{ method: 'POST', path: '/employees', body: createBody(values) }],
    };
  },

  async fillFromReply(draft, reply, api) {
    if (draft.tool !== 'create_employee' || !draft.missing.length) return null;
    const [departments, roles] = await Promise.all([loadDepartments(api), loadRoles(api)]);
    const filled = fillFromText(draft.missing, reply, { departments: departments.map((d) => d.title), roles: roles.map((r) => r.name) });
    // Only when the reply answers everything; a partial answer may hold more, so the model reads it.
    return draft.missing.every((f) => f in filled) ? filled : null;
  },

  async revise(_pending, values) {
    const parsed = createEmployeeSchema.safeParse(createBody(values as EmployeeFormValues));
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/employees', body: parsed.data }];
  },

  done([result]) {
    const user = (result as { user: EmployeeRow }).user;
    return { text: `✅ **Employee created:** ${user.name} · ${dash(user.departmentName)} · ${user.email}.` };
  },
};

function draftOf(args: Record<string, unknown>, missing: string[], notSaved: string[]): ToolDraft {
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return { tool: 'create_employee', args: clean, missing, notSaved };
}

// ---------------------------------------------------------------- update

const updateInput = z.object({
  employee: text('Name or email of the employee to change'),
  name: text('New name'),
  email: text('New email address'),
  jobTitle: text('New job title'),
  department: text('New department name'),
  role: text('New access role from the Roles page, e.g. Manager'),
  manager: text('Name of the new manager: the person they will report to'),
  joiningDate: text("New joining date in the user's words"),
  dateOfBirth: text("New date of birth in the user's words"),
  status: optionalStatus('disabled to block their login, active to allow it again'),
});

const FIELD_TITLES: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  jobTitle: 'Job title',
  department: 'Department',
  roleId: 'Role',
  reportsTo: 'Reports to',
  joiningDate: 'Joining date',
  dateOfBirth: 'Date of birth',
  status: 'Status',
};

function toFormValues(e: EmployeeRow): EmployeeFormValues {
  return {
    name: e.name,
    email: e.email,
    jobTitle: e.jobTitle ?? '',
    department: e.department ?? '',
    roleId: e.roleId ?? '',
    status: e.status,
    reportsTo: e.reportsTo ?? '',
    joiningDate: e.joiningDate ?? '',
    dateOfBirth: e.dateOfBirth ?? '',
  };
}

/** The PUT body for what differs between the current record and the edited values. */
function diffBody(current: EmployeeRow, v: EmployeeFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const set = (key: string, next: unknown, prev: unknown) => {
    if ((next ?? null) !== (prev ?? null)) body[key] = next;
  };
  set('name', v.name.trim(), current.name);
  set('email', v.email.trim().toLowerCase(), current.email);
  set('jobTitle', v.jobTitle.trim(), current.jobTitle ?? '');
  set('department', v.department, current.department ?? '');
  set('roleId', v.roleId, current.roleId ?? '');
  if (v.status) set('status', v.status, current.status);
  set('reportsTo', v.reportsTo || null, current.reportsTo);
  if (v.joiningDate) set('joiningDate', v.joiningDate, current.joiningDate);
  set('dateOfBirth', v.dateOfBirth || null, current.dateOfBirth);
  return body;
}

const updateEmployee: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_employee',
  label: 'Preparing the change',
  kind: 'write',
  adminOnly: true,
  description: "Change an existing employee: name, email, job title, department, role, manager, dates, or disable/enable their account. The admin confirms before saving.",
  input: updateInput,

  async prepare(args, api, ctx) {
    const who = str(args.employee);
    if (!who) return { kind: 'ask', result: { text: 'Which employee do you want to change?' } };
    const found = await findEmployee(api, who);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No employee matches "${who}".` } };
    if (found.kind === 'many') {
      return whichOne(`${found.items.length} employees match "${who}". Which one?`, found.items, (id) => ({ name: 'update_employee', args: { ...args, employee: id } }));
    }
    const current = found.item;
    const values = toFormValues(current);
    const shown: Record<string, string> = {};
    const problems: string[] = [];

    const name = str(args.name);
    if (name && grounded(name, ctx.userText)) values.name = name;
    const emailText = str(args.email);
    if (emailText) {
      const email = normalizeEmail(emailText);
      if (email && findEmails(ctx.userText).includes(email)) values.email = email;
      else problems.push(`I couldn't find the new email address in your message.`);
    }
    const jobTitle = str(args.jobTitle);
    if (jobTitle) {
      if (looksLikeJobTitle(jobTitle)) values.jobTitle = jobTitle;
      else problems.push(`"${jobTitle}" doesn't look like a job title.`);
    }
    const department = str(args.department);
    if (department) {
      const m = matchByName(await loadDepartments(api), department, (d) => d.title, (d) => d.id);
      if (m.kind === 'one') {
        values.department = m.item.id;
        shown.department = m.item.title;
      } else problems.push(m.kind === 'many' ? `"${department}" matches ${orList(m.items.map((d) => d.title))}.` : `There is no department called "${department}".`);
    }
    const role = str(args.role);
    if (role) {
      const m = matchByName(await loadRoles(api), role, (r) => r.name, (r) => r.id);
      if (m.kind === 'one') {
        values.roleId = m.item.id;
        shown.roleId = m.item.name;
      } else problems.push(m.kind === 'many' ? `"${role}" matches the roles ${orList(m.items.map((r) => r.name))}.` : `"${role}" is not an access role.`);
    }
    const manager = str(args.manager);
    if (manager) {
      const m = await findPerson(api, manager);
      if (m.kind === 'one' && m.item.id !== current.id) {
        values.reportsTo = m.item.id;
        shown.reportsTo = m.item.name;
      } else if (m.kind === 'one') {
        // "Make Mike a Manager" came back as Mike's own manager: if the message names a role, that was meant.
        const named = role ? null : (await loadRoles(api)).filter((r) => mentions(ctx.latestText, r.name));
        if (named?.length === 1) {
          values.roleId = named[0].id;
          shown.roleId = named[0].name;
        } else problems.push(`${current.name} can't report to themselves.`);
      } else problems.push(m.kind === 'many' ? `"${manager}" matches ${orList(m.items.slice(0, 5).map((p) => p.name))}.` : `I couldn't find a manager called "${manager}".`);
    }
    for (const field of ['joiningDate', 'dateOfBirth'] as const) {
      const said = str(args[field]);
      if (!said) continue;
      const date = resolveDate(said, ctx.today);
      if (date && (field === 'joiningDate' || date < ctx.today)) values[field] = date;
      else problems.push(`I couldn't read the ${field === 'joiningDate' ? 'joining date' : 'date of birth'} "${said}".`);
    }
    // Only when the user talked about the account: in testing the model added status "active" to other changes.
    if (args.status && (ctx.fromButton || /\b(disabled?|enabled?|activate|deactivate|reactivate|block|unblock|suspend|active|inactive|login|sign in|access)\b/i.test(ctx.latestText))) {
      values.status = args.status;
    }

    const body = diffBody(current, values);
    const editButton: AiButton = { label: 'Edit in a form', toolCall: { name: 'update_employee', args: { employee: current.id }, form: true } };
    if (!Object.keys(body).length && !ctx.form) {
      const text = problems.length
        ? problems.join(' ')
        : `Nothing to change for **${current.name}**. Tell me what to change: name, email, job title, department, role, manager, joining date, date of birth or status.`;
      return { kind: 'ask', result: { text, buttons: [editButton] } };
    }
    // Ids are shown by name: the new ones from the lookups above, the old ones from the record.
    const shownAs = (key: string, raw: unknown, names: Record<string, string | null | undefined>) => {
      if (key in names) return dash(names[key]);
      if ((key === 'joiningDate' || key === 'dateOfBirth') && typeof raw === 'string') return formatDay(raw);
      return dash(raw as string | null);
    };
    const oldNames = { department: current.departmentName, roleId: current.roleName, reportsTo: current.reportsToName };
    const rows = Object.entries(body).map(([key, value]) => ({
      label: FIELD_TITLES[key],
      value: shownAs(key, value, value === null ? { ...shown, [key]: null } : shown),
      previous: shownAs(key, (current as unknown as Record<string, unknown>)[key], oldNames),
    }));
    const warnings = [...problems];
    if (body.email) warnings.push(`${current.name} will sign in with the new email from now on.`);
    if (body.status === 'disabled') warnings.push(`${current.name} will no longer be able to sign in.`);
    return {
      kind: 'card',
      card: {
        title: `Update ${current.name}`,
        tone: 'default',
        rows: rows.length ? rows : [{ label: 'Employee', value: `${current.name} (${current.email})` }],
        warnings,
        confirmLabel: 'Save',
        form: { kind: 'employee', mode: 'update', values },
        incomplete: rows.length === 0,
      },
      calls: rows.length ? [{ method: 'PUT', path: `/employees/${current.id}`, body }] : [],
      meta: { employeeId: current.id },
    };
  },

  async revise(pending, values, api) {
    const id = String(pending.meta.employeeId);
    const current = await api.get<EmployeeRow>(`/employees/${id}`);
    const body = diffBody(current, values as EmployeeFormValues);
    if (!Object.keys(body).length) throw new AiUserError('Nothing was changed.');
    const parsed = updateEmployeeSchema.safeParse(body);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'PUT', path: `/employees/${id}`, body: parsed.data }];
  },

  done([result], pending) {
    const row = result as EmployeeRow;
    const body = (pending.calls[0]?.body ?? {}) as Record<string, unknown>;
    const changes = Object.keys(body).map((key) => {
      const value =
        key === 'department' ? row.departmentName : key === 'roleId' ? row.roleName : key === 'reportsTo' ? row.reportsToName ?? 'nobody' : key === 'joiningDate' || key === 'dateOfBirth' ? (row[key] ? formatDay(row[key]!) : '—') : (row as unknown as Record<string, unknown>)[key];
      return `${FIELD_TITLES[key].toLowerCase()} is now ${dash(value as string)}`;
    });
    return { text: `✅ Updated **${row.name}**${changes.length ? `: ${andList(changes)}` : ''}.` };
  },
};

// ---------------------------------------------------------------- delete

const deleteInput = z.object({ employee: text('Name or email of the employee to remove') });

const deleteEmployee: AiTool<z.infer<typeof deleteInput>> = {
  name: 'delete_employee',
  label: 'Finding the employee',
  kind: 'write',
  adminOnly: true,
  description: 'Delete or remove an employee for good. Not for disabling an account (use update_employee with status). The admin must confirm.',
  input: deleteInput,

  async prepare(args, api) {
    const who = str(args.employee);
    if (!who) return { kind: 'ask', result: { text: 'Which employee do you want to remove?' } };
    const found = await findEmployee(api, who);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No employee matches "${who}".` } };
    // One at a time: chat never removes several employees in one go.
    if (found.kind === 'many') {
      return whichOne(`${found.items.length} employees match "${who}". Which one do you want to remove?`, found.items, (id) => ({ name: 'delete_employee', args: { employee: id } }));
    }
    const e = found.item;
    // The API refuses while people still report to them; say so now rather than after Confirm.
    const reports = await api
      .get<{ directReports?: Person[] }>(`/people/${e.id}`)
      .then((p) => p.directReports ?? [])
      .catch(() => [] as Person[]);
    if (reports.length) {
      const names = reports.map((r) => r.name);
      return {
        kind: 'ask',
        result: {
          text: `**${e.name}** still has ${reports.length === 1 ? 'someone' : `${reports.length} people`} reporting to them (${andList(names.slice(0, 5))}${names.length > 5 ? ', …' : ''}). Change their manager first, for example "Change ${names[0]}'s manager to …".`,
        },
      };
    }
    const card: ConfirmCard = {
      title: `Remove ${e.name}?`,
      tone: 'danger',
      rows: [
        { label: 'Department', value: dash(e.departmentName) },
        { label: 'Job title', value: dash(e.jobTitle) },
        { label: 'Email', value: e.email },
      ],
      notes: ['Their login stops working, and any running onboarding or offboarding is cancelled. This is the same as Delete on the Employees page.'],
      confirmLabel: 'Delete employee',
    };
    return { kind: 'card', card, calls: [{ method: 'DELETE', path: `/employees/${e.id}` }], meta: { employeeId: e.id, name: e.name } };
  },

  done(_results, pending) {
    return { text: `✅ **${String(pending.meta.name)}** was removed.` };
  },
};

// ---------------------------------------------------------------- module

export const employeeModule: AiModule = {
  key: 'employees',
  title: 'Employees assistant',
  intro: (role) =>
    role === 'ORG_ADMIN'
      ? 'Add, find, change or remove employees by typing or speaking. Every change waits for your Confirm.'
      : 'Find employees and count them by department.',
  requiredPermission: { module: 'employees', action: 'read' },
  starters: [
    { label: 'Add employee', toolCall: { name: 'create_employee', args: {}, form: true } },
    { label: 'Show all employees', toolCall: { name: 'list_employees', args: {} } },
    { label: 'Count by department', toolCall: { name: 'count_employees', args: {} } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'employees')}
You are the Employees assistant. You help ${ctx.role === 'ORG_ADMIN' ? 'create, find, update and remove employees' : 'find and count employees'}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- To disable or enable an account, call update_employee with status. Use delete_employee only when they say delete or remove.
- Fill in only details the user actually gave. Never make up an email, job title or anything else.
- Copy names, departments, roles and managers exactly as the user said them. The server finds the records.
- When the server says details are missing, ask the user for exactly those.
- Never say that an employee was created, changed or removed. The app shows that after the backend confirms it.`,
  tools: [listEmployees, countEmployees, createEmployee, updateEmployee, deleteEmployee],
};
