import { z } from 'zod';
import { basePrompt } from '../prompts/base.prompt';
import { grounded, isBlank, str } from '../text';
import { AiButton, AiModule, AiTool, ToolContext } from '../types';
import { isQuestion } from './exports.helpers';
import { ACTION_LABELS, actionsIn, AuditAction, AuditModule, auditRange, MODULE_LABELS, modulesIn, whenText } from './auditLog.helpers';

// The Audit Logs assistant (docs/AI_AUDIT_LOGS_ASSISTANT.md). Read-only, as the page is: it loads
// GET /audit-logs by module, action and dates read from the user's words, and moves the page's
// filters to the same values (AiResult.view).

interface AuditRow {
  id: string;
  actorName: string;
  actorRole: 'SUPER_ADMIN' | 'ORG_ADMIN' | 'ORG_USER';
  action: AuditAction;
  module: AuditModule | null;
  recordLabel: string | null;
  createdAt: string;
}

const PAGE = '/audit-logs';
const PAGE_SIZE = 20;
const ROLE_LABELS: Record<AuditRow['actorRole'], string> = { SUPER_ADMIN: 'Super Admin', ORG_ADMIN: 'Org Admin', ORG_USER: 'User' };

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

const listInput = z.object({
  module: text("The module in the user's words, only if they named one"),
  action: text("The action in the user's words (created, updated, deleted, signed in, signed out), only if they named one"),
  dates: text("The dates in the user's words, only if they gave any"),
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

interface Filters {
  module?: AuditModule;
  action?: AuditAction;
  range?: NonNullable<ReturnType<typeof auditRange>>;
  notes: string[];
}

/**
 * The filters from the user's words (section 3). The model's copy of a filter counts only when
 * the message has none of that kind and the copy is in the message. A button passes its own.
 */
function readFilters(args: z.infer<typeof listInput>, ctx: ToolContext): Filters {
  const notes: string[] = [];
  if (ctx.fromButton) {
    const module = Object.keys(MODULE_LABELS).find((m) => m === str(args.module)) as AuditModule | undefined;
    const action = (Object.keys(ACTION_LABELS) as AuditAction[]).find((a) => a === str(args.action));
    const range = str(args.dates) ? (auditRange(String(args.dates), ctx.today) ?? undefined) : undefined;
    return { module, action, range, notes };
  }
  const message = ctx.latestText;
  const fromModel = (value: unknown, read: (t: string) => string[]) => (str(value) && grounded(String(value), message) ? read(String(value)) : []);
  const modules = modulesIn(message).length ? modulesIn(message) : (fromModel(args.module, modulesIn) as AuditModule[]);
  const actions = actionsIn(message).length ? actionsIn(message) : (fromModel(args.action, actionsIn) as AuditAction[]);
  const range = auditRange(message, ctx.today) ?? (str(args.dates) && grounded(String(args.dates), message) ? auditRange(String(args.dates), ctx.today) : null) ?? undefined;
  let module: AuditModule | undefined = modules[0];
  const action: AuditAction | undefined = actions[0];
  if (modules.length > 1) notes.push(`One module at a time: showing ${MODULE_LABELS[modules[0]]}.`);
  if (actions.length > 1) notes.push(`One action at a time: showing ${ACTION_LABELS[actions[0]]}.`);
  // Sign-ins are recorded without a module.
  if (module && (action === 'login' || action === 'logout')) {
    notes.push(`Sign-ins and sign-outs aren't recorded per module, so this shows all of them, not only ${MODULE_LABELS[module]}.`);
    module = undefined;
  }
  return { module, action, range, notes };
}

/** A range as button args, read back by the date reader. */
const datesArg = (r: Filters['range']) => (r?.from && r.to ? `from ${r.from} to ${r.to}` : r?.from ? `since ${r.from}` : r?.to ? `until ${r.to}` : undefined);

function viewOf(f: Filters): string {
  const q = new URLSearchParams();
  if (f.module) q.set('module', f.module);
  if (f.action) q.set('action', f.action);
  if (f.range?.from) q.set('from', f.range.from);
  if (f.range?.to) q.set('to', f.range.to);
  const s = q.toString();
  return s ? `${PAGE}?${s}` : PAGE;
}

const listAuditLogs: AiTool<z.infer<typeof listInput>> = {
  name: 'list_audit_logs',
  label: 'Looking up the audit log',
  kind: 'read',
  description: "List the organization's audit log entries, filtered by module, action (created, updated, deleted, signed in, signed out) and dates. Also moves the page's filters to the same values.",
  input: listInput,
  async run(args, api, ctx) {
    const f = readFilters(args, ctx);
    const page = args.page ?? 1;
    const { data, meta } = await api.page<AuditRow[]>('/audit-logs', {
      module: f.module,
      action: f.action,
      from: f.range?.fromInstant,
      to: f.range?.toInstant,
      page,
      limit: PAGE_SIZE,
    });
    const total = meta.total ?? data.length;
    const parts = [f.module ? MODULE_LABELS[f.module] : null, f.action ? ACTION_LABELS[f.action] : null, f.range?.label].filter(Boolean).join(' · ');
    const view = viewOf(f);
    const warnings = f.notes.length ? f.notes : undefined;
    if (!total) return { text: `No audit entries${parts ? ` · ${parts}` : ''}.`, warnings, view };
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    const next: AiButton[] =
      to < total
        ? [{ label: 'Show more', toolCall: { name: 'list_audit_logs', args: Object.fromEntries(Object.entries({ module: f.module, action: f.action, dates: datesArg(f.range), page: page + 1 }).filter(([, v]) => v !== undefined)) } }]
        : [];
    return {
      text: `**${total} entr${total === 1 ? 'y' : 'ies'}**${parts ? ` · ${parts}` : ''}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: {
        columns: [
          { key: 'when', title: 'When' },
          { key: 'user', title: 'User' },
          { key: 'action', title: 'Action' },
          { key: 'module', title: 'Module' },
          { key: 'record', title: 'Record' },
        ],
        rows: data.map((r) => ({
          when: whenText(r.createdAt),
          user: `${r.actorName} (${ROLE_LABELS[r.actorRole]})`,
          action: ACTION_LABELS[r.action],
          module: r.module ? (MODULE_LABELS[r.module] ?? r.module) : 'Sign-in',
          record: r.recordLabel ?? '—',
        })),
      },
      buttons: next.length ? next : undefined,
      warnings,
      view,
    };
  },
};

/**
 * A request the server reads by itself (section 8): it names a module, an action or dates, or asks
 * for the audit log. Questions about what the log is go to the model.
 */
function listStatement(message: string, today: string): boolean {
  if (modulesIn(message).length || actionsIn(message).length || auditRange(message, today)) return true;
  return /\b(?:audit|logs?|activity|history|entries)\b/i.test(message) && !(isQuestion(message) && /\b(?:what is|what are|what's an?|explain|how does|why)\b/i.test(message));
}

export const auditLogModule: AiModule = {
  key: 'auditLogs',
  title: 'Audit Logs assistant',
  intro: () => 'Load the audit log by module, action and dates, by typing or speaking. The page shows the same entries.',
  requiredPermission: { module: 'auditLogs', action: 'read' },
  starters: [
    { label: 'All audit logs', toolCall: { name: 'list_audit_logs', args: {} } },
    { label: "Today's sign-ins", toolCall: { name: 'list_audit_logs', args: { action: 'login', dates: 'today' } } },
    { label: 'Deleted this week', toolCall: { name: 'list_audit_logs', args: { action: 'delete', dates: 'this week' } } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'audit logs')}
You are the Audit Logs assistant. You help find entries in the organization's audit log by module, action and dates. The log is read-only.
- Call list_audit_logs for every request, also when the user writes in Hindi or Hinglish.
- Copy the module, the action and the dates exactly as the user said them. The server works them out.
- Leave out anything the user didn't say.`,
  tools: [listAuditLogs],
  direct: (message, ctx) => (listStatement(message, ctx.today) ? { name: 'list_audit_logs', args: {} } : null),
};
