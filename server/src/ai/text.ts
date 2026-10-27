// Text helpers shared by the AI modules. The model only suggests values; these decide
// what is kept (blank checks, grounding in what the user said, matching names to records).

const BLANKS = new Set(['', 'n/a', 'na', 'none', 'null', 'undefined', 'unknown', '-', 'not given', 'not provided']);

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  return BLANKS.has(value.trim().toLowerCase());
}

/** A trimmed string, or undefined when blank or not a string. */
export function str(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string' || isBlank(value)) return undefined;
  return value.trim();
}

// Letters (and their combining marks) in any script, so names like "José" or "प्रिया" compare correctly.
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True when some word of `value` (2+ letters) appears in what the user wrote: catches invented names. */
export function grounded(value: string, userText: string): boolean {
  const haystack = ` ${norm(userText)} `;
  return norm(value)
    .split(' ')
    .filter((w) => w.length >= 2)
    .some((w) => haystack.includes(` ${w} `));
}

/** True when `phrase` appears in `text` as whole words ("make Mike a Manager" mentions "Manager"). */
export function mentions(text: string, phrase: string): boolean {
  const p = norm(phrase);
  return Boolean(p) && ` ${norm(text)} `.includes(` ${p} `);
}

export type Match<T> = { kind: 'one'; item: T } | { kind: 'none' } | { kind: 'many'; items: T[] };

// Words people add around a name: "the Engineering department", "the Apollo project".
const STOP_WORDS = /\b(department|dept|team|division|role|access|project)\b/g;

/**
 * Finds the record the user meant: by id, exact name, initials ("HR" = "Human Resources"),
 * unique prefix, or a unique whole-word match. Never guesses between several.
 */
export function matchByName<T>(items: T[], query: string, nameOf: (item: T) => string, idOf: (item: T) => string): Match<T> {
  const byId = items.find((i) => idOf(i) === query);
  if (byId) return { kind: 'one', item: byId };
  const q = norm(query).replace(STOP_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return { kind: 'none' };
  const named = items.map((item) => ({ item, name: norm(nameOf(item)).replace(STOP_WORDS, ' ').replace(/\s+/g, ' ').trim() }));
  const pick = (found: typeof named): Match<T> | null =>
    found.length === 1 ? { kind: 'one', item: found[0].item } : found.length > 1 ? { kind: 'many', items: found.map((f) => f.item) } : null;
  const initials = (name: string) =>
    name
      .split(' ')
      .map((w) => w[0])
      .join('');
  return (
    pick(named.filter((n) => n.name === q)) ??
    pick(named.filter((n) => q.length >= 2 && !q.includes(' ') && initials(n.name) === q && n.name.includes(' '))) ??
    pick(named.filter((n) => n.name.startsWith(q))) ??
    pick(named.filter((n) => ` ${n.name} `.includes(` ${q} `))) ?? { kind: 'none' }
  );
}

/** "a", "a or b", "a, b or c". */
export function orList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** "a", "a and b", "a, b and c". */
export function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Newer non-blank values win; earlier ones are kept when the model drops them. */
export function mergeArgs<T extends Record<string, unknown>>(earlier: Partial<T>, later: Partial<T>): Partial<T> {
  const merged: Partial<T> = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    if (!isBlank(value)) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** "Mark Apollo" -> "Apollo": command words the model sometimes copies into a name it looks up. */
export function stripCommandWords(query: string): string {
  const stripped = query
    .replace(/^\s*(?:please\s+)?(?:mark|set|put|make|change|update|move|push|rename|delete|remove|show|find|open|close|disable|enable|deactivate|reactivate|activate)\s+/i, '')
    .replace(/^the\s+/i, '')
    .trim();
  return stripped || query.trim();
}

// Words that carry nothing on their own, for checking that free text came from the user.
// Shared by Tasks and Documents; their own nouns ("task", "document", "file") count as common too.
const COMMON = new Set(['the', 'and', 'for', 'with', 'what', 'about', 'task', 'document', 'documents', 'file', 'files', 'this', 'that', 'from', 'into', 'are', 'was', 'has', 'have', 'new', 'all']);

/**
 * Free text (a title, a description) the user really gave: at least one real word of it in
 * what they said. In testing, the model filled a description with "What the task is about",
 * the hint for that field, which `grounded()` let through on "the" and "task".
 */
export function heardText(value: string, text: string): boolean {
  const said = ` ${norm(text)} `;
  return norm(value)
    .split(' ')
    .some((w) => w.length >= 3 && !COMMON.has(w) && said.includes(` ${w} `));
}

/** The same words, give or take: a description the model copied from the title. */
export function sameText(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
}

/** "Add a task X in Hermes, due 30 Oct: cover login and signup" (Tasks, Documents) -> "cover login and signup". */
export function colonDescription(text: string): string | undefined {
  const at = text.lastIndexOf(':');
  const after = at >= 0 ? text.slice(at + 1).trim().replace(/[.!]+$/, '') : '';
  return after.split(/\s+/).length >= 2 ? after : undefined;
}
