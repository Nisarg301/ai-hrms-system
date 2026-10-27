// Pure helpers for the Roles assistant (docs/AI_ROLES_ASSISTANT.md, section 2). The server reads a
// role's permissions from the user's own words ("read and update on tasks, select all on
// documents") and applies them with the Roles page's rules: Read is a gate, plan modules only.

import { MODULES, ModuleName } from '../../constants/modules';
import { norm } from '../text';
import { isQuestion } from './exports.helpers';

export const ACTIONS = ['read', 'create', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];
export type Flags = Record<Action, boolean>;
export type Matrix = Partial<Record<ModuleName, Flags>>;
export interface PermissionEntry extends Flags {
  module: ModuleName;
}

export const MODULE_LABELS: Record<ModuleName, string> = {
  dashboard: 'Dashboard',
  employees: 'Employees',
  documents: 'Documents',
  projects: 'Projects',
  tasks: 'Tasks',
  departments: 'Departments',
  exports: 'Exports',
  auditLogs: 'Audit Logs',
};
const ACTION_LABELS: Record<Action, string> = { read: 'Read', create: 'Create', update: 'Update', delete: 'Delete' };

export const NONE: Flags = { read: false, create: false, update: false, delete: false };
export const ALL: Flags = { read: true, create: true, update: true, delete: true };

// ---------------------------------------------------------------- reading a phrase

type Op = 'set' | 'grant' | 'revoke';
interface Clause {
  op?: Op;
  actions: Set<Action | 'all'>;
  modules: Set<ModuleName | 'every'>;
  /** Which came first: actions ("read on tasks") or modules ("tasks: read"). */
  order?: 'actions' | 'modules';
}

// Phrases that are one token. Checked before single words, longest first.
const PHRASES: [RegExp, string][] = [
  [/\b(?:select all|all permissions?|full access|full permissions?|full control|all access|all rights|all actions|all four|crud)\b/g, ' #all '],
  [/\b(?:all (?:the )?modules?|every module|each module|everything|everywhere)\b/g, ' #every '],
  [/\baudit ?logs?\b/g, ' auditlogs '],
  [/\bteam members?\b/g, ' employees '],
  [/\bto ?dos?\b/g, ' tasks '],
  [/\bread ?only\b/g, ' read '],
  // "Create a new role": "new" names the role, not the Create action.
  [/\bnew roles?\b/g, ' '],
  [/\b(?:take away|take off|but not|other than|apart from)\b/g, ' #revoke '],
];

const MODULE_WORDS: Record<string, ModuleName> = {
  dashboard: 'dashboard', dashboards: 'dashboard',
  employee: 'employees', employees: 'employees', staff: 'employees', people: 'employees',
  document: 'documents', documents: 'documents', doc: 'documents', docs: 'documents',
  project: 'projects', projects: 'projects',
  task: 'tasks', tasks: 'tasks',
  department: 'departments', departments: 'departments', dept: 'departments', depts: 'departments',
  export: 'exports', exports: 'exports',
  auditlogs: 'auditLogs', audit: 'auditLogs',
};
const ACTION_WORDS: Record<string, Action> = {
  read: 'read', reads: 'read', reading: 'read', view: 'read', views: 'read', viewing: 'read', see: 'read', access: 'read',
  create: 'create', creates: 'create', creating: 'create', new: 'create',
  update: 'update', updates: 'update', updating: 'update', edit: 'update', edits: 'update', editing: 'update', change: 'update', changes: 'update', modify: 'update', modifies: 'update',
  delete: 'delete', deletes: 'delete', deleting: 'delete',
};
const GRANT = new Set(['give', 'grant', 'allow', 'enable', 'assign']);
const REVOKE = new Set(['#revoke', 'revoke', 'disable', 'deny', 'drop', 'strip', 'without', 'no', 'not', 'except', 'cannot']);

type Token = { kind: 'action'; value: Action | 'all' } | { kind: 'module'; value: ModuleName | 'every' } | { kind: 'op'; value: Op };

/** The meaningful words of a phrase, in order. "add" and "remove" are an op before an action or module, else an action. */
function tokenize(text: string): Token[] {
  let t = ` ${norm(text)} `;
  for (const [pattern, token] of PHRASES) t = t.replace(pattern, token);
  const words = t.split(' ').filter(Boolean);
  const kindOf = (w: string | undefined): 'action' | 'module' | 'other' =>
    w === undefined
      ? 'other'
      : w === '#all' || ACTION_WORDS[w] || /^(?:add|adds|adding|remove|removes|removing)$/.test(w)
        ? 'action'
        : w === '#every' || MODULE_WORDS[w]
          ? 'module'
          : 'other';
  const tokens: Token[] = [];
  words.forEach((w, i) => {
    // An action word or "can" before it ("can add and remove tasks") makes it an action too.
    const asAction = /^(?:can|could|may|to)$/.test(words[i - 1] ?? '') || kindOf(words[i - 1]) === 'action' || (/^(?:and|or)$/.test(words[i - 1] ?? '') && kindOf(words[i - 2]) === 'action');
    // What the word is about, past a few fillers ("remove the create permission", "remove access to documents").
    const ahead = words.slice(i + 1, i + 4).find((x) => kindOf(x) !== 'other' || x === 'access');
    if (/^(?:add|adds|adding)$/.test(w)) {
      tokens.push(!asAction && kindOf(words[i + 1]) === 'action' ? { kind: 'op', value: 'grant' } : { kind: 'action', value: 'create' });
    } else if (/^(?:remove|removes|removing)$/.test(w)) {
      tokens.push(!asAction && ahead !== undefined ? { kind: 'op', value: 'revoke' } : { kind: 'action', value: 'delete' });
    } else if (w === 'delete' && !asAction && ahead !== undefined && kindOf(ahead) === 'action') {
      // "Delete the create permission on tasks": taking Create away, not granting Delete.
      tokens.push({ kind: 'op', value: 'revoke' });
    } else if (w === '#all') tokens.push({ kind: 'action', value: 'all' });
    else if (w === '#every') tokens.push({ kind: 'module', value: 'every' });
    else if (ACTION_WORDS[w]) tokens.push({ kind: 'action', value: ACTION_WORDS[w] });
    else if (MODULE_WORDS[w]) tokens.push({ kind: 'module', value: MODULE_WORDS[w] });
    else if (GRANT.has(w)) tokens.push({ kind: 'op', value: 'grant' });
    else if (REVOKE.has(w)) tokens.push({ kind: 'op', value: 'revoke' });
  });
  return tokens;
}

/**
 * A phrase's clauses, each pairing actions with modules in either order: "read and create on
 * employees, select all on documents" → two clauses; "tasks: read" → one; "all permissions" → one
 * with no module (every module).
 */
export function readClauses(text: string): Clause[] {
  const clauses: Clause[] = [];
  let c: Clause = { actions: new Set(), modules: new Set() };
  const close = () => {
    if (c.actions.size || c.modules.size) clauses.push(c);
    c = { op: undefined, actions: new Set(), modules: new Set() };
  };
  for (const tok of tokenize(text)) {
    if (tok.kind === 'op') {
      // An op starts a new clause, unless it is the first thing in this one.
      if (c.actions.size || c.modules.size) close();
      c.op = tok.value;
    } else if (tok.kind === 'action') {
      if (c.order === 'actions' && c.modules.size) {
        const op = c.op;
        close();
        // "give read on tasks and update on projects": the op carries on.
        c.op = op === 'grant' || op === 'revoke' ? op : undefined;
      }
      c.order ??= 'actions';
      c.actions.add(tok.value);
    } else {
      if (c.order === 'modules' && c.actions.size) {
        const op = c.op;
        close();
        c.op = op === 'grant' || op === 'revoke' ? op : undefined;
      }
      c.order ??= 'modules';
      c.modules.add(tok.value);
    }
  }
  close();
  return clauses;
}

export interface Applied {
  matrix: Matrix;
  /** "Read is added for Tasks: …", "Not in your plan: Exports". */
  notes: string[];
  /** Actions named with no module ("read only"): the question to ask. */
  question?: string;
  /** The phrase named at least one permission. */
  said: boolean;
}

const flagsOf = (actions: Set<Action | 'all'>): Flags =>
  actions.has('all') ? { ...ALL } : { read: actions.has('read'), create: actions.has('create'), update: actions.has('update'), delete: actions.has('delete') };

/**
 * The clauses applied to `base` (empty for a new role, the role's own for an update). A clause
 * with no op sets its modules to exactly its actions; give adds; remove takes away. Then the page's
 * rules: Read is added where another action needs it, and only the plan's modules count.
 */
export function applyClauses(base: Matrix, clauses: Clause[], planModules: readonly ModuleName[]): Applied {
  const matrix: Matrix = {};
  for (const m of planModules) matrix[m] = { ...(base[m] ?? NONE) };
  const outside = new Set<ModuleName>();
  const readAdded = new Set<ModuleName>();
  const unplaced: string[] = [];
  for (const clause of clauses) {
    const named = [...clause.modules];
    const every = named.includes('every') || (!named.length && clause.actions.has('all'));
    if (!named.length && !every) {
      unplaced.push(...[...clause.actions].map((a) => (a === 'all' ? 'all permissions' : ACTION_LABELS[a])));
      continue;
    }
    const modules = every ? [...planModules] : (named.filter((m) => m !== 'every') as ModuleName[]);
    for (const m of modules) if (!planModules.includes(m)) outside.add(m);
    const flags = flagsOf(clause.actions);
    for (const m of modules.filter((x) => planModules.includes(x))) {
      const cur = matrix[m]!;
      let next: Flags;
      if (clause.op === 'revoke') next = !clause.actions.size || clause.actions.has('all') || flags.read ? { ...NONE } : { read: cur.read, create: cur.create && !flags.create, update: cur.update && !flags.update, delete: cur.delete && !flags.delete };
      else if (clause.op === 'grant') next = { read: cur.read || flags.read, create: cur.create || flags.create, update: cur.update || flags.update, delete: cur.delete || flags.delete };
      else if (!clause.actions.size) {
        // "employees" alone, with no action and no op: nothing to set.
        unplaced.push(MODULE_LABELS[m]);
        continue;
      } else next = flags;
      // Read is a gate: Create, Update and Delete grant nothing without it.
      if (!next.read && (next.create || next.update || next.delete)) {
        next.read = true;
        readAdded.add(m);
      }
      matrix[m] = next;
    }
  }
  const notes: string[] = [];
  if (readAdded.size) notes.push(`Read is added for ${andWords([...readAdded].map((m) => MODULE_LABELS[m]))}: Create, Update and Delete need it.`);
  if (outside.size) notes.push(`Not in your plan, so left out: ${andWords([...outside].map((m) => MODULE_LABELS[m]))}.`);
  const question = unplaced.length ? `Which modules should get ${andWords([...new Set(unplaced)])}? Name them, or say "all modules".` : undefined;
  return { matrix, notes, question, said: clauses.length > 0 };
}

const andWords = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// ---------------------------------------------------------------- matrices and words

export function matrixOf(entries: { module: string; read: boolean; create: boolean; update: boolean; delete: boolean }[]): Matrix {
  const matrix: Matrix = {};
  for (const e of entries) if ((MODULES as readonly string[]).includes(e.module)) matrix[e.module as ModuleName] = { read: e.read, create: e.create, update: e.update, delete: e.delete };
  return matrix;
}

/** As the page sends them: one entry per plan module that has Read. */
export function entriesOf(matrix: Matrix, planModules: readonly ModuleName[]): PermissionEntry[] {
  return planModules.filter((m) => matrix[m]?.read).map((m) => ({ module: m, ...matrix[m]! }));
}

/** "Read, Create, Update", "all", or "—". */
export function flagsText(flags: Flags | undefined): string {
  if (!flags || !flags.read) return '—';
  if (flags.create && flags.update && flags.delete) return 'all';
  return ACTIONS.filter((a) => flags[a]).map((a) => ACTION_LABELS[a]).join(', ');
}

/** "Employees: all · Projects: Read", or "No permissions". */
export function matrixText(matrix: Matrix, planModules: readonly ModuleName[]): string {
  const parts = planModules.filter((m) => matrix[m]?.read).map((m) => `${MODULE_LABELS[m]}: ${flagsText(matrix[m])}`);
  return parts.length ? parts.join(' · ') : 'No permissions';
}

export const sameFlags = (a: Flags | undefined, b: Flags | undefined) => ACTIONS.every((x) => Boolean(a?.[x]) === Boolean(b?.[x]));

// ---------------------------------------------------------------- names and intent

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The phrase without the role's own name(s) and the command around it: what is left to read as permissions. */
export function permissionText(text: string, names: (string | undefined)[]): string {
  let t = ` ${text} `;
  for (const name of names.filter((n): n is string => Boolean(n && n.trim()))) t = t.replace(new RegExp(`\\b${escape(name.trim())}\\b`, 'i'), ' #name ');
  // A command verb at the start ("Create a role …", "Update HR Manager: …") is not an action,
  // unless an action follows it ("Add delete on tasks …", "Remove the create permission …").
  const lead = /^\s*(?:please\s+)?(create|make|set up|setup|build|new|update|edit|modify|change|delete|remove)\b/i.exec(t);
  if (lead) {
    const rest = t.slice(lead[0].length);
    const command = /^\s*(?:(?:a|an|the|new|role|this|that|it|#name)\b|[:,]|$)/i.test(rest);
    const takesAway = /^(?:delete|remove)$/i.test(lead[1]) && tokenize(rest.split(/\s+/).slice(0, 4).join(' ')).some((x) => x.kind === 'action');
    if (command && !takesAway) t = rest;
  }
  return t.replace(/#name/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A role's name as the model or the message gave it, without the request around it. */
export function cleanRoleName(name: string): string {
  return name
    .trim()
    .replace(/^(?:please\s+)?(?:create|make|add|set up|update|edit|change|modify|delete|remove|rename|show|give|grant|revoke|select|set|take)\s+/i, '')
    .replace(/^(?:(?:a|an|the|new|role|called|named|titled)\s+)+/i, '')
    .replace(/\s+(?:with|having|that|which|who)\b.*$/i, '')
    .replace(/\s+role$/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

/** The role's name from the message itself: "role called X with …", "role X with …", "the X role". */
export function roleNameFrom(text: string): string | undefined {
  const m =
    /\brole\s+(?:called\s+|named\s+|titled\s+|as\s+)?(?!(?:with|having|that|which|who|for|to|and)\b)["“']?([^"”',.:;]+?)["”']?(?=\s+(?:with|having|that|which|who|and give|giving|granting|to)\b|[,.:;]|$)/i.exec(text) ??
    /\b(?:called|named|titled)\s+["“']?([^"”',.:;]+?)["”']?(?=\s+(?:with|having|that|which|who)\b|[,.:;]|$)/i.exec(text) ??
    /\b(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+role\b/.exec(text);
  const name = m ? cleanRoleName(m[1]) : '';
  return name && !/^(?:a|an|the|new|this|that)$/i.test(name) ? name : undefined;
}

/** "Select all permissions for the Auditor role" → "Auditor": a capitalised name right before "role". */
function nameBeforeRole(text: string): string | undefined {
  const m = /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+role\b/.exec(text);
  const name = m ? cleanRoleName(m[1]) : '';
  return name && !onlyPermissionWords(name) ? name : undefined;
}

/**
 * A change to a named role's permissions, said outright ("Select all permissions for the Auditor
 * role", "Give the HR Manager role delete on tasks"): the role's name, to update it without the
 * model. In the eval the model answered the first with list_roles. Null for anything else.
 */
export function permissionStatement(text: string): string | null {
  if (isQuestion(text) || asksToCreate(text)) return null;
  const name = nameBeforeRole(text);
  return name && readClauses(permissionText(text, [name])).length ? name : null;
}

// Words for each change, as on Tasks and Documents: a field changes only when the message asks.
export const asksToRename = (text: string) => /\b(?:rename|renamed|call it|change (?:the |its )?name|new name)\b/.test(norm(text));
/** A request to make a new role: a creating verb first ("Create a role …"), not an action ("Create and update on tasks …"). */
export const asksToCreate = (text: string) =>
  /^(?:please )?(?:create|make|add|set up|setup|build)\b(?! (?:and|or|on|for|to|access|permissions?|rights|read|view|update|edit|delete|remove)\b)/.test(norm(text)) || /\bnew role\b/.test(norm(text));
export const asksToDelete = (text: string) => /\b(?:delete|remove|drop|get rid of|hatao|hata do|mita do)\b/.test(norm(text));

const FILLERS = new Set(['a', 'an', 'the', 'all', 'full', 'only', 'select', 'permission', 'permissions', 'access', 'rights', 'on', 'for', 'and', 'with', 'to', 'of', 'in']);

/** A "name" that is only permission words ("Read access"): the model took the permissions for the name. */
export function onlyPermissionWords(text: string): boolean {
  const words = norm(text).split(' ').filter(Boolean);
  return words.length > 0 && words.every((w) => ACTION_WORDS[w] || MODULE_WORDS[w] || FILLERS.has(w));
}

/** "None", "no permissions": a role with no permissions, said on purpose. */
export const saysNoPermissions = (text: string) => /^(?:none|nothing|no permissions?|no access|without (?:any )?permissions?|empty)$/.test(norm(text));

// A reply that is a new request ("show all roles", "cancel") rather than the missing detail.
const NEW_REQUEST = /^(?:cancel|stop|never ?mind|nope|no|show|list|find|delete|rename|update|edit|modify|count|how many|what|which|who|(?:create|make) (?:a|an|another|one more|new))\b/i;

/**
 * The fast path for a follow-up, with no model call: a plain reply is the name, the permissions
 * ("read on employees and projects"), or both ("Auditor with all permissions"). `earlier` is what
 * was said before a "which modules?" question: a reply naming only modules completes it.
 */
export function fillRoleFromReply(missing: string[], reply: string, earlier?: string): { name?: string; permissions?: string } | null {
  const text = reply.trim().replace(/[.!]+$/, '');
  if (!text) return null;
  const wantsPermissions = missing.includes('permissions');
  if (wantsPermissions && missing.length === 1 && saysNoPermissions(text)) return { permissions: 'none' };
  if (NEW_REQUEST.test(text)) return null;
  const clauses = readClauses(text);
  const asName = (t: string) => {
    const name = cleanRoleName(t.replace(/^(?:call it|name it|it'?s called|it is called|the name is|name:)\s+/i, ''));
    return name && !onlyPermissionWords(name) && name.split(/\s+/).length <= 6 ? { name } : null;
  };
  if (!wantsPermissions) return asName(text);
  if (missing.includes('name')) {
    const both = /^(.+?)\s+(?:with|having|that can|who can|giving)\s+(.+)$/i.exec(text);
    if (both && readClauses(both[2]).length) {
      const named = asName(both[1]);
      return named ? { ...named, permissions: both[2] } : null;
    }
    if (!clauses.length) return asName(text);
    return null;
  }
  if (!clauses.length) return null;
  const onlyModules = clauses.every((c) => !c.actions.size && !c.op);
  return { permissions: onlyModules && earlier ? `${earlier} ${text}` : text };
}
