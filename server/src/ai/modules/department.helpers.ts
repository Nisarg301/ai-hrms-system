// Pure helpers for the Departments assistant (docs/AI_DEPARTMENTS_ASSISTANT.md, section 7).
// The model copies the user's words; these turn them into a status, and decide which of
// the model's values were really given by the user.

import { DEPARTMENT_STATUSES, DepartmentStatus } from '../../models/department.model';
import { grounded, mentions, norm, str } from '../text';

export { DEPARTMENT_STATUSES };
export type { DepartmentStatus };

export const STATUS_LABELS: Record<DepartmentStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
};

// Checked in order: "not active" and "deactivate" before "active", so they never count as active too.
const STATUS_WORDS: [DepartmentStatus, RegExp][] = [
  [
    'inactive',
    /\b(inactive|not (?:active|in use)|de ?activat(?:e|ed|ing)|disabled?|closed?|archived?|dormant|retired?|shut ?down|(?:turn|switch)(?:ed)? off|band kar)\b/,
  ],
  ['active', /\b(active|re ?activated?|activated?|enabled?|in use|resumed?|re ?open(?:ed)?|chalu)\b/],
];

/** "deactivate" -> 'inactive', "make it active again" -> 'active'. Null when the words name no status. */
export function statusFromWords(text: string): DepartmentStatus | null {
  const exact = text.trim().toLowerCase();
  if ((DEPARTMENT_STATUSES as readonly string[]).includes(exact)) return exact as DepartmentStatus;
  const t = norm(text);
  return STATUS_WORDS.find(([, pattern]) => pattern.test(t))?.[0] ?? null;
}

/** Every status the words mention: "from inactive back to active" -> ['inactive', 'active']. */
export function statusesIn(text: string): DepartmentStatus[] {
  let t = norm(text);
  const found = new Set<DepartmentStatus>();
  for (const [status, pattern] of STATUS_WORDS) {
    if (pattern.test(t)) {
      found.add(status);
      // "not active" is inactive; don't let its "active" count as well.
      t = t.replace(new RegExp(pattern.source, 'g'), ' ');
    }
  }
  return [...found];
}

/** The tool says `name` (the word people use); the API calls it `title`. */
export const DEPARTMENT_FIELDS = ['name', 'description', 'status'] as const;
export type DepartmentArgs = Partial<Record<(typeof DEPARTMENT_FIELDS)[number], string>>;

/**
 * The model's values, cleaned: blanks dropped, a stray `title` read as the name, and a name
 * or description kept only if the user said it. "Design department" becomes "Design" unless
 * the user said those words together.
 */
export function cleanDepartmentArgs(raw: Record<string, unknown>, userText: string): DepartmentArgs {
  const args: DepartmentArgs = {};
  const name = str(raw.name) ?? str(raw.title);
  if (name) args.name = name;
  const description = str(raw.description);
  if (description) args.description = description;
  const status = str(raw.status);
  if (status) args.status = status;
  if (args.name && !grounded(args.name, userText)) delete args.name;
  if (args.name && /\s+(?:department|dept)\.?$/i.test(args.name) && !mentions(userText, args.name)) {
    args.name = args.name.replace(/\s+(?:department|dept)\.?$/i, '');
  }
  if (args.description && !grounded(args.description, userText)) delete args.description;
  return args;
}

// A reply that is a new request ("show all departments", "cancel") rather than the missing detail.
const NEW_REQUEST = /^(?:cancel|stop|never ?mind|no|nope|show|list|find|delete|remove|rename|deactivate|reactivate|activate|count|how many|what|which|who)\b/i;

/**
 * The fast path for a follow-up: when exactly one of name and description is missing, a plain
 * reply fills it without a model call.
 */
export function fillDepartmentFromText(missing: string[], reply: string): DepartmentArgs | null {
  if (missing.length !== 1) return null;
  const text = reply.trim().replace(/[.!]+$/, '');
  if (!text || NEW_REQUEST.test(text)) return null;
  if (missing[0] === 'description') {
    const description = text.replace(/^(?:the )?(?:description is|description:|it handles|it'?s for|it is for|it does|about)\s+/i, '');
    return description.length <= 500 ? { description } : null;
  }
  if (missing[0] === 'name') {
    const name = text.replace(/^(?:call it|name it|it'?s called|it is called|the name is|name:|title:)\s+/i, '');
    return name.split(/\s+/).length <= 8 ? { name } : null;
  }
  return null;
}
