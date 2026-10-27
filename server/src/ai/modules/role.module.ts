import { z } from 'zod';
import { MODULES, ModuleName } from '../../constants/modules';
import { objectIdSchema } from '../../validators/objectId';
import { ApiCallError } from '../apiClient';
import { basePrompt } from '../prompts/base.prompt';
import { andList, grounded, isBlank, Match, matchByName, mentions, str, stripCommandWords } from '../text';
import { AiButton, AiModule, AiTool, AiUserError, ApiClient, ConfirmCard, Prepared, RoleFormValues, ToolContext } from '../types';
import {
  Applied,
  applyClauses,
  asksToCreate,
  asksToDelete,
  asksToRename,
  cleanRoleName,
  entriesOf,
  fillRoleFromReply,
  flagsText,
  Matrix,
  matrixOf,
  matrixText,
  MODULE_LABELS,
  NONE,
  onlyPermissionWords,
  PermissionEntry,
  permissionStatement,
  permissionText,
  readClauses,
  roleNameFrom,
  sameFlags,
  saysNoPermissions,
} from './role.helpers';

// The Roles assistant (docs/AI_ROLES_ASSISTANT.md). Reads and writes go through the existing
// /roles endpoints (and /employees, for counts) with the admin's own token. The model picks the
// tool and copies the role's name; the server reads the permissions from the user's message.
// The whole module is ORG_ADMIN only, as the Roles page and its routes are.

interface RoleRow {
  id: string;
  name: string;
  permissions: PermissionEntry[];
}

const PAGE_SIZE = 20;
const isObjectId = (value: string) => objectIdSchema.safeParse(value).success;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);
const PERMISSIONS_HINT = "The permissions in the user's own words, copied as said";

/** Filter words, where "all" (as in "show all roles") means no filter. */
const filterWords = (value: unknown) => {
  const words = str(value);
  return words && !/^(?:all|any|every|everything)(?: roles?)?$/i.test(words) ? words : undefined;
};

const employees = (n: number) => `${n} employee${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- lookups and display

async function loadRoles(api: ApiClient): Promise<RoleRow[]> {
  return api.get<RoleRow[]>('/roles', { limit: 100, sortBy: 'name', sortDir: 'asc' });
}

/** The modules of the organization's plan, in the matrix's order: the only ones a role may grant. */
async function planModulesOf(api: ApiClient): Promise<ModuleName[]> {
  const me = await api.get<{ user: { subscription: { modules: ModuleName[] } | null } }>('/auth/me');
  const modules = me.user.subscription?.modules ?? [];
  return MODULES.filter((m) => modules.includes(m));
}

/** The role the user means, by id or by name among all roles: exact, initials or a unique prefix. */
async function findRole(api: ApiClient, said: string): Promise<{ match: Match<RoleRow>; all: RoleRow[] }> {
  const query = stripCommandWords(said);
  if (isObjectId(query)) {
    try {
      return { match: { kind: 'one', item: await api.get<RoleRow>(`/roles/${query}`) }, all: [] };
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 404) return { match: { kind: 'none' }, all: [] };
      throw err;
    }
  }
  const all = await loadRoles(api);
  return { match: matchByName(all, query, (r) => r.name, (r) => r.id), all };
}

/** The one role whose name the message holds, when the model gave none. */
async function mentionedRole(api: ApiClient, message: string): Promise<string | undefined> {
  const named = (await loadRoles(api)).filter((r) => mentions(message, r.name));
  return named.length === 1 ? named[0].name : undefined;
}

function noMatch(which: string, all: RoleRow[]): string {
  const names = all.map((r) => r.name);
  const options = names.length > 12 ? `${names.slice(0, 12).join(', ')} and ${names.length - 12} more` : andList(names);
  return `There is no role called "${which}".${names.length ? ` Roles: ${options}.` : ''}`;
}

/** How many employees have the role, or null when employees can't be read (not in the plan). */
async function employeeCount(api: ApiClient, roleId: string): Promise<number | null> {
  try {
    return (await api.page<unknown[]>('/employees', { roleId, limit: 1 })).meta.total ?? null;
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 403) return null;
    throw err;
  }
}

function roleLine(r: RoleRow, plan: readonly ModuleName[], count: number | null): string {
  const parts = [count === null ? null : employees(count), matrixText(matrixOf(r.permissions), plan)];
  return `**${r.name}** · ${parts.filter(Boolean).join(' · ')}`;
}

function whichOne(question: string, items: RoleRow[], plan: readonly ModuleName[], toolCall: (id: string) => AiButton['toolCall']): Extract<Prepared, { kind: 'ask' }> {
  return {
    kind: 'ask',
    // Names aren't unique, so each button also shows the start of the role's permissions.
    result: { text: question, buttons: items.slice(0, 6).map((r) => ({ label: `${r.name} · ${short(matrixText(matrixOf(r.permissions), plan), 40)}`, toolCall: toolCall(r.id) })) },
  };
}

const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A warning when another role already has this name (names aren't unique). */
async function sameName(api: ApiClient, name: string, exceptId?: string): Promise<string[]> {
  const n = name.trim().toLowerCase();
  const same = (await loadRoles(api)).find((r) => r.id !== exceptId && r.name.trim().toLowerCase() === n);
  return same ? [`A role called "${same.name}" already exists.`] : [];
}

/** One card row per module whose permissions differ, with the old ones as `previous` on an update. */
function permissionRows(matrix: Matrix, plan: readonly ModuleName[], before?: Matrix): ConfirmCard['rows'] {
  if (!before) return plan.filter((m) => matrix[m]?.read).map((m) => ({ label: MODULE_LABELS[m], value: flagsText(matrix[m]) }));
  return plan
    .filter((m) => !sameFlags(matrix[m] ?? NONE, before[m] ?? NONE))
    .map((m) => ({ label: MODULE_LABELS[m], value: flagsText(matrix[m]), previous: flagsText(before[m]) }));
}

// ---------------------------------------------------------------- reading the request

/**
 * The permission words to read for this turn. From a button or a reply the server read, the
 * words it saved. Otherwise the user's latest message, without the role's name; the model's
 * copy only when the message has none and the user said it before (a correction such as
 * "call it Auditor instead"); then what an earlier "which modules?" question was waiting on.
 */
function permissionWords(raw: unknown, ctx: ToolContext, names: (string | undefined)[], earlier?: string): string | undefined {
  if (ctx.fromButton) return str(raw) ?? earlier;
  const own = permissionText(ctx.latestText, names);
  if (saysNoPermissions(own)) return 'none';
  const clauses = readClauses(own);
  if (clauses.length) return earlier && clauses.every((c) => !c.actions.size && !c.op) ? `${earlier} ${own}` : own;
  const model = str(raw);
  if (model && grounded(model, ctx.userText) && readClauses(model).length) return model;
  return earlier;
}

/** The words applied to `base`; 'none' (said on purpose) is an empty matrix. */
function readPermissions(words: string | undefined, base: Matrix, plan: readonly ModuleName[]): Applied {
  if (words === 'none') return { matrix: {}, notes: [], said: true };
  return applyClauses(base, words ? readClauses(words) : [], plan);
}

/**
 * The new role's name: the one the message gives ("a role called HR Manager with …") wins over
 * the model's, which must come from the user and not be permission words ("Read access").
 */
function roleName(raw: unknown, ctx: ToolContext): string | undefined {
  const model = str(raw) ? cleanRoleName(String(raw)) : undefined;
  if (ctx.fromButton) return model || undefined;
  if (model && mentions(ctx.latestText, model) && !onlyPermissionWords(model)) return model;
  const own = roleNameFrom(ctx.latestText);
  if (own && !onlyPermissionWords(own)) return own;
  return model && grounded(model, ctx.userText) && !onlyPermissionWords(model) ? model : undefined;
}

/** The new name on an update: asked for in words ("rename … to …"), and said by the user. */
function newRoleName(raw: unknown, ctx: ToolContext, current: string): string | undefined {
  const model = str(raw) ? cleanRoleName(String(raw)) : undefined;
  if (ctx.fromButton) return model || undefined;
  if (!asksToRename(ctx.latestText)) return undefined;
  const said = /\b(?:to|as|into)\s+["“']?([^"”']+?)["”']?\s*[.!]?$/i.exec(ctx.latestText)?.[1];
  const own = said ? cleanRoleName(said) : undefined;
  const name = own && own.toLowerCase() !== current.toLowerCase() ? own : model && grounded(model, ctx.userText) ? model : undefined;
  return name && name.toLowerCase() !== current.toLowerCase() ? name : undefined;
}

// ---------------------------------------------------------------- the form

/** The form values the card edits, and what Confirm checks them against. */
const roleValuesSchema = z.object({
  name: z.string().trim().min(1, 'Role name is required'),
  permissions: z.array(
    z.object({ module: z.enum(MODULES), read: z.boolean(), create: z.boolean(), update: z.boolean(), delete: z.boolean() })
  ),
});

/** As the page sends it: Read is a gate, so rows without it are left out. */
function roleBody(v: z.infer<typeof roleValuesSchema>) {
  return { name: v.name.trim(), permissions: v.permissions.filter((p) => p.read) };
}

const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_role', args: {}, form: true } };

// ---------------------------------------------------------------- read tool

const listInput = z.object({
  search: text('Role name to look up'),
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

const listRoles: AiTool<z.infer<typeof listInput>> = {
  name: 'list_roles',
  label: 'Looking up roles',
  kind: 'read',
  adminOnly: true,
  description: "List roles with their permissions, or show one role's permissions. Use for 'show roles', 'how many roles' and 'what can <role> do'.",
  input: listInput,
  async run(args, api, ctx) {
    const page = args.page ?? 1;
    const plan = await planModulesOf(api);
    // "What can HR Manager do?" came back with no search: the one role the message names is meant.
    let search = filterWords(args.search);
    if (!search && !ctx.fromButton && !/\b(?:all|every|roles)\b/i.test(ctx.latestText)) search = await mentionedRole(api, ctx.latestText);
    // A role named outright ("What can HR Manager do?") gets its details line.
    if (search && page === 1) {
      const { match } = await findRole(api, search);
      if (match.kind === 'one') return { text: roleLine(match.item, plan, await employeeCount(api, match.item.id)) };
    }
    const { data, meta } = await api.page<RoleRow[]>('/roles', {
      search: search ? search.replace(/\broles?\b/gi, '').trim() || search : undefined,
      page,
      limit: PAGE_SIZE,
      sortBy: 'name',
      sortDir: 'asc',
    });
    const total = meta.total ?? data.length;
    const where = search ? ` matching "${search}"` : '';
    if (total === 0) return { text: search ? `No roles${where}.` : 'There are no roles yet.' };
    const counts = await Promise.all(data.map((r) => employeeCount(api, r.id)));
    if (total === 1 && page === 1) return { text: roleLine(data[0], plan, counts[0]) };
    const withCounts = counts.every((c) => c !== null);
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    return {
      text: `**${total} role${total === 1 ? '' : 's'}**${where}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: {
        columns: [
          { key: 'name', title: 'Role' },
          ...(withCounts ? [{ key: 'employees', title: 'Employees' }] : []),
          { key: 'permissions', title: 'Permissions' },
        ],
        rows: data.map((r, i) => ({
          name: r.name,
          ...(withCounts ? { employees: String(counts[i]) } : {}),
          permissions: matrixText(matrixOf(r.permissions), plan),
        })),
      },
      buttons: to < total ? [{ label: 'Show more', toolCall: { name: 'list_roles', args: { ...args, page: page + 1 } } }] : undefined,
    };
  },
};

// ---------------------------------------------------------------- create

const createInput = z.object({
  name: text("The new role's name, exactly as the user said it"),
  permissions: text(PERMISSIONS_HINT),
});

const ASK_LABELS: Record<string, string> = { name: 'the **name**', permissions: 'its **permissions** (which modules, and Read, Create, Update or Delete)' };

const createRole: AiTool<z.infer<typeof createInput>> = {
  name: 'create_role',
  label: 'Preparing the new role',
  kind: 'write',
  adminOnly: true,
  description: 'Create a new role with its permissions. The admin checks and confirms it before it is saved. Fill only what the user said.',
  input: createInput,

  async prepare(raw, api, ctx) {
    const draft = ctx.draft?.tool === 'create_role' ? ctx.draft : null;
    const name = roleName(raw.name, ctx) ?? str(draft?.args.name);
    // "Give delete on employees to HR Manager" came back as a create named after the role.
    if (!ctx.fromButton && !ctx.form && !draft && !ctx.rerouted && name && !asksToCreate(ctx.latestText)) {
      const { match } = await findRole(api, name);
      if (match.kind === 'one') return { kind: 'reroute', tool: 'update_role', args: { role: name } };
    }
    const words = permissionWords(raw.permissions, ctx, [name, str(raw.name)], str(draft?.args.permissions));
    const plan = await planModulesOf(api);
    const applied = readPermissions(words, {}, plan);
    const entries = entriesOf(applied.matrix, plan);
    const missing = [...(name ? [] : ['name']), ...(applied.said && !applied.question ? [] : ['permissions'])];
    const warnings = name ? await sameName(api, name) : [];

    if (missing.length && !ctx.form) {
      const asked = applied.question
        ? `${name ? `For **${name}**: ` : ''}${applied.question}${missing.includes('name') ? ' And what should the role be called?' : ''}`
        : `I'll create ${name ? `the role **${name}**` : 'a new role'}. I still need ${andList(missing.map((f) => ASK_LABELS[f]))}.`;
      return {
        kind: 'ask',
        result: { text: asked, buttons: [formButton], warnings: [...warnings, ...(applied.question ? applied.notes : [])] },
        draft: {
          tool: 'create_role',
          args: Object.fromEntries(Object.entries({ name, permissions: applied.said ? words : undefined }).filter(([, v]) => v)),
          missing,
          notSaved: [],
        },
      };
    }
    const values: RoleFormValues = { name: name ?? '', permissions: entries };
    const rows = permissionRows(applied.matrix, plan);
    const card: ConfirmCard = {
      title: 'New role',
      tone: 'default',
      rows: [{ label: 'Name', value: name || '—' }, ...(rows.length ? rows : [{ label: 'Permissions', value: 'None' }])],
      warnings,
      notes: applied.notes,
      confirmLabel: 'Create role',
      form: { kind: 'role', mode: 'create', values },
      incomplete: !name,
    };
    return { kind: 'card', card, calls: name ? [{ method: 'POST', path: '/roles', body: { name, permissions: entries } }] : [] };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'create_role') return null;
    return fillRoleFromReply(draft.missing, reply, str(draft.args.permissions));
  },

  async revise(_pending, values) {
    const parsed = roleValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/roles', body: roleBody(parsed.data) }];
  },

  done([result]) {
    const r = result as RoleRow;
    return { text: `✅ **Role created:** ${r.name} · ${matrixText(matrixOf(r.permissions), MODULES)}.` };
  },
};

// ---------------------------------------------------------------- update

const updateInput = z
  .object({
    role: text('Name of the role to change'),
    newName: text('New name, only when renaming'),
    permissions: text(PERMISSIONS_HINT),
  })
  // Kept: the model sometimes sends `name` for the role itself (see prepare).
  .passthrough();

const updateRole: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_role',
  label: 'Preparing the change',
  kind: 'write',
  adminOnly: true,
  description: "Change a role: rename it, or give or take away permissions. The admin confirms before saving.",
  input: updateInput,

  async prepare(input, api, ctx) {
    const args: Record<string, unknown> = { ...input };
    if (str(args.name)) {
      if (!str(args.role)) args.role = args.name;
      else if (!str(args.newName)) args.newName = args.name;
    }
    delete args.name;
    // "Remove create from documents for HR Manager" once came back as { newName: "HR Manager" }:
    // with no rename asked for, that is the role.
    if (!str(args.role) && str(args.newName) && !ctx.fromButton && !asksToRename(ctx.latestText)) {
      args.role = args.newName;
      delete args.newName;
    }
    const draft = ctx.draft?.tool === 'update_role' ? ctx.draft : null;
    const which = str(args.role) ?? str(draft?.args.role) ?? (ctx.fromButton ? undefined : roleNameFrom(ctx.latestText) ?? (await mentionedRole(api, ctx.latestText)));
    if (!which) return { kind: 'ask', result: { text: 'Which role do you want to change?' } };
    const { match, all } = await findRole(api, which);
    // "Create a role Auditor with …" once came back as an update of a role that doesn't exist yet.
    if (match.kind === 'none' && !ctx.fromButton && !ctx.rerouted && asksToCreate(ctx.latestText)) {
      return { kind: 'reroute', tool: 'create_role', args: { name: which, permissions: args.permissions } };
    }
    if (match.kind === 'none') return { kind: 'ask', result: { text: noMatch(which, all) } };
    const plan = await planModulesOf(api);
    const earlier = str(draft?.args.permissions);
    if (match.kind === 'many') {
      const words = permissionWords(args.permissions, ctx, [which, str(args.newName)], earlier);
      return whichOne(`${match.items.length} roles match "${which}". Which one?`, match.items, plan, (id) => ({
        name: 'update_role',
        args: Object.fromEntries(Object.entries({ role: id, newName: newRoleName(args.newName, ctx, ''), permissions: words }).filter(([, v]) => v)),
      }));
    }
    const current = match.item;
    const newName = newRoleName(args.newName, ctx, current.name);
    const words = permissionWords(args.permissions, ctx, [which, current.name, newName, str(args.newName)], earlier);
    const before = matrixOf(current.permissions);
    const applied = readPermissions(words, before, plan);
    const editButton: AiButton = { label: 'Edit in a form', toolCall: { name: 'update_role', args: { role: current.id }, form: true } };
    if (applied.question && !ctx.form) {
      return {
        kind: 'ask',
        result: { text: `For **${current.name}**: ${applied.question}`, buttons: [editButton], warnings: applied.notes },
        draft: { tool: 'update_role', args: { role: current.id, ...(newName ? { newName } : {}), permissions: words }, missing: ['permissions'], notSaved: [] },
      };
    }
    const rows = permissionRows(applied.matrix, plan, before);
    if (!rows.length && !newName && !ctx.form) {
      const textOut = applied.said
        ? `**${current.name}** already has that: ${matrixText(before, plan)}.`
        : `What should change for **${current.name}**? Tell me the permissions to give or take away, or a new name. Now: ${matrixText(before, plan)}.`;
      return { kind: 'ask', result: { text: textOut, buttons: [editButton] } };
    }
    const warnings = newName ? await sameName(api, newName, current.id) : [];
    const body: Record<string, unknown> = {};
    if (newName) body.name = newName;
    if (rows.length) body.permissions = entriesOf(applied.matrix, plan);
    const changed = Object.keys(body).length > 0;
    return {
      kind: 'card',
      card: {
        title: `Update ${current.name}`,
        tone: 'default',
        rows: [...(newName ? [{ label: 'Name', value: newName, previous: current.name }] : []), ...rows, ...(changed ? [] : [{ label: 'Role', value: current.name }])],
        warnings,
        notes: applied.notes,
        confirmLabel: 'Save',
        form: { kind: 'role', mode: 'update', values: { name: newName ?? current.name, permissions: entriesOf(applied.matrix, plan) } },
        incomplete: !changed,
      },
      calls: changed ? [{ method: 'PUT', path: `/roles/${current.id}`, body }] : [],
      meta: { roleId: current.id },
    };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'update_role') return null;
    const filled = fillRoleFromReply(['permissions'], reply, str(draft.args.permissions));
    return filled ? { ...draft.args, ...filled } : null;
  },

  async revise(pending, values, api) {
    const parsed = roleValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const id = String(pending.meta.roleId);
    const [current, plan] = await Promise.all([api.get<RoleRow>(`/roles/${id}`), planModulesOf(api)]);
    const next = roleBody(parsed.data);
    const body: Record<string, unknown> = {};
    if (next.name !== current.name) body.name = next.name;
    const before = matrixOf(current.permissions);
    const after = matrixOf(next.permissions);
    if (plan.some((m) => !sameFlags(before[m] ?? NONE, after[m] ?? NONE))) body.permissions = next.permissions;
    if (!Object.keys(body).length) throw new AiUserError('Nothing was changed.');
    return [{ method: 'PUT', path: `/roles/${id}`, body }];
  },

  done([result], pending) {
    const r = result as RoleRow;
    const body = (pending.calls[0]?.body ?? {}) as Record<string, unknown>;
    const parts = [body.name ? `the name is now ${r.name}` : null, body.permissions ? `permissions are now ${matrixText(matrixOf(r.permissions), MODULES)}` : null];
    return { text: `✅ Updated **${r.name}**: ${andList(parts.filter((p): p is string => Boolean(p)))}.` };
  },
};

// ---------------------------------------------------------------- delete

const deleteInput = z.object({ role: text('Name of the role to delete') }).passthrough();

const deleteRole: AiTool<z.infer<typeof deleteInput>> = {
  name: 'delete_role',
  label: 'Finding the role',
  kind: 'write',
  adminOnly: true,
  description: 'Delete a role for good. The admin must confirm.',
  input: deleteInput,

  async prepare(args, api, ctx) {
    const which = str(args.role) ?? str((args as Record<string, unknown>).name) ?? (ctx.fromButton ? undefined : roleNameFrom(ctx.latestText));
    // "Remove delete on tasks from HR Manager" and "Take away projects from HR Manager" came
    // back as deletes: a message with no word for deleting, or with permissions in it, is an update.
    if (!ctx.fromButton && !ctx.rerouted && (!asksToDelete(ctx.latestText) || readClauses(permissionText(ctx.latestText, [which])).length)) {
      return { kind: 'reroute', tool: 'update_role', args: which ? { role: which } : {} };
    }
    if (!which) return { kind: 'ask', result: { text: 'Which role do you want to delete?' } };
    const { match, all } = await findRole(api, which);
    if (match.kind === 'none') return { kind: 'ask', result: { text: noMatch(which, all) } };
    const plan = await planModulesOf(api);
    // One at a time: chat never deletes several roles in one go.
    if (match.kind === 'many') {
      return whichOne(`${match.items.length} roles match "${which}". Which one do you want to delete?`, match.items, plan, (id) => ({ name: 'delete_role', args: { role: id } }));
    }
    const r = match.item;
    // The API refuses while employees have it, so say so now instead of showing a card that would fail.
    const count = await employeeCount(api, r.id);
    if (count) {
      return {
        kind: 'ask',
        result: { text: `**${r.name}** is given to ${employees(count)}, so it can't be deleted. Give them another role first, on the Employees page.` },
      };
    }
    return {
      kind: 'card',
      card: {
        title: `Delete ${r.name}?`,
        tone: 'danger',
        rows: [{ label: 'Permissions', value: matrixText(matrixOf(r.permissions), plan) }],
        notes: ['This is the same as Delete on the Roles page.'],
        confirmLabel: 'Delete role',
      },
      calls: [{ method: 'DELETE', path: `/roles/${r.id}` }],
      meta: { roleId: r.id, name: r.name },
    };
  },

  done(_results, pending) {
    return { text: `✅ **${String(pending.meta.name)}** was deleted.` };
  },
};

// ---------------------------------------------------------------- module

export const roleModule: AiModule = {
  key: 'roles',
  title: 'Roles assistant',
  intro: () => 'List roles, or create, change and delete them with their permissions, by typing or speaking. Every change waits for your Confirm.',
  adminOnly: true,
  starters: [
    { label: 'New role', toolCall: { name: 'create_role', args: {}, form: true } },
    { label: 'Show all roles', toolCall: { name: 'list_roles', args: {} } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'roles')}
You are the Roles assistant. You help list roles, and create, change or delete them with their permissions.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Copy the role's name exactly as the user said it. The server reads the permissions from the user's message.
- To change a role's permissions or name, call update_role.
- Never say that a role was created, changed or deleted. The app shows that after the backend confirms it.`,
  tools: [listRoles, createRole, updateRole, deleteRole],
  direct: (message) => {
    const role = permissionStatement(message);
    return role ? { name: 'update_role', args: { role } } : null;
  },
};
