// Pure helpers for the Tasks assistant (docs/AI_TASKS_ASSISTANT.md, sections 2 and 7).
// The model copies the user's words; these turn them into statuses, member names and
// changes the API understands, and decide which of the model's values the user gave.

import { TASK_STATUSES, TaskStatus } from '../../models/task.model';
import { resolveDate } from '../dates';
import { colonDescription, grounded, heardText, isBlank, norm, sameText, str, stripCommandWords } from '../text';

export { colonDescription, heardText, sameText };

export { TASK_STATUSES };
export type { TaskStatus };

/** As on the Tasks page. */
export const STATUS_LABELS: Record<TaskStatus, string> = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done', blocked: 'Blocked' };

/** Every status but Done: "open", "pending" and "overdue" in a list or a count. */
export const OPEN_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'blocked'];

// Checked in order, on norm()-ed text: "not started" and "not done" before "started" and "done".
const STATUS_WORDS: [TaskStatus, RegExp][] = [
  ['todo', /\b(?:not (?:yet )?started|not done|to ?do|pending|backlog|re ?open(?:ed)?)\b/],
  ['blocked', /\b(?:blocked|stuck|on ?hold|waiting|held up|paused?)\b/],
  ['done', /\b(?:done|complete[ds]?|finish(?:ed|es)?|closed?|resolved?|fixed|shipped|ho gaya|ho gayi|khatam)\b/],
  ['in-progress', /\b(?:in ?progress|started|start(?:ing)?|working on|doing|ongoing|wip|picked up|resumed?)\b/],
];

/** "on hold" -> 'blocked', "finished" -> 'done'. Null when the words name no status. */
export function statusFromWords(text: string): TaskStatus | null {
  const exact = text.trim().toLowerCase();
  if ((TASK_STATUSES as readonly string[]).includes(exact)) return exact as TaskStatus;
  const t = norm(text);
  return STATUS_WORDS.find(([, pattern]) => pattern.test(t))?.[0] ?? null;
}

/** Every status the words mention: "from blocked back to in progress" -> ['blocked', 'in-progress']. */
export function statusesIn(text: string): TaskStatus[] {
  let t = norm(text);
  const found = new Set<TaskStatus>();
  for (const [status, pattern] of STATUS_WORDS) {
    if (pattern.test(t)) {
      found.add(status);
      // "not done" is To Do; don't let its "done" count as well.
      t = t.replace(new RegExp(pattern.source, 'g'), ' ');
    }
  }
  return [...found];
}

// In a list, "what is Mike working on" means his unfinished work, blocked tasks too.
const OPEN_WORDS = /\b(?:open|pending|remaining|incomplete|unfinished|not done|not finished|outstanding|baaki|working on|doing|up to|busy with)\b/;

/** A status filter for a list or a count: every open status, or one status. Null when the words name none. */
export function readStatuses(text: string): TaskStatus[] | null {
  if (OPEN_WORDS.test(norm(text))) return OPEN_STATUSES;
  const status = statusFromWords(text);
  return status ? [status] : null;
}

// ---------------------------------------------------------------- members

const ME = /^(?:me|myself|my ?self|i|mine|my|mujhe|main|khud)$/;
// The user speaking of themselves anywhere in a message: what makes a "me" from the model real.
const FIRST_PERSON = /\b(?:me|my|myself|mine|i|i m|i ve|mujhe|mera|meri|main|khud)\b/;

export const isMe = (name: string) => ME.test(norm(name));

/** "Mike and Priya", "me, Rahul" or a list -> each name, as the user said it. */
export function splitNames(value: unknown): string[] {
  const parts = Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : '')) : [str(value) ?? ''];
  return parts
    .flatMap((p) => p.split(/\s*(?:,|&|\/|\band\b|\bplus\b|\baur\b|\bwith\b)\s*/i))
    .map((name) => name.trim().replace(/^(?:to|for|by|assign(?:ed)? to)\s+/i, ''))
    .filter((name) => name && !isBlank(name));
}

/**
 * Whose tasks a question is about, when the model left the member out (in testing it dropped
 * "Mike Johnson" from "What is Mike Johnson working on?"): "What is X working on", "X's tasks",
 * "tasks for X".
 */
export function whoseTasks(text: string): string | undefined {
  const m =
    /\b(?:what(?:'s|\s+is|\s+are)|which\s+tasks?\s+(?:is|are))\s+(.+?)\s+(?:working on|doing|up to|busy with)\b/i.exec(text) ??
    /(\p{L}+(?:\s+\p{L}+)?)['’]s\s+(?:\p{L}+\s+)?tasks?\b/iu.exec(text) ??
    /\btasks?\s+(?:for|of|assigned to)\s+(.+?)(?:\s+(?:in|due|that|which|this|next)\b|[?.!,]|$)/i.exec(text);
  const name = m ? stripCommandWords(m[1]).replace(/^(?:all|the|my)\s+/i, '').trim() : '';
  return name && !/^(?:the|my|all|our|this|that|these|those)$/i.test(name) ? name : undefined;
}

/** The names the user really said: a "me" needs them speaking of themselves, any other name its own words. */
export function groundedNames(names: string[], userText: string): string[] {
  return names.filter((name) => (isMe(name) ? FIRST_PERSON.test(norm(userText)) : grounded(name, userText)));
}

export type MemberChange = 'add' | 'remove' | 'replace';

/** What a member named on an update does, from the user's own verb ("Add Rahul", "Remove Priya", "Assign to Mike"). */
export function memberChange(text: string): MemberChange {
  const t = norm(text);
  if (/\b(?:remove|unassign|drop|kick|without|hata(?:o|do)?)\b|\btake\b.*\boff\b/.test(t)) return 'remove';
  if (/\b(?:add|also|too|as well|plus|include|join|loop in|bhi)\b/.test(t)) return 'add';
  return 'replace';
}

// ---------------------------------------------------------------- projects and tasks

// A project named on an update is a move only with one of these: "Mark the login bug in Apollo as
// done" names Apollo to tell tasks apart, not to move anything.
const MOVE = /\b(?:move[sd]?|moving|shift(?:ed)?|transfer(?:red)?|belongs? to|change (?:its |the )?project)\b|\bput\b(?!.*\bin progress\b).*\b(?:in|into|under)\b/;

export const asksToMove = (text: string) => MOVE.test(norm(text));

const FILLER = new Set(['the', 'a', 'an', 'my', 'our', 'this', 'that', 'task', 'tasks', 'ticket', 'card', 'item', 'one', 'wala', 'wali', 'wale']);

/** "Mark the login bug task" -> "login bug": the words that name a task. */
export function taskQuery(said: string): string {
  const words = stripCommandWords(said)
    .split(/\s+/)
    .filter((w) => !FILLER.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  return words.join(' ').trim() || said.trim();
}

// Words that never name a task: verbs, statuses, dates and fillers (English and Hinglish).
const NOT_TASK_WORDS = new Set(
  `and for the with from into onto off this that these those its it's please now just also too
  mark set put make change update move push shift transfer rename delete remove add assign reassign unassign give take hand
  done todo blocked block stuck hold progress started start starting finished finish complete completed closed close
  resolved fixed reopen reopened pending waiting paused working doing ongoing
  task tasks ticket card item one wala wali wale kar karo kardo dena gaya gayi hai hain mein
  due next last this coming today tomorrow yesterday week month year monday tuesday wednesday thursday friday saturday sunday
  jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december
  ive has have been was are`.split(/\s+/)
);

/** The words of a query a title must hold, in any order. */
export function taskWords(query: string): string[] {
  return norm(query)
    .split(' ')
    .filter((w) => w.length >= 3 && !NOT_TASK_WORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * The task a message is about, when the model didn't say: what is left after the verbs,
 * statuses, dates, people and projects ("Remove Rahul from the release notes" -> "release notes").
 */
export function taskFromMessage(text: string, others: string[]): string | undefined {
  const skip = new Set(others.flatMap((o) => norm(o).split(' ')));
  const words = taskWords(text).filter((w) => !skip.has(w));
  return words.length ? words.join(' ') : undefined;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A title as the model gave it, without the request around it: "create task to fix the signup
 * page in Apollo" -> "Fix the signup page", when Apollo is the task's project (`around`).
 */
export function cleanTitle(title: string, around: (string | undefined)[]): string {
  let t = title.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  t = t.replace(/^(?:please\s+)?(?:create|add|make|open|new)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:task|to-?do)\b\s*(?:to|for|called|named|about|:)?\s*/i, '');
  t = t.replace(/^(?:a\s+)?(?:task|to-?do)\s+(?:to|for|called|named|about)\s+/i, '').replace(/^to\s+/i, '');
  for (let again = true; again; ) {
    again = false;
    for (const word of around.filter((w): w is string => Boolean(w && w.trim()))) {
      const next = t.replace(new RegExp(`\\s+(?:in|for|under|to|on|by|due|with)\\s+(?:the\\s+)?${escape(word.trim())}(?:\\s+project)?\\s*$`, 'i'), '');
      if (next !== t) [t, again] = [next, true];
    }
  }
  t = t.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : title.trim();
}

// The user's own word for creating or deleting: what makes the model's create_task or delete_task real.
const CREATE_WORDS = /\b(?:create|add|new|make|open|log|raise|banao|bana do|bana de|jodo)\b/;
export const asksToCreate = (text: string) => CREATE_WORDS.test(norm(text));

/** "Delete the offsite task", but not "Remove Rahul from the release notes" (that's a member). */
export function asksToDelete(text: string): boolean {
  const t = norm(text);
  return /\b(?:delete|discard|erase|trash|scrap|cancel|get rid of|hatao|hata do|mita do)\b/.test(t) || (/\bremove\b/.test(t) && !/\bfrom\b/.test(t));
}

// A message about tasks, not a change to one: a question, or a request to look.
const LOOKING = /^(?:show|list|find|search|get|give|count|display|view|which|what|whats|how|who|why|when|where|is|are|was|were|do|does|did|has|have|can|could|should|any)\b/;
// How people state a task's progress: "Mark X as done", "I've started X", "X is blocked", "X done kar do".
const STATEMENT = /\b(?:mark|set|i ve|i have|i m|i am|we ve|we have|it s|is|are|is now|has been|kar do|kardo|kar diya|ho gaya|ho gayi)\b/;

/**
 * A plain statement of one task's progress, read without the model: in testing the model
 * listed tasks for "I've started the review of the API spec". Not a question, no creating or
 * deleting, no "tasks" (lists talk about tasks), exactly one status, and words left for the task.
 */
export function statusStatement(text: string): boolean {
  const t = norm(text);
  if (!t || LOOKING.test(t) || /\?\s*$/.test(text) || asksToCreate(text) || asksToDelete(text) || /\btasks\b/.test(t)) return false;
  return statusesIn(text).length === 1 && STATEMENT.test(t) && taskWords(t).length > 0;
}

// Words that move a due date: "Push the login bug to next Monday".
const DUE_CHANGE = /\b(?:push|postpone|delay|reschedule|extend|prepone|bring forward|due|deadline)\b/;
export const changesDueDate = (text: string) => DUE_CHANGE.test(norm(text));

/**
 * Members named in a message, when the model didn't pass them: "Add Mike Johnson to …",
 * "Remove Rahul from …", "Take Mike off …", "Assign … to Priya".
 */
export function membersFromMessage(text: string): string[] {
  const m =
    /\b(?:add|remove|unassign|take|include)\s+(.+?)\s+(?:to|from|off|on|onto|in|into)\b/i.exec(text) ??
    /\b(?:assign|reassign|give|hand(?:\s+over)?|allot)\b.*?\bto\s+(.+?)\s*[.!?]?$/i.exec(text);
  return m ? splitNames(m[1]).filter((name) => !/\b(?:task|the|it|this|that)\b/i.test(name)) : [];
}

export const titleHasWords = (title: string, words: string[]) => {
  const t = norm(title);
  return words.length > 0 && words.every((w) => t.includes(w));
};

// ---------------------------------------------------------------- create

export const TASK_FIELDS = ['title', 'description', 'dueDate', 'project', 'members', 'status'] as const;
export type TaskArgs = Partial<Record<Exclude<(typeof TASK_FIELDS)[number], 'members'>, string>> & { members?: string[] };

/**
 * The model's values, cleaned: blanks dropped, a stray `name` read as the title, and a title,
 * description, project or member kept only if the user said it. The due date must be in the
 * latest message (`latestText`), as on Projects.
 */
export function cleanTaskArgs(raw: Record<string, unknown>, userText: string, latestText: string, fromButton: boolean): TaskArgs {
  const args: TaskArgs = {};
  const title = str(raw.title) ?? str(raw.name);
  if (title && (fromButton || heardText(title, userText))) args.title = title;
  const description = str(raw.description);
  if (description && (fromButton || heardText(description, userText))) args.description = description;
  // A description that only repeats the title was the model's, not the user's ("Same as the title" is a button).
  if (!fromButton && args.title && args.description && sameText(args.title, args.description)) delete args.description;
  const due = str(raw.dueDate) ?? str(raw.due);
  if (due && (fromButton || grounded(due, latestText))) args.dueDate = due;
  const project = str(raw.project);
  if (project && (fromButton || grounded(project, userText))) args.project = project;
  const names = splitNames(raw.members ?? raw.member ?? raw.assignee);
  const members = fromButton ? names : groundedNames(names, userText);
  if (members.length) args.members = members;
  const status = str(raw.status);
  if (status) args.status = status;
  return args;
}

// A reply that is a new request ("show my tasks", "cancel") rather than the missing detail.
const NEW_REQUEST = /^(?:cancel|stop|never ?mind|no|nope|show|list|find|delete|remove|rename|mark|move|count|how many|what|which|who)\b/i;

/**
 * The fast path for a follow-up, for the details that need no lookup: when exactly one is
 * missing, a plain reply fills it (a date for the due date, the reply itself for a
 * description or title). The project and members are matched in task.module.ts.
 */
export function fillTaskFromText(missing: string[], reply: string, today: string): TaskArgs | null {
  if (missing.length !== 1) return null;
  const text = reply.trim().replace(/[.!]+$/, '');
  if (!text || NEW_REQUEST.test(text)) return null;
  if (missing[0] === 'dueDate') {
    const day = resolveDate(text, today);
    return day ? { dueDate: day } : null;
  }
  if (missing[0] === 'description') {
    const description = text.replace(/^(?:the )?(?:description is|description:|details:|it'?s about|it is about|about)\s+/i, '');
    return description.length <= 1000 ? { description } : null;
  }
  if (missing[0] === 'title') {
    const title = text.replace(/^(?:call it|name it|it'?s called|it is called|the title is|title:)\s+/i, '');
    return title.split(/\s+/).length <= 12 ? { title } : null;
  }
  return null;
}
