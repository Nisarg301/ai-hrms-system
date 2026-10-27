import { z } from 'zod';
import { isoDateSchema } from '../../validators/date';
import { objectIdSchema } from '../../validators/objectId';
import { ApiCallError } from '../apiClient';
import { formatDay, resolveDate } from '../dates';
import { basePrompt } from '../prompts/base.prompt';
import { andList, grounded, isBlank, matchByName, mergeArgs, orList, str, stripCommandWords } from '../text';
import { AiButton, AiModule, AiResult, AiTool, AiUserError, ApiClient, ConfirmCard, Prepared, ProjectFormValues, ToolContext } from '../types';
import {
  cleanProjectArgs,
  deadlineDay,
  deadlineInstant,
  dueRange,
  DueRange,
  fillProjectFromText,
  PROJECT_STATUSES,
  ProjectArgs,
  ProjectStatus,
  STATUS_LABELS,
  statusesIn,
  statusFromWords,
} from './project.helpers';

// The Projects assistant (docs/AI_PROJECTS_ASSISTANT.md). Reads and writes go through the
// existing /projects (and /tasks, for counts) endpoints with the user's own token. Unlike
// Employees, each tool follows the permission matrix: projects read/create/update/delete.

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  /** An instant (ISO); see deadlineDay(). */
  deadline: string;
  status: ProjectStatus;
}

const PAGE_SIZE = 20;
const OPEN_STATUSES = 'planning,active,on-hold';
const isObjectId = (value: string) => objectIdSchema.safeParse(value).success;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);
const STATUS_HINT = 'Status in the user\'s words, e.g. "on hold", "done", "in progress", "planning"';

// ---------------------------------------------------------------- lookups and display

/** The project the user means: by id, exact name, or a single search hit. */
async function findProject(api: ApiClient, said: string): Promise<{ kind: 'one'; item: ProjectRow } | { kind: 'none' } | { kind: 'many'; items: ProjectRow[] }> {
  const query = stripCommandWords(said);
  if (isObjectId(query)) {
    try {
      return { kind: 'one', item: await api.get<ProjectRow>(`/projects/${query}`) };
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 404) return { kind: 'none' };
      throw err;
    }
  }
  const hits = await api.get<ProjectRow[]>('/projects', { search: query.replace(/\bproject\b/gi, '').trim() || query, limit: 10 });
  const named = matchByName(hits, query, (p) => p.name, (p) => p.id);
  if (named.kind !== 'none') return named;
  return hits.length === 1 ? { kind: 'one', item: hits[0] } : hits.length ? { kind: 'many', items: hits } : { kind: 'none' };
}

/** How many tasks belong to the project, or null when the user may not read tasks. */
async function taskCount(api: ApiClient, projectId: string): Promise<number | null> {
  try {
    return (await api.page<unknown[]>('/tasks', { projectId, limit: 1 })).meta.total ?? null;
  } catch (err) {
    if (err instanceof ApiCallError && (err.status === 403 || err.status === 400)) return null;
    throw err;
  }
}

function deadlineText(p: ProjectRow, today: string): string {
  const day = deadlineDay(p.deadline);
  return `${formatDay(day)}${day < today && p.status !== 'completed' ? ' (overdue)' : ''}`;
}

function projectLine(p: ProjectRow, today: string, tasks: number | null): string {
  const parts = [STATUS_LABELS[p.status], `due ${deadlineText(p, today)}`, tasks === null ? null : `${tasks} task${tasks === 1 ? '' : 's'}`, p.description];
  return `**${p.name}** · ${parts.filter(Boolean).join(' · ')}`;
}

function whichOne(question: string, items: ProjectRow[], today: string, toolCall: (id: string) => AiButton['toolCall']): Extract<Prepared, { kind: 'ask' }> {
  return {
    kind: 'ask',
    result: { text: question, buttons: items.slice(0, 6).map((p) => ({ label: `${p.name} · due ${formatDay(deadlineDay(p.deadline))}`, toolCall: toolCall(p.id) })) },
  };
}

/**
 * The status to use from the model's words. Outside buttons it must be one the user actually
 * mentioned: in testing the model added "done" to unrelated requests. When the model's words
 * are unclear but the message names exactly one status, the user's word wins.
 */
function pickStatus(said: string | undefined, ctx: ToolContext): { status?: ProjectStatus; problem?: string } {
  if (!said) return {};
  const s = statusFromWords(said);
  if (ctx.fromButton) return s ? { status: s } : { problem: unknownStatus(said) };
  const mentioned = statusesIn(ctx.latestText);
  if (!mentioned.length) return {};
  if (s && mentioned.includes(s)) return { status: s };
  if (mentioned.length === 1) return { status: mentioned[0] };
  return { problem: unknownStatus(said) };
}

const unknownStatus = (said: string) => `"${said}" isn't a project status. Use ${orList(PROJECT_STATUSES.map((s) => STATUS_LABELS[s]))}.`;

/** Status and due words -> API filters, or the answer to give when the words make no sense. */
function readFilters(args: { status?: string; due?: string }, today: string): { status?: string; due?: DueRange; answer?: AiResult } {
  const statusWords = str(args.status);
  const status = statusWords ? statusFromWords(statusWords) : null;
  if (statusWords && !status) return { answer: { text: unknownStatus(statusWords) } };
  const dueWords = str(args.due);
  const due = dueWords ? dueRange(dueWords, today) : null;
  if (dueWords && !due) return { answer: { text: `I couldn't tell which deadlines "${dueWords}" means. Try overdue, this week, this month, or before 31 Dec.` } };
  // Overdue means not completed yet.
  return { status: status ?? (due?.overdue ? OPEN_STATUSES : undefined), due: due ?? undefined };
}

// ---------------------------------------------------------------- read tools

const listInput = z.object({
  search: text('Project name to search for'),
  status: text(STATUS_HINT),
  due: text('When the deadline falls, in the user\'s words: "overdue", "this week", "this month", "before 31 Dec"'),
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

const listProjects: AiTool<z.infer<typeof listInput>> = {
  name: 'list_projects',
  label: 'Looking up projects',
  kind: 'read',
  requires: 'read',
  description: "List or search projects. Use for 'show projects', 'find <name>', 'which projects are on hold', 'what is overdue', 'due this month'.",
  input: listInput,
  async run(args, api, ctx) {
    const filters = readFilters(args, ctx.today);
    if (filters.answer) return filters.answer;
    const search = str(args.search);
    const page = args.page ?? 1;
    const { data, meta } = await api.page<ProjectRow[]>('/projects', {
      search,
      status: filters.status,
      dueFrom: filters.due?.from,
      dueTo: filters.due?.to,
      page,
      limit: PAGE_SIZE,
      sortBy: 'deadline',
      sortDir: 'asc',
    });
    const total = meta.total ?? data.length;
    const statusWord = filters.status && !filters.due?.overdue ? `${STATUS_LABELS[filters.status as ProjectStatus].toLowerCase()} ` : '';
    const where = [search ? `matching "${search}"` : null, filters.due?.label ?? null].filter(Boolean).join(', ');
    const noun = `${statusWord}project${total === 1 ? '' : 's'}`;
    if (total === 0) return { text: where || statusWord ? `No ${noun}${where ? ` ${where}` : ''}.` : 'There are no projects yet.' };
    if (total === 1 && page === 1) return { text: projectLine(data[0], ctx.today, await taskCount(api, data[0].id)) };
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    return {
      text: `**${total} ${noun}**${where ? ` ${where}` : ''}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: {
        columns: [
          { key: 'name', title: 'Project' },
          { key: 'status', title: 'Status' },
          { key: 'deadline', title: 'Deadline' },
          { key: 'description', title: 'Description' },
        ],
        rows: data.map((p) => ({
          name: p.name,
          status: STATUS_LABELS[p.status],
          deadline: deadlineText(p, ctx.today),
          description: p.description.length > 60 ? `${p.description.slice(0, 57)}…` : p.description,
        })),
      },
      buttons: to < total ? [{ label: 'Show more', toolCall: { name: 'list_projects', args: { ...args, page: page + 1 } } }] : undefined,
    };
  },
};

const countInput = z.object({
  status: text(STATUS_HINT),
  due: text('When the deadline falls, in the user\'s words: "overdue", "this month"'),
});

const countProjects: AiTool<z.infer<typeof countInput>> = {
  name: 'count_projects',
  label: 'Counting projects',
  kind: 'read',
  requires: 'read',
  description: 'Count projects, optionally by status or deadline.',
  input: countInput,
  async run(args, api, ctx) {
    const filters = readFilters(args, ctx.today);
    if (filters.answer) return filters.answer;
    const count = async (status?: string) =>
      (await api.page<ProjectRow[]>('/projects', { status, dueFrom: filters.due?.from, dueTo: filters.due?.to, limit: 1 })).meta.total ?? 0;
    if (filters.status || filters.due) {
      const total = await count(filters.status);
      const statusWord = filters.status && !filters.due?.overdue ? `${STATUS_LABELS[filters.status as ProjectStatus].toLowerCase()} ` : '';
      const due = filters.due ? ` ${filters.due.overdue ? (total === 1 ? 'is overdue' : 'are overdue') : filters.due.label}` : '';
      return {
        text: `**${total} ${statusWord}project${total === 1 ? '' : 's'}**${due}.`,
        buttons: total ? [{ label: 'Show them', toolCall: { name: 'list_projects', args: { status: args.status, due: args.due } } }] : undefined,
      };
    }
    const counts = await Promise.all(PROJECT_STATUSES.map(async (s) => [s, await count(s)] as const));
    const total = counts.reduce((sum, [, n]) => sum + n, 0);
    return {
      text: `**${total} project${total === 1 ? '' : 's'}** in total.`,
      table: {
        columns: [
          { key: 'status', title: 'Status' },
          { key: 'count', title: 'Projects' },
        ],
        rows: counts.map(([s, n]) => ({ status: STATUS_LABELS[s], count: String(n) })),
      },
    };
  },
};

// ---------------------------------------------------------------- create

const createInput = z.object({
  name: text('Project name'),
  description: text('What the project is about'),
  deadline: text('Deadline in the user\'s words, e.g. "31 Dec", "next Friday", "end of the month"'),
  status: text(STATUS_HINT),
});

const REQUIRED = ['name', 'description', 'deadline'] as const;
const ASK_LABELS: Record<string, string> = { name: 'the **name**', description: 'a short **description**', deadline: 'the **deadline**' };

/** The form values the card edits, and what Confirm checks them against. */
const projectValuesSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().min(1, 'Description is required'),
  deadline: isoDateSchema,
  status: z.enum(PROJECT_STATUSES),
});

function projectBody(v: ProjectFormValues) {
  return { name: v.name.trim(), description: v.description.trim(), deadline: deadlineInstant(v.deadline), status: v.status };
}

const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_project', args: {}, form: true } };

const createProject: AiTool<z.infer<typeof createInput>> = {
  name: 'create_project',
  label: 'Preparing the new project',
  kind: 'write',
  requires: 'create',
  description: 'Create a new project. The user checks and confirms it before it is saved. Fill only what the user said.',
  input: createInput,

  async prepare(raw, api, ctx) {
    const draft = ctx.draft?.tool === 'create_project' ? ctx.draft : null;
    const given = cleanProjectArgs(raw, ctx.userText);
    const problems: string[] = [];
    const warnings: string[] = [];
    // As on update: a status or deadline counts only when the user's own words hold it.
    const picked = pickStatus(given.status, ctx);
    if (picked.problem) problems.push(picked.problem);
    if (picked.status) given.status = picked.status;
    else delete given.status;
    if (!ctx.fromButton && given.deadline && !grounded(given.deadline, ctx.latestText)) delete given.deadline;
    const args = mergeArgs<ProjectArgs>((draft?.args ?? {}) as ProjectArgs, given) as ProjectArgs;
    const status: ProjectStatus = (args.status as ProjectStatus | undefined) ?? 'planning';
    let deadline: string | undefined;
    if (args.deadline) {
      deadline = resolveDate(args.deadline, ctx.today) ?? undefined;
      if (!deadline) {
        problems.push(`I couldn't read the deadline "${args.deadline}".`);
        delete args.deadline;
      } else if (deadline < ctx.today) warnings.push(`The deadline ${formatDay(deadline)} is in the past.`);
    }
    if (args.name) {
      // Names aren't unique, so a second "Apollo" is allowed, but worth a warning.
      const same = (await api.get<ProjectRow[]>('/projects', { search: args.name, limit: 10 })).filter((p) => p.name.trim().toLowerCase() === args.name!.trim().toLowerCase());
      if (same.length) warnings.push(`A project called "${same[0].name}" already exists (due ${formatDay(deadlineDay(same[0].deadline))}).`);
    }

    const values: ProjectFormValues = { name: args.name ?? '', description: args.description ?? '', deadline: deadline ?? '', status };
    const missing = REQUIRED.filter((f) => !values[f]);
    if (missing.length && !ctx.form) {
      const what = `${args.name ?? 'the project'}${deadline ? `, due ${formatDay(deadline)}` : ''}`;
      return {
        kind: 'ask',
        result: { text: `${problems.length ? `${problems.join(' ')} ` : ''}I'll create ${what}. I still need ${andList(missing.map((f) => ASK_LABELS[f]))}.`, buttons: [formButton], warnings },
        draft: {
          tool: 'create_project',
          args: Object.fromEntries(Object.entries({ name: args.name, description: args.description, deadline, status: args.status ? status : undefined }).filter(([, v]) => v)),
          missing,
          notSaved: [],
        },
      };
    }
    const card: ConfirmCard = {
      title: 'New project',
      tone: 'default',
      rows: [
        { label: 'Name', value: values.name || '—' },
        { label: 'Description', value: values.description || '—' },
        { label: 'Deadline', value: deadline ? formatDay(deadline) : '—' },
        { label: 'Status', value: STATUS_LABELS[status] },
      ],
      warnings: [...problems, ...warnings],
      confirmLabel: 'Create project',
      form: { kind: 'project', mode: 'create', values },
      incomplete: missing.length > 0,
    };
    return { kind: 'card', card, calls: missing.length ? [] : [{ method: 'POST', path: '/projects', body: projectBody(values) }] };
  },

  async fillFromReply(draft, reply, _api, ctx) {
    if (draft.tool !== 'create_project') return null;
    return fillProjectFromText(draft.missing, reply, ctx.today);
  },

  async revise(_pending, values) {
    const parsed = projectValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/projects', body: projectBody(parsed.data) }];
  },

  done([result]) {
    const p = result as ProjectRow;
    return { text: `✅ **Project created:** ${p.name} · due ${formatDay(deadlineDay(p.deadline))} · ${STATUS_LABELS[p.status]}.` };
  },
};

// ---------------------------------------------------------------- update

const updateInput = z
  .object({
    project: text('Name of the project to change'),
    newName: text('New name, only when renaming'),
    description: text('New description'),
    deadline: text('New deadline in the user\'s words'),
    status: text(STATUS_HINT),
  })
  // Kept: the model sometimes sends `name` for the project itself (see prepare).
  .passthrough();

const FIELD_TITLES: Record<keyof ProjectFormValues, string> = { name: 'Name', description: 'Description', deadline: 'Deadline', status: 'Status' };

function toValues(p: ProjectRow): ProjectFormValues {
  return { name: p.name, description: p.description, deadline: deadlineDay(p.deadline), status: p.status };
}

/** The changed fields, as API values. */
function diffValues(current: ProjectRow, v: ProjectFormValues): Partial<ProjectFormValues> {
  const before = toValues(current);
  const changed: Partial<ProjectFormValues> = {};
  (Object.keys(FIELD_TITLES) as (keyof ProjectFormValues)[]).forEach((key) => {
    if (String(v[key]).trim() !== String(before[key]).trim()) (changed as Record<string, string>)[key] = String(v[key]).trim();
  });
  return changed;
}

function putBody(changed: Partial<ProjectFormValues>) {
  return changed.deadline ? { ...changed, deadline: deadlineInstant(changed.deadline) } : { ...changed };
}

const shown = (key: keyof ProjectFormValues, value: string) =>
  key === 'deadline' ? formatDay(value) : key === 'status' ? STATUS_LABELS[value as ProjectStatus] : value;

const updateProject: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_project',
  label: 'Preparing the change',
  kind: 'write',
  requires: 'update',
  description: 'Change a project: rename it, change its description, move its deadline, or change its status (e.g. put on hold, mark done). The user confirms before saving.',
  input: updateInput,

  async prepare(input, api, ctx) {
    // "Put Apollo on hold" sometimes arrives as { name: "Apollo" }: without `project`, that's the project.
    const args: Record<string, unknown> = { ...input };
    if (str(args.name)) {
      if (!str(args.project)) args.project = args.name;
      else if (!str(args.newName)) args.newName = args.name;
      delete args.name;
    }
    const which = str(args.project);
    if (!which) return { kind: 'ask', result: { text: 'Which project do you want to change?' } };
    const found = await findProject(api, which);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No project matches "${which}".` } };
    if (found.kind === 'many') {
      return whichOne(`${found.items.length} projects match "${which}". Which one?`, found.items, ctx.today, (id) => ({ name: 'update_project', args: { ...args, project: id } }));
    }
    const current = found.item;
    const values = toValues(current);
    const problems: string[] = [];
    const warnings: string[] = [];

    const name = str(args.newName);
    if (name && grounded(name, ctx.userText)) values.name = name;
    const description = str(args.description);
    if (description && grounded(description, ctx.userText)) values.description = description;
    // A deadline or status the user never mentioned is the model's invention ("move the
    // deadline" came back with status "done" in testing): only words from the message count.
    const deadlineWords = str(args.deadline) && (ctx.fromButton || grounded(String(args.deadline), ctx.latestText)) ? str(args.deadline) : undefined;
    if (deadlineWords) {
      const day = resolveDate(deadlineWords, ctx.today);
      if (day) {
        values.deadline = day;
        if (day < ctx.today) warnings.push(`The new deadline ${formatDay(day)} is in the past.`);
      } else problems.push(`I couldn't read the deadline "${deadlineWords}".`);
    }
    const picked = pickStatus(str(args.status), ctx);
    if (picked.status) values.status = picked.status;
    if (picked.problem) problems.push(picked.problem);

    const changed = diffValues(current, values);
    const keys = Object.keys(changed) as (keyof ProjectFormValues)[];
    const editButton: AiButton = { label: 'Edit in a form', toolCall: { name: 'update_project', args: { project: current.id }, form: true } };
    if (!keys.length && !ctx.form) {
      const textOut = problems.length ? problems.join(' ') : `Nothing to change for **${current.name}**. Tell me what to change: name, description, deadline or status.`;
      return { kind: 'ask', result: { text: textOut, buttons: [editButton] } };
    }
    const before = toValues(current);
    return {
      kind: 'card',
      card: {
        title: `Update ${current.name}`,
        tone: 'default',
        rows: keys.length
          ? keys.map((key) => ({ label: FIELD_TITLES[key], value: shown(key, changed[key]!), previous: shown(key, before[key]) }))
          : [{ label: 'Project', value: current.name }],
        warnings: [...problems, ...warnings],
        confirmLabel: 'Save',
        form: { kind: 'project', mode: 'update', values },
        incomplete: keys.length === 0,
      },
      calls: keys.length ? [{ method: 'PUT', path: `/projects/${current.id}`, body: putBody(changed) }] : [],
      meta: { projectId: current.id },
    };
  },

  async revise(pending, values, api) {
    const parsed = projectValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const id = String(pending.meta.projectId);
    const changed = diffValues(await api.get<ProjectRow>(`/projects/${id}`), parsed.data);
    if (!Object.keys(changed).length) throw new AiUserError('Nothing was changed.');
    return [{ method: 'PUT', path: `/projects/${id}`, body: putBody(changed) }];
  },

  done([result], pending) {
    const p = result as ProjectRow;
    const body = (pending.calls[0]?.body ?? {}) as Record<string, unknown>;
    const now = toValues(p);
    const changes = (Object.keys(body) as (keyof ProjectFormValues)[]).map((key) => `${FIELD_TITLES[key].toLowerCase()} is now ${shown(key, now[key])}`);
    return { text: `✅ Updated **${p.name}**${changes.length ? `: ${andList(changes)}` : ''}.` };
  },
};

// ---------------------------------------------------------------- delete

const deleteInput = z.object({ project: text('Name of the project to delete') });

const deleteProject: AiTool<z.infer<typeof deleteInput>> = {
  name: 'delete_project',
  label: 'Finding the project',
  kind: 'write',
  requires: 'delete',
  description: 'Delete a project for good. The user must confirm.',
  input: deleteInput,

  async prepare(args, api, ctx) {
    const which = str(args.project);
    if (!which) return { kind: 'ask', result: { text: 'Which project do you want to delete?' } };
    const found = await findProject(api, which);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No project matches "${which}".` } };
    // One at a time: chat never deletes several projects in one go.
    if (found.kind === 'many') {
      return whichOne(`${found.items.length} projects match "${which}". Which one do you want to delete?`, found.items, ctx.today, (id) => ({ name: 'delete_project', args: { project: id } }));
    }
    const p = found.item;
    const tasks = await taskCount(api, p.id);
    return {
      kind: 'card',
      card: {
        title: `Delete ${p.name}?`,
        tone: 'danger',
        rows: [
          { label: 'Deadline', value: deadlineText(p, ctx.today) },
          { label: 'Status', value: STATUS_LABELS[p.status] },
          { label: 'Description', value: p.description },
        ],
        warnings: tasks ? [`${tasks} task${tasks === 1 ? ' is' : 's are'} linked to this project. ${tasks === 1 ? 'It is' : 'They are'} kept, but will show the project as "Unknown".`] : [],
        notes: ['This is the same as Delete on the Projects page.'],
        confirmLabel: 'Delete project',
      },
      calls: [{ method: 'DELETE', path: `/projects/${p.id}` }],
      meta: { projectId: p.id, name: p.name },
    };
  },

  done(_results, pending) {
    return { text: `✅ **${String(pending.meta.name)}** was deleted.` };
  },
};

// ---------------------------------------------------------------- module

const READ_TOOLS = ['list_projects', 'count_projects'];

export const projectModule: AiModule = {
  key: 'projects',
  title: 'Projects assistant',
  intro: () => 'Ask about projects, or create and change them by typing or speaking. Every change waits for your Confirm.',
  requiredPermission: { module: 'projects', action: 'read' },
  starters: [
    { label: 'New project', toolCall: { name: 'create_project', args: {}, form: true } },
    { label: 'Show all projects', toolCall: { name: 'list_projects', args: {} } },
    { label: "What's overdue?", toolCall: { name: 'list_projects', args: { due: 'overdue' } } },
    { label: 'Count by status', toolCall: { name: 'count_projects', args: {} } },
  ],
  systemPrompt: (ctx) => {
    const writes = ctx.tools.some((t) => !READ_TOOLS.includes(t));
    return `${basePrompt(ctx, 'projects')}
You are the Projects assistant. You help list, find and count projects${writes ? ', and create, change or delete them' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a description or a deadline.
- Copy project names, statuses and dates exactly as the user said them. The server finds the projects and works out the dates.${
      writes ? '\n- To change a status or a deadline, call update_project.' : ''
    }
- Never say that a project was created, changed or deleted. The app shows that after the backend confirms it.`;
  },
  tools: [listProjects, countProjects, createProject, updateProject, deleteProject],
};
