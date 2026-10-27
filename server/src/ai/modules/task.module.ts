import { z } from 'zod';
import { isoDateSchema } from '../../validators/date';
import { objectIdSchema } from '../../validators/objectId';
import { ApiCallError } from '../apiClient';
import { dueRange, formatDay, resolveDate } from '../dates';
import { basePrompt } from '../prompts/base.prompt';
import { andList, grounded, isBlank, Match, matchByName, mentions, mergeArgs, norm, orList, str } from '../text';
import { AiButton, AiModule, AiResult, AiTool, AiUserError, ApiClient, ConfirmCard, Prepared, TaskFormValues, ToolContext } from '../types';
import {
  asksToCreate,
  asksToDelete,
  asksToMove,
  changesDueDate,
  cleanTaskArgs,
  cleanTitle,
  colonDescription,
  fillTaskFromText,
  groundedNames,
  heardText,
  isMe,
  memberChange,
  MemberChange,
  membersFromMessage,
  OPEN_STATUSES,
  readStatuses,
  sameText,
  splitNames,
  STATUS_LABELS,
  statusStatement,
  statusesIn,
  statusFromWords,
  TASK_STATUSES,
  TaskArgs,
  taskFromMessage,
  taskQuery,
  TaskStatus,
  taskWords,
  titleHasWords,
  whoseTasks,
} from './task.helpers';

// The Tasks assistant (docs/AI_TASKS_ASSISTANT.md). Reads and writes go through the existing
// /tasks endpoints with the user's own token; projects come from /projects and members from
// /people/search. Each tool follows the permission matrix: tasks read/create/update/delete.

interface TaskRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  status: TaskStatus;
  userId: string[];
  /** The members' names, joined by commas. */
  userName: string;
}
interface ProjectRef {
  id: string;
  name: string;
}
interface Person {
  id: string;
  name: string;
  role?: string;
}

const PAGE_SIZE = 20;
const isObjectId = (value: string) => objectIdSchema.safeParse(value).success;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);
// Members may come as a list.
const names = (description: string) =>
  z
    .preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') || undefined : isBlank(v) ? undefined : String(v)), z.string().optional())
    .describe(description);
// Short labels only: in testing the model copied longer hints in as values ("What the task is about").
const STATUS_HINT = 'Status';

// ---------------------------------------------------------------- display

/** "Fri 23 Oct 2026", or the stored text when it isn't a real day (the API checks only the format). */
const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? formatDay(d) : d);
const memberNames = (t: TaskRow) => (t.userName ? t.userName.split(',').map((n) => n.trim()).filter(Boolean) : []);
const dueText = (t: TaskRow, today: string) => `${day(t.dueDate)}${t.dueDate < today && t.status !== 'done' ? ' (overdue)' : ''}`;
const short = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 3)}…` : s);
const tasks = (n: number) => `task${n === 1 ? '' : 's'}`;

function taskLine(t: TaskRow, today: string): string {
  const members = memberNames(t);
  const parts = [STATUS_LABELS[t.status], `due ${dueText(t, today)}`, t.projectName, members.length ? andList(members) : 'no members', t.description];
  return `**${t.title}** · ${parts.join(' · ')}`;
}

function whichTask(question: string, items: TaskRow[], toolCall: (id: string) => AiButton['toolCall']): Extract<Prepared, { kind: 'ask' }> {
  return {
    kind: 'ask',
    result: { text: question, buttons: items.slice(0, 6).map((t) => ({ label: `${t.title} · ${t.projectName} · due ${day(t.dueDate)}`, toolCall: toolCall(t.id) })) },
  };
}

// ---------------------------------------------------------------- lookups

/** Every project the user can see, for matching by name; null when their role can't read projects. */
async function loadProjects(api: ApiClient): Promise<ProjectRef[] | null> {
  try {
    return (await api.get<ProjectRef[]>('/projects', { limit: 100, sortBy: 'name', sortDir: 'asc' })).map((p) => ({ id: p.id, name: p.name }));
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 403) return null;
    throw err;
  }
}

const NO_PROJECTS = "Your role can't read projects, so I can't look one up. The projects permission is needed for this.";
const matchProject = (projects: ProjectRef[], said: string): Match<ProjectRef> => matchByName(projects, said, (p) => p.name, (p) => p.id);
const projectOptions = (projects: ProjectRef[]) => (projects.length && projects.length <= 8 ? ` (${orList(projects.map((p) => p.name))})` : '');
const noProject = (said: string, projects: ProjectRef[]) => `There is no project called "${said}".${projects.length ? ` Projects: ${andList(projects.slice(0, 12).map((p) => p.name))}.` : ''}`;

/**
 * The person the user named: themselves for "me", or one active person by name. Members must be
 * employees (`employeesOnly`), as on the Tasks page; a list filter may name anyone.
 */
async function findPerson(api: ApiClient, ctx: ToolContext, said: string, employeesOnly: boolean): Promise<Match<Person>> {
  // "Me" is looked up like anyone else, so the card shows the name the task will show.
  const ref = isMe(said) ? ctx.user.id : said;
  if (isObjectId(ref)) {
    try {
      return { kind: 'one', item: await api.get<Person>(`/people/${ref}`) };
    } catch (err) {
      if (!(err instanceof ApiCallError && err.status === 404)) throw err;
      return ref === ctx.user.id ? { kind: 'one', item: { id: ctx.user.id, name: ctx.user.name ?? 'You', role: ctx.user.role } } : { kind: 'none' };
    }
  }
  const hits = (await api.get<Person[]>('/people/search', { q: said })).filter((p) => !employeesOnly || p.role === 'ORG_USER');
  return matchByName(hits, said, (p) => p.name, (p) => p.id);
}

interface Members {
  people: Person[];
  problems: string[];
  /** Several people match this name: the user picks one. */
  choose?: { name: string; options: Person[] };
}

/** Each named member as an employee: the ones found, what went wrong, or a name to choose for. */
async function resolveMembers(api: ApiClient, ctx: ToolContext, said: string[]): Promise<Members> {
  const out: Members = { people: [], problems: [] };
  for (const name of said) {
    const found = await findPerson(api, ctx, name, true);
    if (found.kind === 'many') return { ...out, choose: { name, options: found.items } };
    if (found.kind === 'none') out.problems.push(`No employee is called "${name}".`);
    else if (found.item.role && found.item.role !== 'ORG_USER') {
      out.problems.push(isMe(name) ? "You can't be a member: tasks go to employees, as on the Tasks page." : `${found.item.name} isn't an employee: tasks go to employees, as on the Tasks page.`);
    } else if (!out.people.some((p) => p.id === found.item.id)) out.people.push(found.item);
  }
  return out;
}

/** "Which Mike?": buttons that keep the members found so far and add the one picked. */
function whichPerson(tool: string, args: Record<string, unknown>, found: Members): Extract<Prepared, { kind: 'ask' }> {
  const { name, options } = found.choose!;
  return {
    kind: 'ask',
    result: {
      text: `${options.length} people match "${name}". Which one?`,
      buttons: options.slice(0, 6).map((p) => ({ label: p.name, toolCall: { name: tool, args: { ...args, members: [...found.people.map((x) => x.id), p.id].join(', ') } } })),
    },
  };
}

/** The task the user means: by id, by its title, or by its words in any order ("the login bug"). */
async function findTask(api: ApiClient, said: string, projectId?: string): Promise<Match<TaskRow>> {
  const query = taskQuery(said);
  if (isObjectId(query)) {
    try {
      return { kind: 'one', item: await api.get<TaskRow>(`/tasks/${query}`) };
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 404) return { kind: 'none' };
      throw err;
    }
  }
  let hits = await api.get<TaskRow[]>('/tasks', { search: query, limit: 20 });
  const words = taskWords(query);
  if (!hits.length && words.length > 1) {
    // Titles holding the words in any order; failing that, all of them but one ("The login bug is
    // fixed finally" for "Fix the login bug"), from searches on the three longest words.
    const longest = [...words].sort((a, b) => b.length - a.length).slice(0, 3);
    const pool = new Map<string, TaskRow>();
    for (const word of longest) (await api.get<TaskRow[]>('/tasks', { search: word, limit: 50 })).forEach((t) => pool.set(t.id, t));
    const score = (t: TaskRow) => words.filter((w) => norm(t.title).includes(w)).length;
    hits = [...pool.values()].filter((t) => titleHasWords(t.title, words));
    if (!hits.length) hits = [...pool.values()].filter((t) => score(t) >= words.length - 1);
  }
  // A project named alongside ("the login bug in Apollo") tells tasks apart.
  const inProject = projectId ? hits.filter((t) => t.projectId === projectId) : [];
  if (inProject.length) hits = inProject;
  // Only an exact title wins outright. Unlike names, a title that merely starts with the words
  // ("Login bug follow-up" for "login bug") is no better a match than one that holds them.
  const exact = hits.filter((t) => norm(t.title) === norm(query));
  if (exact.length === 1) return { kind: 'one', item: exact[0] };
  return hits.length === 1 ? { kind: 'one', item: hits[0] } : hits.length ? { kind: 'many', items: hits } : { kind: 'none' };
}

// ---------------------------------------------------------------- status

const unknownStatus = (said: string) => `"${said}" isn't a task status. Use ${orList(TASK_STATUSES.map((s) => STATUS_LABELS[s]))}.`;

/** The text without one occurrence of each word: a task's own words ("Fix the done button") aren't a status. */
function without(textIn: string, words: string[]): string {
  let t = ` ${norm(textIn)} `;
  for (const w of words) t = t.replace(` ${w} `, ' ');
  return t;
}

/**
 * The status to use from the model's words. Outside buttons it must be one the user mentioned
 * in `said` (the latest message, without the task's own words). When the model's words are
 * unclear but the message names exactly one status, the user's word wins.
 */
function pickStatus(words: string | undefined, ctx: ToolContext, said = ctx.latestText): { status?: TaskStatus; problem?: string } {
  if (!words) return {};
  const s = statusFromWords(words);
  if (ctx.fromButton) return s ? { status: s } : { problem: unknownStatus(words) };
  const mentioned = statusesIn(said);
  if (!mentioned.length) return {};
  if (s && mentioned.includes(s)) return { status: s };
  if (mentioned.length === 1) return { status: mentioned[0] };
  return { problem: unknownStatus(words) };
}

// ---------------------------------------------------------------- read tools

interface ReadArgs {
  search?: string;
  status?: string;
  due?: string;
  project?: string;
  member?: string;
}

interface Filters {
  query: Record<string, unknown>;
  /** One status filter, or the open ones. */
  statuses?: TaskStatus[];
  overdue: boolean;
  /** "in Apollo", "assigned to you", "due this week". */
  where: string[];
  answer?: AiResult;
}

/**
 * The model's filter words → API filters, or the answer to give instead ("Which Mike?").
 * Outside buttons a filter counts only when its words are in the user's message.
 */
async function readFilters(args: ReadArgs, api: ApiClient, ctx: ToolContext, tool: string): Promise<Filters> {
  const heard = (value: string | undefined) => (value && (ctx.fromButton || isMe(value) || grounded(value, ctx.latestText)) ? value : undefined);
  const out: Filters = { query: {}, overdue: false, where: [] };
  const search = heard(str(args.search));
  if (search) {
    out.query.search = taskQuery(search);
    out.where.push(`matching "${taskQuery(search)}"`);
  }
  // The model fills every filter, often with words from another one ("What's overdue?" came back
  // with status "What is overdue", "Show my open tasks" with due "open"). A filter that reads as
  // nothing is dropped; only a plain unknown word ("archived") or date gets a question.
  // A recovered broken call for "Which tasks are blocked?" had no status: the one the message names counts.
  const named = !str(args.status) && !str(args.search) && !ctx.fromButton ? statusesIn(ctx.latestText) : [];
  const statusWords = heard(str(args.status)) ?? (named.length === 1 ? named[0] : undefined);
  let dueFromStatus: string | undefined;
  if (statusWords) {
    const statuses = readStatuses(statusWords);
    if (statuses) out.statuses = statuses;
    // "What's overdue?" came back as status "overdue": words that read as a due date are one.
    else if (dueRange(statusWords, ctx.today)) dueFromStatus = statusWords;
    else if (/^\p{L}+$/u.test(statusWords) && !/^status(?:es)?$/i.test(statusWords)) return { ...out, answer: { text: unknownStatus(statusWords) } };
  }
  const dueWords = heard(str(args.due)) ?? dueFromStatus;
  const due = dueWords ? dueRange(dueWords, ctx.today) : null;
  if (dueWords && !due && TIME_WORDS.test(norm(dueWords))) {
    return { ...out, answer: { text: `I couldn't tell which due dates "${dueWords}" means. Try overdue, this week, this month, or before 31 Dec.` } };
  }
  if (due) {
    out.query.dueFrom = due.from;
    out.query.dueTo = due.to;
    // Overdue means not done yet.
    if (due.overdue) {
      out.overdue = true;
      out.statuses ??= OPEN_STATUSES;
    } else out.where.push(due.label);
  }
  const projectWords = heard(str(args.project));
  if (projectWords) {
    const projects = await loadProjects(api);
    if (!projects) return { ...out, answer: { text: NO_PROJECTS } };
    const m = matchProject(projects, projectWords);
    if (m.kind === 'none') return { ...out, answer: { text: noProject(projectWords, projects) } };
    if (m.kind === 'many') {
      const buttons = m.items.slice(0, 6).map((p) => ({ label: p.name, toolCall: { name: tool, args: { ...args, project: p.id } } }));
      return { ...out, answer: { text: `${m.items.length} projects match "${projectWords}". Which one?`, buttons } };
    }
    out.query.projectId = m.item.id;
    out.where.push(`in ${m.item.name}`);
  }
  // "Show the tasks in Hermes" came back with member "Hermes" too: a member that repeats another filter isn't one.
  const repeats = (value: string) => [args.project, args.search, args.status].some((v) => str(v) && norm(String(v)) === norm(value));
  const modelMember = str(args.member) && (ctx.fromButton || (groundedNames([String(args.member)], ctx.userText).length && !repeats(String(args.member)))) ? str(args.member) : undefined;
  // The model sometimes drops the person ("What is Mike Johnson working on?"): the message names them.
  const inferred = modelMember || ctx.fromButton ? undefined : whoseTasks(ctx.latestText);
  let memberWords = modelMember ?? inferred;
  if (inferred && repeats(inferred)) memberWords = undefined;
  else if (inferred && !out.query.projectId) {
    // "Show Apollo's tasks": the possessive names a project, not a person.
    const projects = await loadProjects(api);
    const m = projects ? matchProject(projects, inferred) : null;
    if (m?.kind === 'one') {
      out.query.projectId = m.item.id;
      out.where.push(`in ${m.item.name}`);
      memberWords = undefined;
    }
  }
  if (memberWords) {
    const found = await findPerson(api, ctx, memberWords, false);
    if (found.kind === 'none') return { ...out, answer: { text: `No one is called "${memberWords}".` } };
    if (found.kind === 'many') {
      const buttons = found.items.slice(0, 6).map((p) => ({ label: p.name, toolCall: { name: tool, args: { ...args, member: p.id } } }));
      return { ...out, answer: { text: `${found.items.length} people match "${memberWords}". Which one?`, buttons } };
    }
    out.query.memberId = found.item.id;
    out.where.push(found.item.id === ctx.user.id ? 'assigned to you' : `for ${found.item.name}`);
  }
  if (out.statuses) out.query.status = out.statuses.join(',');
  return out;
}

// Words that make due-date words a real attempt at a date, worth a question when unreadable.
const TIME_WORDS =
  /\d|\b(?:today|tomorrow|yesterday|week|month|year|overdue|late|before|after|until|till|since|next|last|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/;

/** "open", "blocked", "overdue": the word before "task" in an answer. */
function statusWord(f: Filters): string {
  if (f.overdue) return 'overdue ';
  if (!f.statuses) return '';
  if (f.statuses.length > 1) return 'open ';
  return { todo: 'to-do ', 'in-progress': 'in-progress ', done: 'done ', blocked: 'blocked ' }[f.statuses[0]];
}

const readInput = {
  status: text(STATUS_HINT),
  due: text('Due date'),
  project: text('Project'),
  member: text('Member name, or me'),
};

const listInput = z.object({
  search: text('Title words'),
  ...readInput,
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

const listTasks: AiTool<z.infer<typeof listInput>> = {
  name: 'list_tasks',
  label: 'Looking up tasks',
  kind: 'read',
  requires: 'read',
  description: 'Show or search tasks, by status, due date, project or member. Only for looking at tasks, not for changing them.',
  input: listInput,
  async run(args, api, ctx) {
    const f = await readFilters(args, api, ctx, 'list_tasks');
    if (f.answer) return f.answer;
    const page = args.page ?? 1;
    const { data, meta } = await api.page<TaskRow[]>('/tasks', { ...f.query, page, limit: PAGE_SIZE, sortBy: 'dueDate', sortDir: 'asc' });
    const total = meta.total ?? data.length;
    const where = f.where.length ? ` ${f.where.join(', ')}` : '';
    const noun = `${statusWord(f)}${tasks(total)}`;
    if (total === 0) return { text: where || f.statuses ? `No ${noun}${where}.` : 'There are no tasks yet.' };
    if (total === 1 && page === 1) return { text: taskLine(data[0], ctx.today) };
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    return {
      text: `**${total} ${noun}**${where}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: {
        columns: [
          { key: 'title', title: 'Task' },
          { key: 'project', title: 'Project' },
          { key: 'members', title: 'Members' },
          { key: 'due', title: 'Due date' },
          { key: 'status', title: 'Status' },
        ],
        rows: data.map((t) => ({ title: short(t.title), project: t.projectName, members: andList(memberNames(t)) || '—', due: dueText(t, ctx.today), status: STATUS_LABELS[t.status] })),
      },
      buttons: to < total ? [{ label: 'Show more', toolCall: { name: 'list_tasks', args: { ...args, page: page + 1 } } }] : undefined,
    };
  },
};

const countInput = z.object(readInput);

const countTasks: AiTool<z.infer<typeof countInput>> = {
  name: 'count_tasks',
  label: 'Counting tasks',
  kind: 'read',
  requires: 'read',
  description: 'Count tasks, optionally by status, due date, project or member.',
  input: countInput,
  async run(args, api, ctx) {
    const f = await readFilters(args, api, ctx, 'count_tasks');
    if (f.answer) return f.answer;
    const where = f.where.length ? ` ${f.where.join(', ')}` : '';
    const count = async (status?: string) => (await api.page<TaskRow[]>('/tasks', { ...f.query, status, limit: 1 })).meta.total ?? 0;
    if (f.statuses) {
      const total = await count(f.statuses.join(','));
      return {
        text: f.overdue ? `**${total} ${tasks(total)}** ${total === 1 ? 'is' : 'are'} overdue${where}.` : `**${total} ${statusWord(f)}${tasks(total)}**${where}.`,
        buttons: total ? [{ label: 'Show them', toolCall: { name: 'list_tasks', args: { ...args } } }] : undefined,
      };
    }
    const counts = await Promise.all(TASK_STATUSES.map(async (s) => [s, await count(s)] as const));
    const total = counts.reduce((sum, [, n]) => sum + n, 0);
    if (!where) {
      return {
        text: `**${total} ${tasks(total)}** in total.`,
        table: {
          columns: [
            { key: 'status', title: 'Status' },
            { key: 'count', title: 'Tasks' },
          ],
          rows: counts.map(([s, n]) => ({ status: STATUS_LABELS[s], count: String(n) })),
        },
      };
    }
    const split = counts.filter(([, n]) => n > 0).map(([s, n]) => `${n} ${STATUS_LABELS[s]}`);
    return {
      text: `**${total} ${tasks(total)}**${where}${split.length > 1 ? `: ${andList(split)}` : ''}.`,
      buttons: total ? [{ label: 'Show them', toolCall: { name: 'list_tasks', args: { ...args } } }] : undefined,
    };
  },
};

// ---------------------------------------------------------------- create

const createInput = z
  .object({
    title: text('Title'),
    description: text('Description'),
    dueDate: text('Due date'),
    project: text('Project'),
    members: names('Member names, or me'),
    status: text(STATUS_HINT),
  })
  // Kept: the model sometimes sends `name` for the title or `assignee` for the members.
  .passthrough();

const REQUIRED = ['title', 'description', 'dueDate', 'project', 'members'] as const;
const ASK_LABELS: Record<(typeof REQUIRED)[number], string> = {
  title: 'the **title**',
  description: 'a short **description**',
  dueDate: 'the **due date**',
  project: 'the **project**',
  members: '**who works on it**',
};

/** The form values the card edits, and what Confirm checks them against (as createTaskSchema does). */
const taskValuesSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  dueDate: isoDateSchema,
  status: z.enum(TASK_STATUSES),
  projectId: objectIdSchema,
  userId: z.array(objectIdSchema).min(1, 'Member is required'),
});

function taskBody(v: TaskFormValues) {
  return { title: v.title.trim(), description: v.description.trim(), dueDate: v.dueDate, status: v.status, projectId: v.projectId, userId: [...new Set(v.userId)] };
}

const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_task', args: {}, form: true } };

const createTask: AiTool<z.infer<typeof createInput>> = {
  name: 'create_task',
  label: 'Preparing the new task',
  kind: 'write',
  requires: 'create',
  description: 'Create a new task, only when the user asks to create or add one. The user confirms it before it is saved.',
  input: createInput,

  async prepare(raw, api, ctx) {
    const draft = ctx.draft?.tool === 'create_task' ? ctx.draft : null;
    // The model sometimes calls create_task for a change ("Login bug wala task done kar do"):
    // without a word for creating, a status in the message makes it an update.
    if (!ctx.fromButton && !ctx.form && !draft && !asksToCreate(ctx.latestText) && statusesIn(ctx.latestText).length) {
      return { kind: 'reroute', tool: 'update_task', args: { task: str(raw.title) ?? ctx.latestText } };
    }
    const given = cleanTaskArgs(raw, ctx.userText, ctx.latestText, ctx.fromButton);
    // "Add a task X, due 30 Oct: cover login and signup": what follows the colon is the description.
    if (!ctx.fromButton && !given.description && !draft?.args.description) {
      const described = colonDescription(ctx.latestText);
      if (described && !(given.title && sameText(described, given.title))) given.description = described;
    }
    const problems: string[] = [];
    const warnings: string[] = [];
    // A status counts only when the user's own words hold it (the model adds one unasked).
    const picked = pickStatus(given.status, ctx);
    if (picked.problem) problems.push(picked.problem);
    if (picked.status) given.status = picked.status;
    else delete given.status;
    const args = mergeArgs<TaskArgs>((draft?.args ?? {}) as TaskArgs, given) as TaskArgs;
    const status = (args.status as TaskStatus | undefined) ?? 'todo';

    const projects = await loadProjects(api);
    if (!projects) return { kind: 'ask', result: { text: NO_PROJECTS } };
    if (!projects.length) return { kind: 'ask', result: { text: 'There are no projects yet, and every task belongs to one. Create a project first, on the Projects page.' } };
    let project: ProjectRef | null = projects.length === 1 ? projects[0] : null;
    if (args.project) {
      const m = matchProject(projects, args.project);
      if (m.kind === 'many') {
        const buttons = m.items.slice(0, 6).map((p) => ({ label: p.name, toolCall: { name: 'create_task', args: { project: p.id } } }));
        return { kind: 'ask', result: { text: `${m.items.length} projects match "${args.project}". Which one?`, buttons }, draft: { tool: 'create_task', args: { ...args, project: undefined }, missing: ['project'], notSaved: [] } };
      }
      if (m.kind === 'one') project = m.item;
      else {
        problems.push(noProject(args.project, projects));
        delete args.project;
      }
    } else if (!project && !ctx.fromButton) {
      // The model left the project out, but the message names exactly one ("… in Apollo").
      const named = projects.filter((p) => mentions(ctx.latestText, p.name));
      if (named.length === 1) project = named[0];
    }

    let members: Person[] = [];
    if (args.members?.length) {
      const found = await resolveMembers(api, ctx, args.members);
      if (found.choose) {
        const keep = { ...args, members: undefined };
        return { ...whichPerson('create_task', {}, found), draft: { tool: 'create_task', args: keep, missing: ['members'], notSaved: [] } };
      }
      members = found.people;
      problems.push(...found.problems);
    }

    let dueDate = '';
    if (args.dueDate) {
      const resolved = resolveDate(args.dueDate, ctx.today);
      if (!resolved) problems.push(`I couldn't read the due date "${args.dueDate}".`);
      else {
        dueDate = resolved;
        if (resolved < ctx.today) warnings.push(`The due date ${formatDay(resolved)} is in the past.`);
      }
    }
    // "create task to fix the signup page in Apollo" → "Fix the signup page": the rest is other fields.
    if (args.title && !ctx.fromButton) args.title = cleanTitle(args.title, [project?.name, ...members.map((p) => p.name), ...(args.members ?? []), args.dueDate]);
    if (args.title && project) {
      // Titles aren't unique, so a second one is allowed, but worth a warning.
      const same = (await api.get<TaskRow[]>('/tasks', { search: args.title, projectId: project.id, limit: 10 })).find((t) => t.title.trim().toLowerCase() === args.title!.trim().toLowerCase());
      if (same) warnings.push(`${project.name} already has a task called "${same.title}" (due ${day(same.dueDate)}).`);
    }

    const values: TaskFormValues = { title: args.title ?? '', description: args.description ?? '', dueDate, status, projectId: project?.id ?? '', userId: members.map((p) => p.id) };
    const missing = REQUIRED.filter((f) => (f === 'project' ? !values.projectId : f === 'members' ? !values.userId.length : !values[f]));
    const labels = Object.fromEntries([...(project ? [[project.id, project.name]] : []), ...members.map((p) => [p.id, p.name])]);
    if (missing.length && !ctx.form) {
      const buttons: AiButton[] = [];
      if (missing.includes('description') && values.title) buttons.push({ label: 'Same as the title', toolCall: { name: 'create_task', args: { description: values.title } } });
      if (missing.includes('members') && ctx.user.role === 'ORG_USER') buttons.push({ label: 'Assign to me', toolCall: { name: 'create_task', args: { members: 'me' } } });
      if (missing.includes('project') && projects.length > 1 && projects.length <= 5) {
        buttons.push(...projects.map((p) => ({ label: p.name, toolCall: { name: 'create_task', args: { project: p.id } } })));
      }
      buttons.push(formButton);
      const what = `${values.title ? `**${values.title}**` : 'the task'}${project ? ` in ${project.name}` : ''}`;
      const asks = missing.map((f) => (f === 'project' ? `${ASK_LABELS.project}${projectOptions(projects)}` : ASK_LABELS[f]));
      return {
        kind: 'ask',
        result: { text: `${problems.length ? `${problems.join(' ')} ` : ''}I'll create ${what}. I still need ${andList(asks)}.`, buttons, warnings },
        draft: {
          tool: 'create_task',
          // Resolved records are kept as ids, so the next turn doesn't look them up again.
          args: Object.fromEntries(
            Object.entries({ title: values.title, description: values.description, dueDate, project: project?.id, members: values.userId.length ? values.userId : undefined, status: args.status ? status : undefined }).filter(([, v]) => v)
          ),
          missing: [...missing],
          notSaved: [],
        },
      };
    }
    const card: ConfirmCard = {
      title: 'New task',
      tone: 'default',
      rows: [
        { label: 'Title', value: values.title || '—' },
        { label: 'Description', value: values.description || '—' },
        { label: 'Project', value: project?.name ?? '—' },
        { label: 'Members', value: andList(members.map((p) => p.name)) || '—' },
        { label: 'Due date', value: dueDate ? formatDay(dueDate) : '—' },
        { label: 'Status', value: STATUS_LABELS[status] },
      ],
      warnings: [...problems, ...warnings],
      confirmLabel: 'Create task',
      form: { kind: 'task', mode: 'create', values, labels },
      incomplete: missing.length > 0,
    };
    return { kind: 'card', card, calls: missing.length ? [] : [{ method: 'POST', path: '/tasks', body: taskBody(values) }] };
  },

  async fillFromReply(draft, reply, api, ctx) {
    if (draft.tool !== 'create_task') return null;
    const filled = fillTaskFromText(draft.missing, reply, ctx.today);
    if (filled || draft.missing.length !== 1) return filled;
    if (draft.missing[0] === 'project') {
      const projects = await loadProjects(api);
      const m = projects ? matchProject(projects, reply.trim()) : null;
      return m?.kind === 'one' ? { project: m.item.id } : null;
    }
    if (draft.missing[0] === 'members') {
      const said = splitNames(reply);
      if (!said.length || said.length > 5) return null;
      const found = await resolveMembers(api, ctx, said);
      return !found.choose && !found.problems.length && found.people.length ? { members: found.people.map((p) => p.id) } : null;
    }
    return null;
  },

  async revise(_pending, values) {
    const parsed = taskValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/tasks', body: taskBody(parsed.data) }];
  },

  done([result]) {
    const t = result as TaskRow;
    return { text: `✅ **Task created:** ${t.title} · ${t.projectName} · due ${day(t.dueDate)} · ${andList(memberNames(t))}.` };
  },
};

// ---------------------------------------------------------------- update

const updateInput = z
  .object({
    task: text('The task'),
    newTitle: text('New title'),
    description: text('New description'),
    dueDate: text('New due date'),
    status: text('New status'),
    project: text('Project'),
    members: names('Member names, or me'),
  })
  // Kept: the model sometimes sends `title` or `name` for the task itself (see prepare).
  .passthrough();

const FIELD_TITLES: Record<keyof TaskFormValues, string> = { title: 'Title', description: 'Description', dueDate: 'Due date', status: 'Status', projectId: 'Project', userId: 'Members' };
const FIELDS = Object.keys(FIELD_TITLES) as (keyof TaskFormValues)[];

function toValues(t: TaskRow): TaskFormValues {
  return { title: t.title, description: t.description, dueDate: t.dueDate, status: t.status, projectId: t.projectId, userId: [...t.userId] };
}

const sameMembers = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** The changed fields, as API values. */
function diffValues(current: TaskRow, v: TaskFormValues): Partial<TaskFormValues> {
  const before = toValues(current);
  const changed: Partial<TaskFormValues> = {};
  for (const key of FIELDS) {
    if (key === 'userId') {
      if (!sameMembers(v.userId, before.userId)) changed.userId = [...new Set(v.userId)];
    } else if (String(v[key]).trim() !== String(before[key]).trim()) (changed as Record<string, string>)[key] = String(v[key]).trim();
  }
  return changed;
}

/** How a field reads on the card: names for the project and members, labels for statuses. */
function shown(key: keyof TaskFormValues, value: TaskFormValues[keyof TaskFormValues], labels: Record<string, string>): string {
  if (key === 'userId') return andList((value as string[]).map((id) => labels[id] ?? 'Unknown')) || '—';
  if (key === 'projectId') return labels[value as string] ?? 'Unknown';
  if (key === 'status') return STATUS_LABELS[value as TaskStatus];
  if (key === 'dueDate') return day(value as string);
  return String(value);
}

/** The current task's names for its project and members (from the task row itself). */
function labelsOf(t: TaskRow): Record<string, string> {
  const names = memberNames(t);
  return { [t.projectId]: t.projectName, ...Object.fromEntries(t.userId.map((id, i) => [id, names[i] ?? 'Unknown'])) };
}

const updateTask: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_task',
  label: 'Preparing the change',
  kind: 'write',
  requires: 'update',
  description: 'Change an existing task: mark it done, started or blocked, move its due date, add or remove members, move it to another project, or rename it. The user confirms before saving.',
  input: updateInput,

  async prepare(input, api, ctx) {
    // "Mark the login bug done" sometimes arrives as { title: "login bug" }: without `task`, that's the task.
    const args: Record<string, unknown> = { ...input };
    for (const key of ['title', 'name']) {
      if (str(args[key])) {
        if (!str(args.task)) args.task = args[key];
        else if (!str(args.newTitle)) args.newTitle = args[key];
      }
      delete args[key];
    }
    // In testing, the model often left out the task, the members or the project, or put the
    // task's words in another field. Outside buttons, the message's own words fill the gaps.
    const message = ctx.fromButton ? '' : ctx.latestText;
    const modelMembers = ctx.fromButton ? splitNames(args.members) : groundedNames(splitNames(args.members), ctx.userText);
    const messageMembers = ctx.fromButton ? [] : membersFromMessage(message);

    // A project named on an update is a move only when the message says so; otherwise it tells tasks apart.
    let projects: ProjectRef[] | null = null;
    let projectWords = str(args.project) && (ctx.fromButton || grounded(String(args.project), ctx.userText)) ? str(args.project) : undefined;
    const move = ctx.fromButton ? Boolean(projectWords) : asksToMove(message);
    if (!projectWords && move) {
      // "Move the login bug to Hermes" with no project from the model: the one project the message names.
      projects = await loadProjects(api);
      const inText = (projects ?? []).filter((p) => mentions(message, p.name));
      if (inText.length === 1) projectWords = inText[0].name;
    }
    let named: ProjectRef | null = null;
    if (projectWords) {
      projects ??= await loadProjects(api);
      if (!projects && move) return { kind: 'ask', result: { text: NO_PROJECTS } };
      const m = projects ? matchProject(projects, projectWords) : null;
      // "Move the login bug task to Hermes" came back with the task's words as the project: when the
      // model's project matches none, the one project the message names wins.
      const inText = m?.kind === 'none' && !ctx.fromButton ? (projects ?? []).filter((p) => mentions(message, p.name)) : [];
      if (m?.kind === 'one') named = m.item;
      else if (inText.length === 1) named = inText[0];
      else if (move) return { kind: 'ask', result: { text: m?.kind === 'many' ? `${m.items.length} projects match "${projectWords}". Which one?` : noProject(projectWords, projects ?? []) } };
    }

    let which = str(args.task);
    if (!which && !ctx.fromButton) {
      // The task from the message itself, without the people and the project it names; that
      // project then tells tasks apart ("Mark the login bug in Hermes as done").
      projects ??= await loadProjects(api);
      const inText = (projects ?? []).filter((p) => mentions(message, p.name));
      if (!named && !move && inText.length === 1) named = inText[0];
      which = taskFromMessage(message, [...modelMembers, ...messageMembers, ...inText.map((p) => p.name)]);
    }
    if (!which) return { kind: 'ask', result: { text: 'Which task do you want to change?' } };
    const found = await findTask(api, which, move ? undefined : named?.id);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No task matches "${taskQuery(which)}".` } };
    // The checks run before a "which one?" question, so its buttons carry only values the user gave.
    const ownWords = taskWords(taskQuery(which));
    // The task's own title isn't a status ("Fix the done button"): its words are set aside, once
    // each, so "Mark the done button task as done" keeps one "done". With several tasks, the words they share.
    const titles = found.kind === 'one' ? [found.item.title] : found.items.map((t) => t.title);
    const said = without(ctx.latestText, norm(titles[0]).split(' ').filter((w) => titles.every((t) => ` ${norm(t)} `.includes(` ${w} `))));
    const newTitle = str(args.newTitle) && (ctx.fromButton || heardText(String(args.newTitle), ctx.userText)) ? str(args.newTitle) : undefined;
    const description = str(args.description) && (ctx.fromButton || heardText(String(args.description), ctx.userText)) ? str(args.description) : undefined;
    const modelDue = str(args.dueDate) && (ctx.fromButton || grounded(String(args.dueDate), ctx.latestText)) ? str(args.dueDate) : undefined;
    // "Push the login bug to next Monday" came back with the date inside `task`: a message that
    // moves a due date and holds one gives it.
    const dueWords = modelDue ?? (message && changesDueDate(message) && resolveDate(message, ctx.today) ? message : undefined);
    // A "member" made of the task's own words ("login bug"), a status ("done") or a project's name
    // ("Move the login bug task to Hermes" came with members "Hermes") is the model repeating something else.
    const notTask = (name: string) =>
      !statusFromWords(name) && !norm(name).split(' ').some((w) => ownWords.includes(w)) && !(projects ?? []).some((p) => norm(p.name) === norm(name));
    const fromModel = modelMembers.filter(notTask);
    const memberWords = fromModel.length ? fromModel : messageMembers.filter(notTask);
    const change: MemberChange = ctx.fromButton && typeof args.memberChange === 'string' ? (args.memberChange as MemberChange) : memberChange(ctx.latestText);
    // "Mark the login bug as done" sometimes comes back with no status: one named in the message counts.
    const mentioned = ctx.fromButton ? [] : statusesIn(said);
    const picked = pickStatus(str(args.status) ?? (mentioned.length === 1 ? mentioned[0] : undefined), ctx, said);
    const checked = {
      newTitle,
      description,
      dueDate: dueWords,
      status: picked.status,
      project: move ? named?.id : undefined,
      members: memberWords.length ? memberWords.join(', ') : undefined,
      memberChange: memberWords.length ? change : undefined,
    };
    if (found.kind === 'many') {
      const keep = Object.fromEntries(Object.entries(checked).filter(([, v]) => v !== undefined));
      return whichTask(`${found.items.length} tasks match "${taskQuery(which)}". Which one?`, found.items, (id) => ({ name: 'update_task', args: { ...keep, task: id } }));
    }

    const current = found.item;
    const values = toValues(current);
    const labels = labelsOf(current);
    const problems: string[] = picked.problem ? [picked.problem] : [];
    const warnings: string[] = [];
    if (newTitle) values.title = newTitle;
    if (description) values.description = description;
    if (dueWords) {
      const resolved = resolveDate(dueWords, ctx.today);
      if (!resolved) problems.push(`I couldn't read the due date "${dueWords}".`);
      else {
        values.dueDate = resolved;
        if (resolved < ctx.today) warnings.push(`The new due date ${formatDay(resolved)} is in the past.`);
      }
    }
    if (picked.status) values.status = picked.status;
    if (move && named) {
      values.projectId = named.id;
      labels[named.id] = named.name;
    }
    if (memberWords.length) {
      const people = await resolveMembers(api, ctx, memberWords);
      if (people.choose) return whichPerson('update_task', { ...checked, task: current.id, members: undefined }, people);
      problems.push(...people.problems);
      people.people.forEach((p) => (labels[p.id] = p.name));
      const ids = people.people.map((p) => p.id);
      if (ids.length) {
        const next = change === 'add' ? [...new Set([...values.userId, ...ids])] : change === 'remove' ? values.userId.filter((id) => !ids.includes(id)) : ids;
        if (next.length) values.userId = next;
        else problems.push(`A task needs at least one member, and ${andList(people.people.map((p) => p.name))} ${people.people.length === 1 ? 'is' : 'are'} the only one${people.people.length === 1 ? '' : 's'} on it. Add someone else first.`);
      }
    }

    const changed = diffValues(current, values);
    const keys = Object.keys(changed) as (keyof TaskFormValues)[];
    const editButton: AiButton = { label: 'Edit in a form', toolCall: { name: 'update_task', args: { task: current.id }, form: true } };
    if (!keys.length && !ctx.form) {
      const textOut = problems.length ? problems.join(' ') : `Nothing to change for **${current.title}**. Tell me what to change: status, due date, members, project, title or description.`;
      return { kind: 'ask', result: { text: textOut, buttons: [editButton] } };
    }
    const before = toValues(current);
    return {
      kind: 'card',
      card: {
        title: `Update ${current.title}`,
        tone: 'default',
        rows: keys.length
          ? keys.map((key) => ({ label: FIELD_TITLES[key], value: shown(key, values[key], labels), previous: shown(key, before[key], labels) }))
          : [{ label: 'Task', value: current.title }],
        warnings: [...problems, ...warnings],
        confirmLabel: 'Save',
        form: { kind: 'task', mode: 'update', values, labels },
        incomplete: keys.length === 0,
      },
      calls: keys.length ? [{ method: 'PUT', path: `/tasks/${current.id}`, body: changed }] : [],
      meta: { taskId: current.id },
    };
  },

  async revise(pending, values, api) {
    const parsed = taskValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const id = String(pending.meta.taskId);
    const changed = diffValues(await api.get<TaskRow>(`/tasks/${id}`), parsed.data);
    if (!Object.keys(changed).length) throw new AiUserError('Nothing was changed.');
    return [{ method: 'PUT', path: `/tasks/${id}`, body: changed }];
  },

  done([result], pending) {
    const t = result as TaskRow;
    const body = (pending.calls[0]?.body ?? {}) as Record<string, unknown>;
    const changes = (Object.keys(body) as (keyof TaskFormValues)[]).map((key) => {
      if (key === 'userId') return `members are now ${andList(memberNames(t))}`;
      if (key === 'projectId') return `project is now ${t.projectName}`;
      const now = toValues(t);
      return `${FIELD_TITLES[key].toLowerCase()} is now ${shown(key, now[key], {})}`;
    });
    return { text: `✅ Updated **${t.title}**${changes.length ? `: ${andList(changes)}` : ''}.` };
  },
};

// ---------------------------------------------------------------- delete

const deleteInput = z.object({ task: text('The task') });

const deleteTask: AiTool<z.infer<typeof deleteInput>> = {
  name: 'delete_task',
  label: 'Finding the task',
  kind: 'write',
  requires: 'delete',
  description: 'Delete a task, only when the user asks to delete it. The user must confirm.',
  input: deleteInput,

  async prepare(args, api, ctx) {
    const which = str(args.task);
    // In testing, "Mark the login bug as done" came back as a delete. Without a word for
    // deleting in the message, it's a change: update_task reads what to change from the message.
    if (!ctx.fromButton && !asksToDelete(ctx.latestText)) return { kind: 'reroute', tool: 'update_task', args: which ? { task: which } : {} };
    if (!which) return { kind: 'ask', result: { text: 'Which task do you want to delete?' } };
    const found = await findTask(api, which);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No task matches "${taskQuery(which)}".` } };
    // One at a time: chat never deletes several tasks in one go.
    if (found.kind === 'many') {
      return whichTask(`${found.items.length} tasks match "${taskQuery(which)}". Which one do you want to delete?`, found.items, (id) => ({ name: 'delete_task', args: { task: id } }));
    }
    const t = found.item;
    return {
      kind: 'card',
      card: {
        title: `Delete ${t.title}?`,
        tone: 'danger',
        rows: [
          { label: 'Project', value: t.projectName },
          { label: 'Due date', value: dueText(t, ctx.today) },
          { label: 'Status', value: STATUS_LABELS[t.status] },
          { label: 'Members', value: andList(memberNames(t)) || '—' },
        ],
        notes: ['This is the same as Delete on the Tasks page.'],
        confirmLabel: 'Delete task',
      },
      calls: [{ method: 'DELETE', path: `/tasks/${t.id}` }],
      meta: { taskId: t.id, title: t.title },
    };
  },

  done(_results, pending) {
    return { text: `✅ **${String(pending.meta.title)}** was deleted.` };
  },
};

// ---------------------------------------------------------------- module

export const taskModule: AiModule = {
  key: 'tasks',
  title: 'Tasks assistant',
  intro: () => 'Ask about tasks, or create and change them by typing or speaking. Every change waits for your Confirm.',
  requiredPermission: { module: 'tasks', action: 'read' },
  starters: [
    { label: 'New task', toolCall: { name: 'create_task', args: {}, form: true } },
    { label: 'My open tasks', toolCall: { name: 'list_tasks', args: { member: 'me', status: 'open' } } },
    { label: "What's overdue?", toolCall: { name: 'list_tasks', args: { due: 'overdue' } } },
    { label: 'Count by status', toolCall: { name: 'count_tasks', args: {} } },
  ],
  systemPrompt: (ctx) => {
    const writes = ctx.tools.some((t) => t !== 'list_tasks' && t !== 'count_tasks');
    return `${basePrompt(ctx, 'tasks')}
You are the Tasks assistant. You help list, find and count tasks${writes ? ', and create, change or delete them' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a description, a due date, a project or a member.
- Copy task titles, project names, people's names, statuses and dates exactly as the user said them. The server finds the records and works out the dates.
- When the user means themselves ("my tasks", "assign it to me"), write "me" for the member.${
      ctx.tools.includes('update_task') ? '\n- To change a status, a due date, the members or the project of a task, call update_task.' : ''
    }
- Never say that a task was created, changed or deleted. The app shows that after the backend confirms it.`;
  },
  tools: [listTasks, countTasks, createTask, updateTask, deleteTask],
  // "Mark the login bug as done", "I've started the API spec review": update_task reads the task
  // and the status from the message itself, with no model call (docs, section 6).
  direct: (message) => (statusStatement(message) ? { name: 'update_task', args: {} } : null),
};
