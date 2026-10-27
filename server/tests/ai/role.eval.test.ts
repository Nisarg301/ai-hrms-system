import { AiEvent, ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { roleModule } from '../../src/ai/modules/role.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { FakeRoleApi, role, stubPersistence, turn } from './support';

// The Roles eval set (docs/AI_ROLES_ASSISTANT.md, section 11) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/role.eval
// The API is the in-memory fake, so no real data is touched.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

type Outcome = (last: ChatMessageView) => boolean;
const says = (last: ChatMessageView, pattern: RegExp) => pattern.test(last.result?.text ?? '');
/** The card shows exactly these rows, label → value: a changed module the user didn't name fails. */
const rows = (last: ChatMessageView, expected: Record<string, string>) =>
  JSON.stringify(Object.fromEntries((last.action?.card.rows ?? []).map((r) => [r.label, r.value]))) === JSON.stringify(expected);
const every = (last: ChatMessageView, value: string, count: number) => {
  const modules = (last.action?.card.rows ?? []).filter((r) => r.label !== 'Name');
  return modules.length === count && modules.every((r) => r.value === value);
};

// `tool` is the model's own call; `outcome` is what the user sees (after any reroute).
const CASES: { message: string; tool: string; outcome: Outcome }[] = [
  { message: 'Show all roles', tool: 'list_roles', outcome: (last) => says(last, /3 roles/) },
  { message: 'What can HR Manager do?', tool: 'list_roles', outcome: (last) => says(last, /HR Manager.*Documents: all/) },
  { message: 'How many roles do we have?', tool: 'list_roles', outcome: (last) => says(last, /3 roles/) },
  {
    message: 'Create a role Team Lead with read, create and update on tasks, select all on projects and read on employees',
    tool: 'create_role',
    outcome: (last) => rows(last, { Name: 'Team Lead', Employees: 'Read', Projects: 'all', Tasks: 'Read, Create, Update' }),
  },
  { message: 'Create a role Admin Assistant with all permissions', tool: 'create_role', outcome: (last) => rows(last, { Name: 'Admin Assistant', ...allRows('all') }) },
  { message: 'Create a role Viewer with read access to everything', tool: 'create_role', outcome: (last) => rows(last, { Name: 'Viewer', ...allRows('Read') }) },
  { message: 'Create a new role called Intern', tool: 'create_role', outcome: (last) => says(last, /Intern.*permissions/) },
  { message: 'Create a role Recruiter that can view and add employees', tool: 'create_role', outcome: (last) => rows(last, { Name: 'Recruiter', Employees: 'Read, Create' }) },
  { message: 'Update the HR Manager role with read and update on tasks', tool: 'update_role', outcome: (last) => rows(last, { Tasks: 'Read, Update' }) },
  // The server sends a misrouted create or delete to update_role (Prepared 'reroute').
  { message: 'Give delete on employees to HR Manager', tool: 'update_role|create_role|delete_role', outcome: (last) => rows(last, { Employees: 'all' }) },
  { message: 'Remove create from documents for HR Manager', tool: 'update_role|delete_role', outcome: (last) => rows(last, { Documents: 'Read, Update, Delete' }) },
  { message: 'Take away projects from HR Manager', tool: 'update_role|delete_role', outcome: (last) => rows(last, { Projects: '—' }) },
  { message: 'Select all permissions for the Auditor role', tool: 'update_role', outcome: (last) => every(last, 'all', 8) },
  { message: 'Rename Auditor to Compliance Officer', tool: 'update_role', outcome: (last) => rows(last, { Name: 'Compliance Officer' }) },
  { message: 'Delete the Auditor role', tool: 'delete_role', outcome: (last) => last.action?.card.tone === 'danger' && last.action.card.title === 'Delete Auditor?' },
  { message: 'Delete the Employee role', tool: 'delete_role', outcome: (last) => says(last, /given to 12 employees/) },
  { message: 'HR Manager role ko tasks ka read access do', tool: 'update_role', outcome: (last) => rows(last, { Tasks: 'Read' }) },
];

function allRows(value: string): Record<string, string> {
  const labels = ['Dashboard', 'Employees', 'Documents', 'Projects', 'Tasks', 'Departments', 'Exports', 'Audit Logs'];
  return Object.fromEntries(labels.map((l) => [l, value]));
}

function recording(): ModelClient & { calls: ModelToolCall[]; texts: string[] } {
  const calls: ModelToolCall[] = [];
  const texts: string[] = [];
  return {
    calls,
    texts,
    async chat(request) {
      const reply = await ollamaClient.chat(request);
      calls.push(...reply.toolCalls);
      if (reply.content.trim()) texts.push(reply.content.trim());
      return reply;
    },
  };
}

function fakeApi(): FakeRoleApi {
  const employee = role('Employee', { dashboard: 'R', tasks: 'RU' });
  const hr = role('HR Manager', { employees: 'RCU', documents: 'RCUD', projects: 'R' });
  const api = new FakeRoleApi([employee, hr, role('Auditor', { auditLogs: 'R' })]);
  api.holders.set(employee.id, 12);
  api.holders.set(hr.id, 2);
  return api;
}

run(`role eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('picks the right tool, and the card holds exactly what was asked, for the documented phrases', async () => {
    const report: { message: string; ok: boolean; got: string; card: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = fakeApi();
      const model = recording();
      const started = Date.now();
      const { last, events } = await turn({ module: roleModule, api, message: c.message, model });
      // A tool call the model wrote as text counts too: the agent recovers it (toolCallFromText).
      const written = model.texts.map(toolCallFromText).find((c): c is ModelToolCall => Boolean(c) && c !== 'malformed');
      const call = model.calls[model.calls.length - 1] ?? written;
      // A message the module read itself (roleModule.direct) runs its tool with no model call at all.
      const direct = !model.calls.length && !model.texts.length ? (events.find((e) => e.type === 'tool') as Extract<AiEvent, { type: 'tool' }> | undefined) : undefined;
      const name = call?.name ?? direct?.name;
      const ok = Boolean(name && c.tool.split('|').includes(name)) && c.outcome(last);
      report.push({
        message: c.message,
        ok,
        got: call ? `${call.name} ${JSON.stringify(call.args)}` : direct ? `${direct.name} (server, no model)` : `no tool call: "${model.texts.join(' ').slice(0, 120)}"`,
        card: last.action ? last.action.card.rows.map((r) => `${r.label}: ${r.value}`).join(' | ') : (last.result?.text ?? '').slice(0, 100),
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
      // Whatever the model did, nothing may be written without a Confirm.
      expect(api.writes()).toEqual([]);
    }
    console.table(report);
    const passed = report.filter((r) => r.ok).length;
    console.log(`${passed}/${report.length} correct on ${env.OLLAMA_MODEL}`);
    expect(passed / report.length).toBeGreaterThanOrEqual(0.8);
  });
});
