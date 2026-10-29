import { z } from 'zod';
import { basePrompt } from '../prompts/base.prompt';
import { dayOf, formatDay } from '../dates';
import { grounded, heardText, isBlank, mentions, norm, str } from '../text';
import { AiButton, AiModule, AiResult, AiTool, AiUserError, ApiCall, ApiClient, CheckInFormValues, GoalFormValues, GoalStatus, Prepared, ReviewFormValues, ToolContext } from '../types';
import { otherTab, rangeText } from './me.helpers';
import {
  asksToSubmit,
  commentIn,
  controlWord,
  descriptionIn,
  dueIn,
  findGoals,
  GOAL_STATUS_LABELS,
  goalStatusIn,
  goalTitleFrom,
  goalTitleOf,
  newDueIn,
  progressIn,
  RATING_LABELS,
  ratingIn,
  ratingText,
  startIn,
  titleFromReply,
  weightIn,
} from './performance.helpers';

// The Performance assistant on the Me page's Performance tab (docs/AI_ME_ASSISTANTS.md, section 6):
// goals (new, check-ins, changes, lists) and reviews (lists, and writing one a question at a time).
// Through /goals and /reviews with the user's own token, which check who may do what again.

interface Person {
  id: string;
  name: string;
  jobTitle: string | null;
  reportsTo: string | null;
}

interface Goal {
  id: string;
  ownerId: string;
  owner: Person | null;
  title: string;
  description: string;
  startDate: string;
  dueDate: string;
  weight: number | null;
  progress: number;
  status: GoalStatus;
  overdue: boolean;
  relation?: 'owner' | 'manager' | 'admin';
}

type CycleStatus = 'draft' | 'launched' | 'released' | 'closed';
type PartStatus = 'not_started' | 'draft' | 'submitted';
type Part = 'self' | 'manager';

interface Cycle {
  id: string;
  name: string;
  periodFrom: string;
  periodTo: string;
  selfDueDate: string;
  managerDueDate: string;
  status: CycleStatus;
}

interface MyReviewRow {
  id: string;
  cycle: Cycle;
  selfStatus: PartStatus;
  released: boolean;
  managerRating: number | null;
}

interface ToWriteRow {
  id: string;
  cycle: Cycle;
  employee: Person | null;
  selfStatus: PartStatus;
  managerStatus: PartStatus;
}

interface PartView {
  status: PartStatus;
  answers: { questionId: string; question: string; text: string }[];
  rating: number | null;
}

interface ReviewDetail {
  id: string;
  cycle: Cycle & { questions: { id: string; text: string }[] };
  role: 'employee' | 'reviewer' | 'admin';
  employee: Person | null;
  selfStatus: PartStatus;
  self: PartView | null;
  manager: PartView | null;
  canWriteSelf: boolean;
  canWriteManager: boolean;
}

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

const PART_LABELS: Record<PartStatus, string> = { not_started: 'Not started', draft: 'In progress', submitted: 'Submitted' };
const GOAL_STATUSES = Object.keys(GOAL_STATUS_LABELS) as GoalStatus[];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const SECTION = {
  goals: '/me/performance',
  team: '/me/performance?section=team',
  reviews: '/me/performance?section=reviews',
  toWrite: '/me/performance?section=to-write',
};

const isOpen = (c: Cycle) => c.status === 'launched' || c.status === 'released';
const running = (g: Goal) => g.status !== 'completed' && g.status !== 'cancelled';
const needsAttention = (g: Goal) => g.status === 'at_risk' || g.status === 'behind' || g.overdue;
const firstName = (name: string) => name.split(/\s+/)[0];
const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isoArg = (v: unknown) => (typeof v === 'string' && ISO.test(v) ? v : undefined);
const numArg = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
const ask = (result: AiResult, draft: Extract<Prepared, { kind: 'ask' }>['draft'] = null): Prepared => ({ kind: 'ask', result, draft });

// ---------------------------------------------------------------- people and goals in reach

const people = (api: ApiClient) => api.get<Person[]>('/people');
const myGoals = (api: ApiClient) => api.get<Goal[]>('/goals/mine');
const teamGoals = (api: ApiClient, ownerId?: string) => api.get<Goal[]>('/goals/team', ownerId ? { ownerId } : undefined);

/** Whose goals the user may set or see besides their own: their direct reports; anyone, for an admin (section 6.4). */
const othersFor = (all: Person[], ctx: ToolContext) => all.filter((p) => p.id !== ctx.user.id && (ctx.user.role === 'ORG_ADMIN' || p.reportsTo === ctx.user.id));
const reportsOf = (all: Person[], ctx: ToolContext) => all.filter((p) => p.reportsTo === ctx.user.id);

/** The person a message names among `candidates`: the full name, else a first name; several come back together. */
function personNamed(words: string, candidates: Person[]): Person | Person[] | null {
  const full = candidates.filter((p) => mentions(words, p.name));
  if (full.length) return full.length === 1 ? full[0] : full;
  const first = candidates.filter((p) => mentions(words, firstName(p.name)));
  return first.length === 1 ? first[0] : first.length ? first : null;
}

/**
 * The goals a check-in or change can be about: the user's own, and their team's. A person named
 * (a team member, or anyone for an admin) narrows it to that person's.
 */
async function goalsInReach(api: ApiClient, ctx: ToolContext, words: string): Promise<Goal[]> {
  const [mine, all] = await Promise.all([myGoals(api), people(api)]);
  const named = personNamed(words, othersFor(all, ctx));
  if (named && !Array.isArray(named)) return teamGoals(api, named.id);
  return reportsOf(all, ctx).length ? [...mine, ...(await teamGoals(api))] : mine;
}

const goalLabel = (g: Goal, ctx: ToolContext) => (g.ownerId === ctx.user.id || !g.owner ? g.title : `${g.title} (${g.owner.name})`);
const goalButton = (g: Goal, ctx: ToolContext, tool = 'check_in_goal', verb = 'Check in'): AiButton => ({ label: `${verb}: ${short(goalLabel(g, ctx))}`, toolCall: { name: tool, args: { goal: g.id } } });

// Words of a check-in or a change that name no goal: "I'm at 60% now" names none, "60% on payroll" does.
const NAMES_NO_GOAL =
  /\b(?:i|im|am|is|are|it|its|at|on|in|the|my|our|we|goal|goals|now|percent|per|cent|done|mark|as|completed?|finished|track|risk|behind|progress|update|check|checkin|with|of|to|a|an|halfway|half|way|cancel|reopen|status|set|please|this|that|only|due|date|deadline|push|move|extend|postpone|weight|change|rename)\b|\d+/g;
const namesSomething = (words: string) => norm(words).replace(NAMES_NO_GOAL, ' ').split(' ').some((w) => w.length >= 3);

/** One goal from the words, or the question that asks which. */
async function pickGoal(args: { goal?: string }, ctx: ToolContext, goals: Goal[], words: string, tool: string): Promise<Goal | AiResult> {
  const byId = goals.find((g) => g.id === args.goal);
  if (byId) return byId;
  let found = findGoals(words, goals);
  if (!found.length && str(args.goal) && grounded(String(args.goal), ctx.latestText)) found = findGoals(String(args.goal), goals);
  const mineRunning = goals.filter((g) => g.ownerId === ctx.user.id && running(g));
  if (!found.length && mineRunning.length === 1 && !namesSomething(words)) return mineRunning[0];
  if (found.length === 1) return found[0];
  const offer = (found.length ? found : goals.filter(running)).slice(0, 6);
  if (!offer.length) return { text: 'You have no goals yet. Say, for example, “Set a goal to launch the onboarding flow by 31 Dec”.' };
  const verb = tool === 'check_in_goal' ? 'Check in' : 'Change';
  return { text: found.length ? 'Which goal do you mean?' : "I couldn't tell which goal. Which one?", buttons: offer.map((g) => goalButton(g, ctx, tool, verb)) };
}

// Words for making a goal, and for changing one, as opposed to checking in.
const CREATES = /\b(?:new|set|add|create|make|another|start a)\b/;
const CHANGES = /\b(?:rename|retitle|due date|deadline|push|move|extend|postpone|shift|delay|weight(?:age)?|description|start date)\b/;

// ---------------------------------------------------------------- list_goals

const listGoalsInput = z.object({
  whose: text("'my team', or a person's name, only if the user asked for someone else's goals"),
  status: text('"needs attention", "at risk", "behind", "overdue", "completed", "cancelled" or "on track", only if the user said one'),
});

const FILTERS: { re: RegExp; label: string; test: (g: Goal) => boolean }[] = [
  { re: /\b(?:need(?:s|ing)? attention|attention|problems?|in trouble|struggling)\b/, label: 'needing attention', test: needsAttention },
  { re: /\b(?:overdue|late|past due)\b/, label: 'overdue', test: (g) => g.overdue },
  { re: /\bat risk\b/, label: 'at risk', test: (g) => g.status === 'at_risk' },
  { re: /\bbehind\b/, label: 'behind', test: (g) => g.status === 'behind' },
  { re: /\bon track\b/, label: 'on track', test: (g) => g.status === 'on_track' },
  { re: /\b(?:completed?|done|finished|achieved)\b/, label: 'completed', test: (g) => g.status === 'completed' },
  { re: /\bcancell?ed\b/, label: 'cancelled', test: (g) => g.status === 'cancelled' },
  { re: /\b(?:running|active|open|in progress|current|ongoing)\b/, label: 'running', test: running },
];

/** The weights of running and completed goals (cancelled ones don't count); null when none has one. */
function totalWeight(goals: Goal[], extra = 0): number | null {
  const weighted = goals.filter((g) => g.weight !== null && g.status !== 'cancelled');
  return weighted.length || extra ? weighted.reduce((sum, g) => sum + (g.weight ?? 0), 0) + extra : null;
}

const listGoals: AiTool<z.infer<typeof listGoalsInput>> = {
  name: 'list_goals',
  label: 'Looking up goals',
  kind: 'read',
  description: "List the user's own goals, or their team's (the people who report to them), with progress, status and due date.",
  input: listGoalsInput,
  async run(args, api, ctx) {
    const words = ctx.fromButton ? `${str(args.whose) ?? ''} ${str(args.status) ?? ''}` : ctx.latestText;
    const t = norm(words);
    const all = await people(api);
    const named = personNamed(words, othersFor(all, ctx));
    if (Array.isArray(named)) return { text: 'Whose goals do you mean?', buttons: named.slice(0, 6).map((p) => ({ label: `${p.name}'s goals`, toolCall: { name: 'list_goals', args: { whose: p.name } } })) };
    const team = !named && /\b(?:my team|team s|team|reports|reportees|direct reports|people under me)\b/.test(t);
    if (team && !reportsOf(all, ctx).length) return { text: 'No one reports to you, so there are no team goals.' };
    const goals = named ? await teamGoals(api, named.id) : team ? await teamGoals(api) : await myGoals(api);
    const view = named || team ? SECTION.team : SECTION.goals;
    const scope = named ? ` for ${named.name}` : team ? ' in your team' : '';
    const filter = FILTERS.find((f) => f.re.test(t));
    const shown = filter ? goals.filter(filter.test) : goals;
    if (!shown.length) {
      if (filter) return { text: `No goals ${filter.label}${scope}.`, view };
      return { text: named ? `${named.name} has no goals yet.` : team ? 'No one in your team has a goal yet.' : 'You have no goals yet. Say, for example, “Set a goal to launch the onboarding flow by 31 Dec”.', view };
    }
    const weight = !named && !team ? totalWeight(goals) : null;
    return {
      text: `**${plural(shown.length, 'goal')}**${filter ? ` ${filter.label}` : ''}${scope}.${weight !== null ? ` Weights add up to ${weight}%${weight !== 100 ? ' (100% is usual)' : ''}.` : ''}`,
      table: {
        columns: [{ key: 'goal', title: 'Goal' }, ...(named || team ? [{ key: 'owner', title: 'Whose' }] : []), { key: 'progress', title: 'Progress' }, { key: 'status', title: 'Status' }, { key: 'due', title: 'Due' }],
        rows: shown.slice(0, 20).map((g) => ({
          goal: g.title,
          owner: g.owner?.name ?? '—',
          progress: `${g.progress}%`,
          status: `${GOAL_STATUS_LABELS[g.status]}${g.overdue ? ' · overdue' : ''}`,
          due: formatDay(g.dueDate),
        })),
      },
      buttons: shown.filter(running).slice(0, 4).map((g) => goalButton(g, ctx)),
      view,
    };
  },
};

// ---------------------------------------------------------------- create_goal

const createInput = z.object({
  title: text("The goal's title in the user's words"),
  due: text('The due date exactly as the user said it'),
  start: text('The start date exactly as the user said it, only if they gave one'),
  weight: text('The weight the user said, e.g. "20%", only if they gave one'),
  description: text("A description in the user's words, only if they gave one"),
  for: text("The person the goal is for, only if it isn't the user's own"),
});

const goalValuesSchema = z
  .object({
    ownerId: z.string().regex(/^(?:[0-9a-f]{24})?$/, 'Choose a person'),
    title: z.string().trim().min(1, 'Give the goal a title').max(120, 'Keep the title under 120 characters'),
    description: z.string().trim().max(2000, 'Keep the description under 2,000 characters'),
    startDate: z.string().regex(ISO, 'Choose a start date'),
    dueDate: z.string().regex(ISO, 'Choose a due date'),
    weight: z.number().int('Whole numbers only').min(1, 'At least 1%').max(100, 'At most 100%').nullable(),
  })
  .refine((v) => v.dueDate >= v.startDate, { path: ['dueDate'], message: 'The due date can’t be before the start date' });

const goalBody = (v: GoalFormValues) => ({ title: v.title.trim(), description: v.description.trim(), startDate: v.startDate, dueDate: v.dueDate, weight: v.weight, ...(v.ownerId ? { ownerId: v.ownerId } : {}) });

/** The person after "for" ("for Neha", "for Neha Gupta"): among those the user may set goals for, or a refusal. */
function ownerFrom(words: string, all: Person[], ctx: ToolContext): Person | null | AiResult {
  const after = /\bfor\s+((?:\S+\s*){1,3})/i.exec(words)?.[1];
  if (!after || /^(?:me|myself|my\b|the\b|this\b|next\b|q[1-4]\b)/i.test(after)) return null;
  const named = personNamed(after, othersFor(all, ctx));
  if (Array.isArray(named)) return { text: 'Who is the goal for?', buttons: named.slice(0, 6).map((p) => ({ label: p.name, toolCall: { name: 'create_goal', args: { for: p.id }, form: true } })) };
  if (named) return named;
  const someone = personNamed(after, all.filter((p) => p.id !== ctx.user.id));
  if (someone && !Array.isArray(someone)) return { text: `**${someone.name}** doesn't report to you. You can set goals for yourself and the people who report to you.` };
  return null;
}

const formGoal: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_goal', args: {}, form: true } };

const createGoal: AiTool<z.infer<typeof createInput>> = {
  name: 'create_goal',
  label: 'Preparing the goal',
  kind: 'write',
  description: 'Set a new goal with a title and a due date, for the user or for someone who reports to them. The user confirms before it is saved.',
  input: createInput,

  async prepare(args, api, ctx) {
    if ((args as { stop?: boolean }).stop) return ask({ text: 'OK, I stopped. Nothing was saved.' });
    const message = ctx.latestText;
    if (!ctx.fromButton && !ctx.form && !ctx.rerouted && !CREATES.test(norm(message))) {
      // "I'm at 60% on the onboarding goal" sent here is a check-in; "Push its due date" a change.
      if (progressIn(message) !== undefined || goalStatusIn(message)) return { kind: 'reroute', tool: 'check_in_goal', args: {} };
      if (CHANGES.test(norm(message))) return { kind: 'reroute', tool: 'update_goal', args: {} };
    }
    const draft = ctx.draft?.tool === 'create_goal' ? ctx.draft.args : {};
    const b = ctx.fromButton;
    const all = await people(api);
    const others = othersFor(all, ctx);
    const today = ctx.today;

    const modelTitle = str(args.title) && heardText(String(args.title), message) ? goalTitleOf(String(args.title)) : undefined;
    const title = b ? (str(args.title) ?? str(draft.title)) : (goalTitleFrom(message) ?? modelTitle ?? str(draft.title));
    const modelDue = str(args.due) && grounded(String(args.due), message) ? (dueIn(`by ${args.due}`, today) ?? dayOf(String(args.due), today, 'future') ?? undefined) : undefined;
    const dueDate = b ? (isoArg(args.due) ?? isoArg(draft.dueDate)) : (dueIn(message, today) ?? modelDue ?? isoArg(draft.dueDate));
    const startDate = b ? (isoArg(args.start) ?? isoArg(draft.startDate) ?? today) : (startIn(message, today) ?? isoArg(draft.startDate) ?? today);
    const weight = b ? (numArg(args.weight) ?? numArg(draft.weight) ?? null) : (weightIn(message) ?? numArg(draft.weight) ?? null);
    const description = b ? (str(args.description) ?? str(draft.description) ?? '') : (descriptionIn(message) ?? str(draft.description) ?? '');
    let owner: Person | null = null;
    const ownerId = b ? (str(args.for) ?? str(draft.ownerId)) : str(draft.ownerId);
    if (ownerId) owner = others.find((p) => p.id === ownerId) ?? null;
    else if (!b) {
      const said = ownerFrom(message, all, ctx) ?? (str(args.for) && grounded(String(args.for), message) ? ownerFrom(`for ${args.for}`, all, ctx) : null);
      if (said && 'text' in said) return ask(said);
      owner = said;
    }

    const values: GoalFormValues = { ownerId: owner?.id ?? '', title: title ?? '', description, startDate, dueDate: dueDate ?? '', weight };
    const form = { kind: 'goal' as const, mode: 'create' as const, values, owners: others.map((p) => ({ id: p.id, name: p.name })) };
    const heading = owner ? `New goal for ${owner.name}` : 'New goal';
    const kept = { title, dueDate, startDate, weight, description, ownerId: owner?.id };
    const keep = Object.fromEntries(Object.entries(kept).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if (!title || !dueDate) {
      if (ctx.form) return { kind: 'card', card: { title: heading, tone: 'default', rows: [{ label: 'Goal', value: title ?? '—' }], confirmLabel: 'Add goal', form, incomplete: true }, calls: [] };
      if (!title) return ask({ text: 'What’s the goal? For example “Launch the onboarding flow”.', buttons: [formGoal] }, { tool: 'create_goal', args: keep, missing: ['title'], notSaved: [], freeText: true });
      return ask({ text: `When is **${title}** due?`, buttons: [formGoal] }, { tool: 'create_goal', args: keep, missing: ['due'], notSaved: [] });
    }
    if (dueDate < startDate) {
      return ask({ text: `The due date (${formatDay(dueDate)}) is before the start (${formatDay(startDate)}). When is it due?`, buttons: [formGoal] }, { tool: 'create_goal', args: { ...keep, dueDate: undefined }, missing: ['due'], notSaved: [] });
    }
    const notes: string[] = [];
    if (weight !== null) {
      const total = totalWeight(owner ? await teamGoals(api, owner.id) : await myGoals(api), weight);
      if (total !== null) notes.push(`${owner ? `${firstName(owner.name)}'s` : 'Your'} goals' weights would add up to ${total}%${total !== 100 ? ' (100% is usual)' : ''}.`);
    }
    return {
      kind: 'card',
      card: {
        title: heading,
        tone: 'default',
        rows: [
          { label: 'Goal', value: title },
          { label: 'Start', value: formatDay(startDate) },
          { label: 'Due', value: formatDay(dueDate) },
          { label: 'Weight', value: weight !== null ? `${weight}%` : '—' },
          { label: 'Description', value: description || '—' },
        ],
        warnings: dueDate < today ? ['The due date has already passed.'] : undefined,
        notes: notes.length ? notes : undefined,
        confirmLabel: 'Add goal',
        form,
      },
      calls: [{ method: 'POST', path: '/goals', body: goalBody(values) }],
    };
  },

  async fillFromReply(draft, reply, _api, ctx) {
    if (draft.tool !== 'create_goal') return null;
    const out: Record<string, unknown> = { ...draft.args, due: draft.args.dueDate, start: draft.args.startDate, for: draft.args.ownerId };
    if (draft.missing.includes('title')) {
      if (controlWord(reply) === 'stop') return { stop: true };
      const title = goalTitleFrom(reply) ?? titleFromReply(reply);
      if (!title) return null;
      out.title = title;
    }
    const due = dueIn(reply, ctx.today) ?? (draft.missing.includes('due') ? (dayOf(reply, ctx.today, 'future') ?? undefined) : undefined);
    if (due) out.due = due;
    const weight = weightIn(reply);
    if (weight) out.weight = weight;
    return out.title !== draft.args.title || out.due !== draft.args.dueDate ? out : null;
  },

  async revise(_pending, values) {
    const parsed = goalValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/goals', body: goalBody(parsed.data) }];
  },

  done([result]) {
    const g = result as Goal;
    const forWhom = g.relation && g.relation !== 'owner' && g.owner ? ` for ${g.owner.name}` : '';
    return { text: `✅ **Goal added${forWhom}:** ${g.title}, due ${formatDay(g.dueDate)}.` };
  },
};

// ---------------------------------------------------------------- update_goal

const updateInput = z.object({
  goal: text("The goal's name in the user's words"),
  title: text('The new title, only if the user is renaming it'),
  due: text('The new due date exactly as the user said it'),
  start: text('The new start date exactly as the user said it'),
  weight: text('The new weight, e.g. "30%"'),
  description: text('The new description in the user\'s words'),
});

/** The changes a message asks for, and the words that name the goal (before "to …"). */
function changesIn(message: string, today: string): { changes: Partial<Omit<GoalFormValues, 'ownerId'>>; head: string } {
  const changes: Partial<Omit<GoalFormValues, 'ownerId'>> = {};
  const rename = /\b(?:rename|retitle|(?:change|update) (?:the |its )?(?:title|name))\b(.*?)\b(?:to|as)\s+(.+)$/i.exec(message);
  if (rename) {
    const title = goalTitleOf(rename[2]);
    if (title) changes.title = title;
  }
  const start = /\bstart(?: date)?\b.*?\b(?:to|as|on)\s+(.+)$/i.exec(message);
  if (start) changes.startDate = dayOf(start[1], today, 'recent', 180) ?? undefined;
  if (!rename && !start && /\b(?:due|deadline|push|move|extend|postpone|shift|delay|by)\b/i.test(message)) changes.dueDate = newDueIn(message, today);
  const weightTo = /\bweight(?:age)?\b.*?\b(?:to|as)\s+(\d{1,3})\s*%?/i.exec(message);
  const weight = /\bweight/i.test(message) ? (weightIn(message) ?? (weightTo && Number(weightTo[1]) >= 1 && Number(weightTo[1]) <= 100 ? Number(weightTo[1]) : undefined)) : undefined;
  if (weight) changes.weight = weight;
  const description = descriptionIn(message) ?? /\bdescription\b.*?\bto\s+(.+)$/i.exec(message)?.[1]?.trim();
  if (description) changes.description = description.slice(0, 2000);
  const head = message.replace(/\s+(?:to|till|until|as)\s+.+$/i, '');
  return { changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as typeof changes, head };
}

const updateGoal: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_goal',
  label: 'Finding the goal',
  kind: 'write',
  description: "Change a goal's title, start or due date, weight or description. Progress and status change with check_in_goal. The user confirms first.",
  input: updateInput,

  async prepare(args, api, ctx) {
    const message = ctx.latestText;
    if (!ctx.fromButton && !ctx.form && !ctx.rerouted && !CHANGES.test(norm(message)) && (progressIn(message) !== undefined || goalStatusIn(message))) {
      return { kind: 'reroute', tool: 'check_in_goal', args: {} };
    }
    const { changes, head } = ctx.fromButton ? { changes: {}, head: '' } : changesIn(message, ctx.today);
    const goals = await goalsInReach(api, ctx, message);
    const picked = await pickGoal(args, ctx, goals, head, 'update_goal');
    if ('text' in picked) return ask(picked);
    const goal = picked;
    const values: GoalFormValues = { ownerId: '', title: goal.title, description: goal.description, startDate: goal.startDate, dueDate: goal.dueDate, weight: goal.weight, ...changes };
    const form = { kind: 'goal' as const, mode: 'update' as const, values, owners: [] };
    const changed = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== (goal as unknown as Record<string, unknown>)[k]);
    if (!changed.length) {
      if (ctx.form) return { kind: 'card', card: { title: 'Change this goal', tone: 'default', rows: [{ label: 'Goal', value: goalLabel(goal, ctx) }], confirmLabel: 'Save', form, incomplete: true }, calls: [], meta: { goalId: goal.id } };
      return ask({ text: `What do you want to change on **${goal.title}**: the title, the dates, the weight or the description?`, buttons: [{ label: 'Fill in the form instead', toolCall: { name: 'update_goal', args: { goal: goal.id }, form: true } }] });
    }
    if (values.dueDate < values.startDate) return ask({ text: `The due date (${formatDay(values.dueDate)}) can’t be before the start (${formatDay(values.startDate)}).` });
    const show = (k: keyof typeof changes, v: unknown) => (k === 'startDate' || k === 'dueDate' ? formatDay(String(v)) : k === 'weight' ? (v === null ? '—' : `${v}%`) : String(v || '—'));
    const LABELS = { title: 'Title', description: 'Description', startDate: 'Start', dueDate: 'Due', weight: 'Weight' } as const;
    return {
      kind: 'card',
      card: {
        title: 'Change this goal',
        tone: 'default',
        rows: [{ label: 'Goal', value: goalLabel(goal, ctx) }, ...changed.map((k) => ({ label: LABELS[k], value: show(k, values[k]), previous: show(k, (goal as unknown as Record<string, unknown>)[k]) }))],
        confirmLabel: 'Save',
        form,
      },
      calls: [{ method: 'PUT', path: `/goals/${goal.id}`, body: Object.fromEntries(changed.map((k) => [k, values[k]])) }],
      meta: { goalId: goal.id },
    };
  },

  async revise(pending, values) {
    const parsed = goalValuesSchema.safeParse({ ...(values as object), ownerId: '' });
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const { ownerId: _owner, ...body } = goalBody(parsed.data) as ReturnType<typeof goalBody> & { ownerId?: string };
    return [{ method: 'PUT', path: `/goals/${String(pending.meta.goalId)}`, body }];
  },

  done([result]) {
    const g = result as Goal;
    return { text: `✅ **Goal changed:** ${g.title}, due ${formatDay(g.dueDate)}.` };
  },
};

// ---------------------------------------------------------------- check_in_goal

const checkInInput = z.object({
  goal: text("The goal's name in the user's words"),
  progress: text('The progress the user said, e.g. "60%"'),
  status: text('"on track", "at risk", "behind", "completed" or "cancelled", only if the user said one'),
  comment: text("A comment in the user's words, only if they gave one"),
});

const checkInSchema = z.object({
  progress: z.number({ invalid_type_error: 'Enter the progress' }).int('Whole numbers only').min(0, 'At least 0%').max(100, 'At most 100%'),
  status: z.enum(GOAL_STATUSES as [GoalStatus, ...GoalStatus[]], { errorMap: () => ({ message: 'Choose a status' }) }),
  comment: z.string().trim().max(1000, 'Keep the comment under 1,000 characters'),
});

/** A status from a button or the model: the enum itself, or words for one. */
const statusArg = (v: unknown): GoalStatus | 'reopen' | undefined => (GOAL_STATUSES.includes(v as GoalStatus) ? (v as GoalStatus) : typeof v === 'string' ? goalStatusIn(v) : undefined);

const checkInGoal: AiTool<z.infer<typeof checkInInput>> = {
  name: 'check_in_goal',
  label: 'Finding the goal',
  kind: 'write',
  description: 'Check in on a goal: its progress (0–100%), a status (on track, at risk, behind, completed, cancelled) and a comment. The user confirms first.',
  input: checkInInput,

  async prepare(args, api, ctx) {
    const message = ctx.latestText;
    const b = ctx.fromButton;
    if (!b && !ctx.form && !ctx.rerouted) {
      const t = norm(message);
      const checkInWords = progressIn(message) !== undefined || goalStatusIn(message);
      if (CREATES.test(t) && /\bgoal\b/.test(t) && !checkInWords) return { kind: 'reroute', tool: 'create_goal', args: {} };
      if (CHANGES.test(t) && !checkInWords) return { kind: 'reroute', tool: 'update_goal', args: {} };
    }
    const draft = ctx.draft?.tool === 'check_in_goal' ? ctx.draft.args : {};
    const goals = await goalsInReach(api, ctx, b ? '' : message);
    const picked = await pickGoal({ goal: str(args.goal) ?? str(draft.goal) }, ctx, goals, b ? '' : message, 'check_in_goal');
    if ('text' in picked) return ask(picked);
    const goal = picked;

    const modelProgress = str(args.progress)?.match(/\d{1,3}/)?.[0];
    const progressSaid = b ? numArg(args.progress) : (progressIn(message) ?? (modelProgress && new RegExp(`\\b${modelProgress}\\b`).test(message) ? Number(modelProgress) : undefined));
    const statusSaid = b ? statusArg(args.status) : (goalStatusIn(message) ?? (str(args.status) && grounded(String(args.status), message) ? statusArg(args.status) : undefined));
    const modelComment = str(args.comment) && heardText(String(args.comment), message) && !goalStatusIn(String(args.comment)) && progressIn(String(args.comment)) === undefined ? String(args.comment).slice(0, 1000) : undefined;
    const comment = b ? (str(args.comment) ?? '') : (commentIn(message) ?? modelComment ?? '');

    const formValues: CheckInFormValues = { progress: goal.progress, status: goal.status === 'cancelled' ? 'on_track' : goal.status, comment: '' };
    if (progressSaid === undefined && !statusSaid && !comment) {
      const form = { kind: 'checkin' as const, mode: 'update' as const, values: formValues };
      if (ctx.form) return { kind: 'card', card: { title: 'Check in', tone: 'default', rows: [{ label: 'Goal', value: goalLabel(goal, ctx) }], confirmLabel: 'Check in', form, incomplete: true }, calls: [], meta: { goalId: goal.id } };
      return ask(
        {
          text: `Where does **${goal.title}** stand? Say the progress (it's at ${goal.progress}%), a status (On track, At risk, Behind, Completed), or both.`,
          buttons: [{ label: 'Fill in the form instead', toolCall: { name: 'check_in_goal', args: { goal: goal.id }, form: true } }],
        },
        { tool: 'check_in_goal', args: { goal: goal.id }, missing: ['progress'], notSaved: [] }
      );
    }
    const status: GoalStatus = statusSaid === 'reopen' ? 'on_track' : (statusSaid ?? formValues.status);
    const progress = progressSaid ?? (status === 'completed' ? 100 : goal.progress);
    const values: CheckInFormValues = { progress, status, comment };
    const cancel = status === 'cancelled';
    return {
      kind: 'card',
      card: {
        title: cancel ? 'Cancel this goal?' : 'Check in',
        tone: cancel ? 'danger' : 'default',
        rows: [
          { label: 'Goal', value: goalLabel(goal, ctx) },
          { label: 'Progress', value: `${progress}%`, ...(progress !== goal.progress ? { previous: `${goal.progress}%` } : {}) },
          { label: 'Status', value: GOAL_STATUS_LABELS[status], ...(status !== goal.status ? { previous: GOAL_STATUS_LABELS[goal.status] } : {}) },
          { label: 'Comment', value: comment || '—' },
        ],
        notes: cancel
          ? ['Cancelling keeps the goal and its history; a later check-in reopens it.']
          : progress === 100 && status !== 'completed'
            ? ['At 100%: you can set the status to Completed on the card.']
            : undefined,
        confirmLabel: cancel ? 'Cancel goal' : 'Check in',
        form: { kind: 'checkin', mode: 'update', values },
      },
      calls: [{ method: 'POST', path: `/goals/${goal.id}/check-ins`, body: values }],
      meta: { goalId: goal.id },
    };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'check_in_goal') return null;
    const progress = progressIn(reply);
    const status = goalStatusIn(reply);
    const comment = commentIn(reply);
    if (progress === undefined && !status && !comment) return null;
    return { goal: draft.args.goal, progress, status, comment };
  },

  async revise(pending, values) {
    const parsed = checkInSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: `/goals/${String(pending.meta.goalId)}/check-ins`, body: parsed.data }];
  },

  done([result]) {
    const g = result as Goal;
    if (g.status === 'cancelled') return { text: `✅ **Goal cancelled:** ${g.title}. A later check-in reopens it.` };
    return { text: `✅ **Checked in** on ${g.title}: ${g.progress}%, ${GOAL_STATUS_LABELS[g.status]}.` };
  },
};

// ---------------------------------------------------------------- list_reviews

const listReviewsInput = z.object({ which: text('"to write" for the reviews the user writes as a manager; empty for their own') });

const TO_WRITE = /\b(?:to write|i (?:have|need|ve got) to write|reviews? (?:i|to) write|write for|my team|team s|reports|as (?:a )?manager|manager reviews?|reviewer|of my team|pending reviews of)\b/;

const listReviews: AiTool<z.infer<typeof listReviewsInput>> = {
  name: 'list_reviews',
  label: 'Looking up reviews',
  kind: 'read',
  description: "List the user's own reviews (self review status, manager's rating once released), or the reviews they write as a manager.",
  input: listReviewsInput,
  async run(args, api, ctx) {
    const words = norm(ctx.fromButton ? (str(args.which) ?? '') : ctx.latestText);
    if (TO_WRITE.test(words)) {
      const rows = await api.get<ToWriteRow[]>('/reviews/to-write');
      if (!rows.length) return { text: 'You have no reviews to write.' };
      const left = rows.filter((r) => isOpen(r.cycle) && r.managerStatus !== 'submitted');
      return {
        text: `**${plural(rows.length, 'review')}** to write${left.length !== rows.length ? `, ${left.length} still to do` : ''}.`,
        table: {
          columns: [
            { key: 'person', title: 'Person' },
            { key: 'cycle', title: 'Cycle' },
            { key: 'theirs', title: 'Their self review' },
            { key: 'yours', title: 'Your review' },
            { key: 'due', title: 'Due' },
          ],
          rows: rows.slice(0, 20).map((r) => ({ person: r.employee?.name ?? 'Former member', cycle: r.cycle.name, theirs: PART_LABELS[r.selfStatus], yours: PART_LABELS[r.managerStatus], due: formatDay(r.cycle.managerDueDate) })),
        },
        buttons: left.slice(0, 4).map((r) => ({ label: `Write review: ${r.employee?.name ?? 'Former member'}`, toolCall: { name: 'write_review', args: { review: r.id } } })),
        view: SECTION.toWrite,
      };
    }
    const rows = await api.get<MyReviewRow[]>('/reviews/mine');
    if (!rows.length) return { text: 'You have no reviews yet. They appear here when your admin starts a review cycle.', view: SECTION.reviews };
    const writable = rows.filter((r) => isOpen(r.cycle) && r.selfStatus !== 'submitted');
    return {
      text: `**${plural(rows.length, 'review')}**${writable.length ? `, ${writable.length} with a self review to write` : ''}.`,
      table: {
        columns: [
          { key: 'cycle', title: 'Cycle' },
          { key: 'period', title: 'Period' },
          { key: 'self', title: 'Self review' },
          { key: 'rating', title: "Manager's rating" },
        ],
        rows: rows.slice(0, 20).map((r) => ({
          cycle: r.cycle.name,
          period: rangeText(r.cycle.periodFrom, r.cycle.periodTo),
          self: `${PART_LABELS[r.selfStatus]}${isOpen(r.cycle) && r.selfStatus !== 'submitted' ? `, due ${formatDay(r.cycle.selfDueDate)}` : ''}`,
          rating: r.released ? ratingText(r.managerRating) : 'Not released yet',
        })),
      },
      buttons: writable.slice(0, 4).map((r) => ({ label: `Write self review: ${r.cycle.name}`, toolCall: { name: 'write_review', args: { review: r.id } } })),
      view: SECTION.reviews,
    };
  },
};

// ---------------------------------------------------------------- write_review

const reviewInput = z.object({
  person: text("Whose review, only for someone else's: the name the user said"),
  cycle: text('The review cycle, only if the user named one (e.g. "H2 2026")'),
  review: text('Leave empty'),
});

/** What a review conversation keeps between replies (the draft's args). */
interface ReviewArgs {
  review?: string;
  answers?: Record<string, string>;
  skipped?: string[];
  rating?: number | null;
  submit?: boolean;
  stop?: boolean;
  finish?: boolean;
  ratingSkipped?: boolean;
  ratingUnread?: boolean;
}

const SCALE = Object.entries(RATING_LABELS)
  .map(([n, l]) => `${n} ${l}`)
  .join(' · ');

const reviewValuesSchema = z.object({
  answers: z.record(z.string().max(5000, 'Keep each answer under 5,000 characters')),
  rating: z.number().int().min(1, 'Choose a rating from 1 to 5').max(5, 'Choose a rating from 1 to 5').nullable(),
  submitNow: z.boolean(),
});

/** What is still missing before a review can be submitted, or null. */
function missingForSubmit(questions: { id: string }[], answers: Record<string, string>, rating: number | null): string | null {
  const left = questions.filter((q) => !answers[q.id]?.trim()).length;
  const parts = [left ? `answer every question (${left} left)` : '', rating ? '' : 'choose a rating'].filter(Boolean);
  return parts.length ? parts.join(' and ') : null;
}

function reviewCall(reviewId: string, part: Part, questions: { id: string }[], answers: Record<string, string>, rating: number | null, submit: boolean): ApiCall {
  return {
    method: submit ? 'POST' : 'PUT',
    path: `/reviews/${reviewId}/${part}${submit ? '/submit' : ''}`,
    body: { answers: questions.map((q) => ({ questionId: q.id, text: (answers[q.id] ?? '').trim().slice(0, 5000) })), rating },
  };
}

/** The review a request means: one of the user's own, or one they write as a manager. */
async function findReview(api: ApiClient, ctx: ToolContext, args: { person?: string; cycle?: string }): Promise<{ id: string } | { result: AiResult }> {
  const words = ctx.fromButton ? `${str(args.person) ?? ''} ${str(args.cycle) ?? ''}` : ctx.latestText;
  const own = /\b(?:self review|my review|my own|myself)\b/.test(norm(words));
  const modelPerson = !ctx.fromButton && str(args.person) && grounded(String(args.person), ctx.latestText) && !/^(?:me|my|myself|self|i|mine)$/i.test(String(args.person)) ? String(args.person) : undefined;
  const cycleNamed = <T extends { cycle: Cycle }>(rows: T[]) => {
    const named = rows.filter((r) => mentions(words, r.cycle.name));
    return named.length ? named : rows;
  };

  if (!own) {
    const rows = await api.get<ToWriteRow[]>('/reviews/to-write');
    const employees = [...new Map(rows.filter((r) => r.employee).map((r) => [r.employee!.id, r.employee!])).values()];
    const named = personNamed(words, employees) ?? (modelPerson ? personNamed(modelPerson, employees) : null);
    if (Array.isArray(named)) return { result: { text: 'Whose review do you mean?', buttons: named.slice(0, 6).map((p) => ({ label: `Write review: ${p.name}`, toolCall: { name: 'write_review', args: { person: p.name } } })) } };
    if (named) {
      const theirs = rows.filter((r) => r.employee?.id === named.id);
      const open = cycleNamed(theirs.filter((r) => isOpen(r.cycle) && r.managerStatus !== 'submitted'));
      if (!open.length) return { result: { text: theirs.length ? `Your review of **${named.name}** for ${theirs[0].cycle.name} is already submitted.` : `You have no review of **${named.name}** to write.` } };
      if (open.length > 1) return { result: { text: 'Which cycle?', buttons: open.map((r) => ({ label: `${named.name}: ${r.cycle.name}`, toolCall: { name: 'write_review', args: { review: r.id } } })) } };
      return { id: open[0].id };
    }
    if (modelPerson) return { result: { text: `You have no review of **${modelPerson}** to write. Say “Show reviews to write” to see yours.` } };
  }

  const mine = await api.get<MyReviewRow[]>('/reviews/mine');
  const open = cycleNamed(mine.filter((r) => isOpen(r.cycle) && r.selfStatus !== 'submitted'));
  if (!open.length) {
    const done = mine.find((r) => isOpen(r.cycle) && r.selfStatus === 'submitted');
    return { result: { text: done ? `Your ${done.cycle.name} self review is already submitted. Only an admin can reopen it.` : 'You have no self review to write right now. Reviews appear here when your admin starts a review cycle.' } };
  }
  if (open.length > 1) return { result: { text: 'Which review cycle?', buttons: open.map((r) => ({ label: `Write self review: ${r.cycle.name}`, toolCall: { name: 'write_review', args: { review: r.id } } })) } };
  return { id: open[0].id };
}

const writeReview: AiTool<z.infer<typeof reviewInput>> = {
  name: 'write_review',
  label: 'Opening the review',
  kind: 'write',
  description: "Write the user's self review, or a review of someone who reports to them: the app asks each question in turn, then the rating. The user confirms before it is saved.",
  input: reviewInput,

  async prepare(args, api, ctx) {
    const a = args as z.infer<typeof reviewInput> & ReviewArgs;
    if (a.stop) return ask({ text: 'OK, I stopped. Nothing was saved.' });
    const inFlow = ctx.draft?.tool === 'write_review';
    let reviewId = str(a.review);
    if (!reviewId) {
      const found = await findReview(api, ctx, a);
      if ('result' in found) return ask(found.result);
      reviewId = found.id;
    }
    const detail = await api.get<ReviewDetail>(`/reviews/${reviewId}`);
    const part: Part | null = detail.canWriteSelf ? 'self' : detail.canWriteManager ? 'manager' : null;
    const cycle = detail.cycle;
    if (!part) {
      if (cycle.status === 'closed') return ask({ text: `The ${cycle.name} review cycle is closed, so its reviews can't be changed.` });
      return ask({ text: detail.role === 'employee' ? `Your ${cycle.name} self review is already submitted. Only an admin can reopen it.` : `Your review of **${detail.employee?.name ?? 'this person'}** is already submitted.` });
    }
    const questions = cycle.questions;
    const saved = Object.fromEntries((detail[part]?.answers ?? []).filter((x) => x.text.trim()).map((x) => [x.questionId, x.text]));
    const answers: Record<string, string> = { ...saved, ...(a.answers ?? {}) };
    const skipped = a.skipped ?? [];
    const rating = a.rating ?? (!ctx.fromButton ? ratingIn(ctx.latestText) : undefined) ?? detail[part]?.rating ?? null;
    const submit = a.submit ?? (!ctx.fromButton && asksToSubmit(ctx.latestText));
    const who = part === 'manager' ? (detail.employee?.name ?? 'Former member') : null;
    const due = part === 'self' ? cycle.selfDueDate : cycle.managerDueDate;
    const keep: ReviewArgs = { review: reviewId, answers, skipped, rating, submit };
    const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'write_review', args: { review: reviewId }, form: true } };

    if (!ctx.form && !a.finish) {
      const next = questions.findIndex((q) => !answers[q.id]?.trim() && !skipped.includes(q.id));
      if (next >= 0) {
        const header = inFlow ? '' : ` · ${who ? `for **${who}**'s review · ` : ''}${cycle.name} · due ${formatDay(due)}`;
        const help = inFlow ? '' : ' Answer in your own words. Say “skip” to leave it for later, “done” to finish now, or “stop”.';
        return ask(
          { text: `**Question ${next + 1} of ${questions.length}**${header}: *${questions[next].text}*${help}`, buttons: inFlow ? undefined : [formButton] },
          { tool: 'write_review', args: keep as Record<string, unknown>, missing: [`q:${questions[next].id}`], notSaved: [], freeText: true }
        );
      }
      if (!rating && !a.ratingSkipped) {
        return ask(
          { text: `${a.ratingUnread ? 'Say a number from 1 to 5, or “skip”. ' : ''}How would you rate ${who ? firstName(who) : 'yourself'}, from 1 to 5? ${SCALE}` },
          { tool: 'write_review', args: keep as Record<string, unknown>, missing: ['rating'], notSaved: [] }
        );
      }
    }

    const problem = submit ? missingForSubmit(questions, answers, rating) : null;
    const values: ReviewFormValues = { answers: Object.fromEntries(questions.map((q) => [q.id, answers[q.id] ?? ''])), rating, submitNow: submit };
    return {
      kind: 'card',
      card: {
        title: who ? `${who}'s ${cycle.name} review` : `Your ${cycle.name} self review`,
        tone: 'default',
        rows: [...questions.map((q) => ({ label: q.text, value: answers[q.id]?.trim() ? short(answers[q.id].trim(), 160) : '—' })), { label: 'Rating', value: ratingText(rating) }],
        warnings: problem ? [`${problem.charAt(0).toUpperCase()}${problem.slice(1)} to submit, or turn Submit now off to save a draft.`] : undefined,
        notes: [submit ? "A submitted review can't be changed unless an admin reopens it." : 'Saved as a draft: you can change it and submit it later.'],
        confirmLabel: submit ? 'Submit review' : 'Save draft',
        form: { kind: 'review', mode: 'update', values, questions: questions.map((q) => ({ id: q.id, text: q.text })) },
        incomplete: Boolean(problem),
      },
      calls: problem ? [] : [reviewCall(reviewId, part, questions, answers, rating, submit)],
      meta: { reviewId, part, cycle: cycle.name, who, questions: questions.map((q) => ({ id: q.id })) },
    };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'write_review') return null;
    const args = draft.args as ReviewArgs;
    const key = draft.missing[0] ?? '';
    const word = controlWord(reply);
    if (word === 'stop') return { ...args, stop: true };
    if (word === 'done') return { ...args, finish: true };
    if (key === 'rating') {
      if (word === 'skip') return { ...args, ratingSkipped: true };
      const rating = ratingIn(reply);
      return rating ? { ...args, rating, ratingUnread: false } : { ...args, ratingUnread: true };
    }
    if (!key.startsWith('q:')) return null;
    const id = key.slice(2);
    if (word === 'skip') return { ...args, skipped: [...(args.skipped ?? []), id] };
    return { ...args, answers: { ...(args.answers ?? {}), [id]: reply.trim().slice(0, 5000) } };
  },

  async revise(pending, values) {
    const parsed = reviewValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const questions = pending.meta.questions as { id: string }[];
    const { answers, rating, submitNow } = parsed.data;
    const problem = submitNow ? missingForSubmit(questions, answers, rating) : null;
    if (problem) throw new AiUserError(`${problem.charAt(0).toUpperCase()}${problem.slice(1)} to submit, or turn Submit now off to save a draft.`);
    return [reviewCall(String(pending.meta.reviewId), pending.meta.part as Part, questions, answers, rating, submitNow)];
  },

  done(_results, pending) {
    const cycle = String(pending.meta.cycle);
    const who = pending.meta.who ? String(pending.meta.who) : null;
    if (pending.calls[0]?.path.endsWith('/submit')) return { text: who ? `✅ **Review of ${who} submitted** for ${cycle}.` : `✅ **Self review submitted** for ${cycle}.` };
    return { text: `✅ **Draft saved** for ${who ? `${who}'s ${cycle} review` : `your ${cycle} self review`}. Say “Submit ${who ? `${firstName(who)}'s review` : 'my self review'}” when it's ready.` };
  },
};

// ---------------------------------------------------------------- module

/** Plain requests the server reads by itself (docs section 6): no model call. */
function direct(message: string): { name: string; args: Record<string, unknown> } | null {
  const t = norm(message);
  if (/^(?:show|list|see|view|what are|open)?\s*(?:me\s+)?(?:all\s+)?my (?:goals|okrs)$/.test(t)) return { name: 'list_goals', args: {} };
  if (/\b(?:my )?team s goals\b|\bgoals of my team\b/.test(t)) return { name: 'list_goals', args: {} };
  if (/^(?:show|list|see|view)?\s*(?:me\s+)?my reviews$/.test(t)) return { name: 'list_reviews', args: {} };
  // "Write my self review", "I'd like to write Neha's review now": findReview() reads whose from the words.
  if (/\b(?:write|start|continue|finish|fill in|do)\b(?: \S+){0,3}? (?:self )?review\b|\bsubmit my self review\b/.test(t)) return { name: 'write_review', args: {} };
  return null;
}

export const performanceModule: AiModule = {
  key: 'performance',
  title: 'Performance assistant',
  intro: () => 'Set goals and check in on them, see your reviews, and write your self review, by typing or speaking. Nothing is saved until you Confirm.',
  starters: [
    { label: 'My goals', toolCall: { name: 'list_goals', args: {} } },
    { label: 'New goal', toolCall: { name: 'create_goal', args: {}, form: true } },
    { label: 'My reviews', toolCall: { name: 'list_reviews', args: {} } },
    { label: 'Write self review', toolCall: { name: 'write_review', args: {} } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'performance')}
You are the Performance assistant on the user's own Performance tab. You help them set goals, check in on them, change them, see their reviews, and write a review.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- A new goal: call create_goal. Copy the title, the dates, the weight and the person it is for exactly as the user said them.
- Progress, a status or a comment on a goal ("60%", "at risk", "done", "cancel it"): call check_in_goal with the goal's name in the user's words.
- Changing a goal's title, dates or weight: call update_goal.
- Writing a self review, or a review of someone who reports to the user: call write_review. Fill in person only for someone else's review.
- Never write review answers yourself. The app asks the user each question.
- Never say that a goal or a review was saved. The app shows that after the backend confirms it.`,
  tools: [listGoals, createGoal, updateGoal, checkInGoal, listReviews, writeReview],
  requiredFeature: 'performance',
  direct,
  elsewhere: (message) => otherTab(message, 'performance'),
};
