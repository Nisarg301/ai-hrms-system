// Pure helpers for the Projects assistant (docs/AI_PROJECTS_ASSISTANT.md, section 7).
// The model copies the user's words; these turn them into a status, a date range or a
// deadline the API understands.

import { PROJECT_STATUSES, ProjectStatus } from '../../models/project.model';
import { todayIso, zonedInstant } from '../../utils/dates';
import { resolveDate } from '../dates';
import { grounded, norm, str } from '../text';

export { PROJECT_STATUSES };
export type { ProjectStatus };

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  'on-hold': 'On hold',
};

// Checked in order: "not started" before "started", "on hold" before anything else.
const STATUS_WORDS: [ProjectStatus, RegExp][] = [
  ['planning', /\bnot (?:yet )?started\b/],
  ['on-hold', /\b(on ?hold|hold|paused?|blocked|stopped|frozen|halted)\b/],
  ['completed', /\b(completed?|done|finish(?:ed)?|closed|delivered|wrapped up)\b/],
  ['active', /\b(active|in ?progress|ongoing|started|start|running|live|resumed?|kicked off|working)\b/],
  ['planning', /\b(planning|planned|new|draft|upcoming)\b/],
];

/** "on hold" -> 'on-hold', "done" -> 'completed'. Null when the words name no status. */
export function statusFromWords(text: string): ProjectStatus | null {
  const t = norm(text);
  if ((PROJECT_STATUSES as readonly string[]).includes(text.trim().toLowerCase())) return text.trim().toLowerCase() as ProjectStatus;
  return STATUS_WORDS.find(([, pattern]) => pattern.test(t))?.[0] ?? null;
}

/** Every status the words mention: "from on hold back to active" -> ['on-hold', 'active']. */
export function statusesIn(text: string): ProjectStatus[] {
  let t = norm(text);
  const found = new Set<ProjectStatus>();
  for (const [status, pattern] of STATUS_WORDS) {
    if (pattern.test(t)) {
      found.add(status);
      // "not started" is planning; don't let "started" count as active as well.
      if (status === 'planning') t = t.replace(/\bnot (?:yet )?started\b/, ' ');
    }
  }
  return [...found];
}

/** A deadline from the API (an instant) -> its calendar day in APP_TIMEZONE. */
export function deadlineDay(deadline: string | Date): string {
  return todayIso(new Date(deadline));
}

/** A calendar day -> the instant the Projects page stores for it: the start of that day in APP_TIMEZONE. */
export function deadlineInstant(day: string): string {
  return zonedInstant(day, '00:00').toISOString();
}

// Shared with the Tasks assistant: "overdue", "this week", "before 31 Dec" -> a range of days.
export { dueRange } from '../dates';
export type { DueRange } from '../dates';

export const PROJECT_FIELDS = ['name', 'description', 'deadline', 'status'] as const;
export type ProjectArgs = Partial<Record<(typeof PROJECT_FIELDS)[number], string>>;

/** The model's values, cleaned: blanks dropped, and a name or description only if the user said it. */
export function cleanProjectArgs(raw: Record<string, unknown>, userText: string): ProjectArgs {
  const args: ProjectArgs = {};
  for (const field of PROJECT_FIELDS) {
    const value = str(raw[field]);
    if (value) args[field] = value;
  }
  if (args.name && !grounded(args.name, userText)) delete args.name;
  if (args.description && !grounded(args.description, userText)) delete args.description;
  return args;
}

/**
 * The fast path for a follow-up: when exactly one thing is missing, a plain reply fills it
 * without a model call (a date for the deadline, the reply itself for a description or name).
 */
export function fillProjectFromText(missing: string[], reply: string, today: string): ProjectArgs | null {
  if (missing.length !== 1) return null;
  const text = reply.trim().replace(/[.!]+$/, '');
  if (!text) return null;
  if (missing[0] === 'deadline') {
    const day = resolveDate(text, today);
    return day ? { deadline: day } : null;
  }
  if (missing[0] === 'description') {
    const description = text.replace(/^(?:the )?(?:description is|description:|it'?s about|it is about|about)\s+/i, '');
    return description.length <= 500 ? { description } : null;
  }
  if (missing[0] === 'name') {
    const name = text.replace(/^(?:call it|name it|it'?s called|it is called|the name is|name:)\s+/i, '');
    return name.split(/\s+/).length <= 8 ? { name } : null;
  }
  return null;
}
