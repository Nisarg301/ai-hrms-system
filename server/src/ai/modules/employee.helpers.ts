// Pure helpers for the Employees assistant: the checks that make a small local model safe
// to use (docs/AI_EMPLOYEE_ASSISTANT.md, section 8). Generic ones live in ../text.ts.

import { grounded, norm, str } from '../text';

// Shared text helpers, re-exported for the employee tools and tests.
export { andList, grounded, isBlank, matchByName, mentions, mergeArgs, orList, str } from '../text';
export type { Match } from '../text';

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const EMAIL_EXACT = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/** "mike at company dot com" -> "mike@company.com" (how speech recognition writes a spoken email). */
function unspeak(text: string): string {
  return text.replace(/\b([a-z0-9._%+-]+)\s+at\s+([a-z0-9-]+(?:\s*(?:dot|\.)\s*[a-z0-9-]+)+)\b/gi, (_m, user: string, domain: string) =>
    `${user}@${domain.replace(/\s*(?:dot|\.)\s*/gi, '.')}`
  );
}

/** Every email address in a message, lower-cased, spoken forms included. */
export function findEmails(text: string): string[] {
  return [...new Set((unspeak(text).match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/\.$/, '')))];
}

/** A single email value from the model, or null when it isn't one. */
export function normalizeEmail(value: string): string | null {
  const candidate = unspeak(value.trim()).replace(/\s+/g, '').toLowerCase();
  return EMAIL_EXACT.test(candidate) ? candidate : null;
}

/** Details the employee record has no field for, by the words that give them away. */
const UNSUPPORTED: { label: string; pattern: RegExp }[] = [
  { label: 'salary', pattern: /\b(salary|ctc|lakhs?|lacs?|per annum|pay(?:scale)?|stipend|wages?)\b|₹|\brs\.?\s*\d/i },
  { label: 'phone number', pattern: /\b(phone|mobile|cell|contact number|whatsapp)\b/i },
  { label: 'address', pattern: /\b(address|lives in|resides)\b/i },
  { label: 'employee ID', pattern: /\b(employee id|emp id|employee code|emp code|staff id)\b/i },
];

export function unsupportedDetails(text: string): string[] {
  return UNSUPPORTED.filter((u) => u.pattern.test(text)).map((u) => u.label);
}

/** In testing the model put "salary 75,000" into jobTitle; a real job title has no amounts or numbers. */
export function looksLikeJobTitle(value: string): boolean {
  if (value.length > 80 || /@/.test(value) || /\d{2,}/.test(value)) return false;
  return unsupportedDetails(value).length === 0;
}

export const CREATE_FIELDS = ['name', 'email', 'jobTitle', 'department', 'role', 'manager', 'joiningDate', 'dateOfBirth', 'copyFrom'] as const;
export type CreateField = (typeof CREATE_FIELDS)[number];
export type CreateArgs = Partial<Record<CreateField, string>>;

/**
 * The model's create_employee args, cleaned: blanks dropped, an email only if the user
 * actually gave it, a job title only if it looks like one, a name only if the user said it.
 * Whatever can't be stored is reported in `notSaved`.
 */
export function cleanCreateArgs(raw: Record<string, unknown>, userText: string, latestText: string): { args: CreateArgs; notSaved: string[] } {
  const args: CreateArgs = {};
  const notSaved = new Set(unsupportedDetails(latestText));
  for (const field of CREATE_FIELDS) {
    const value = str(raw[field]);
    if (value) args[field] = value;
  }
  if (str(raw.otherDetails)) unsupportedDetails(String(raw.otherDetails)).forEach((d) => notSaved.add(d));
  if (args.email) {
    const email = normalizeEmail(args.email);
    if (!email || !findEmails(userText).includes(email)) delete args.email;
    else args.email = email;
  }
  if (args.jobTitle && !looksLikeJobTitle(args.jobTitle)) {
    unsupportedDetails(args.jobTitle).forEach((d) => notSaved.add(d));
    delete args.jobTitle;
  }
  if (args.name && !grounded(args.name, userText)) delete args.name;
  // A role that is really the job title ("QA Engineer") is caught later: it matches no role.
  return { args, notSaved: [...notSaved] };
}

/** Labels used in questions, in the order they are asked. */
export const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  email: 'email address',
  jobTitle: 'job title',
  department: 'department',
  role: 'access role',
};

/**
 * The server fast path for a follow-up reply: fills missing fields from plain text without
 * a model call. Only certain things are taken: emails, and department or role names that
 * appear word for word. A lone short reply fills the one free-text field still missing.
 */
export function fillFromText(
  missing: string[],
  reply: string,
  options: { departments: string[]; roles: string[] }
): Partial<Record<'email' | 'department' | 'role' | 'jobTitle' | 'name', string>> {
  const filled: Partial<Record<'email' | 'department' | 'role' | 'jobTitle' | 'name', string>> = {};
  const text = ` ${norm(reply)} `;
  if (missing.includes('email')) {
    const emails = findEmails(reply);
    if (emails.length === 1) filled.email = emails[0];
  }
  const findName = (names: string[]) => {
    const hits = names.filter((n) => norm(n) && text.includes(` ${norm(n)} `));
    return hits.length === 1 ? hits[0] : undefined;
  };
  if (missing.includes('department')) {
    const hit = findName(options.departments);
    if (hit) filled.department = hit;
  }
  if (missing.includes('role')) {
    const hit = findName(options.roles);
    if (hit) filled.role = hit;
  }
  const freeText: string[] = missing.filter((m) => m === 'jobTitle' || m === 'name');
  const rest = missing.filter((m) => !freeText.includes(m) && !(m in filled));
  if (freeText.length === 1 && rest.length === 0 && Object.keys(filled).length === 0) {
    let value = stripLeadIn(reply);
    // Articles only before a job title: "An Nguyen" is a name.
    if (freeText[0] === 'jobTitle') value = value.replace(/^(?:an?|the)\s+/i, '');
    const words = norm(value).split(' ').filter(Boolean);
    if (words.length >= 1 && words.length <= 5) {
      if (freeText[0] === 'jobTitle' && looksLikeJobTitle(value)) filled.jobTitle = value;
      if (freeText[0] === 'name' && !/\d|@/.test(value)) filled.name = value;
    }
  }
  return filled;
}

/** "He is a Software Engineer." -> "a Software Engineer"; "Her name is Sara Khan" -> "Sara Khan". */
function stripLeadIn(reply: string): string {
  return reply
    .trim()
    .replace(/^(?:(?:he|she|they)\s+(?:is|are|will be)|(?:his|her|their|the)\s+(?:job title|title|designation|name)\s+is|(?:job title|title|designation|name)\s*(?:is|:)|it'?s)\s+/i, '')
    .replace(/[.!]+$/, '')
    .trim();
}
