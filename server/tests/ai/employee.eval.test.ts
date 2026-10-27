import { ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { D_HR, FakeApi, row, stubPersistence, turn } from './support';

// The model eval set (docs/AI_EMPLOYEE_ASSISTANT.md, section 12) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=qwen2.5:3b npx jest tests/ai/employee.eval
// The API is the in-memory fake, so no real data is touched.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

type Check = (call: ModelToolCall | undefined) => boolean;
const has = (call: ModelToolCall | undefined, key: string, pattern: RegExp) => pattern.test(String(call?.args[key] ?? ''));
const blank = (call: ModelToolCall | undefined, key: string) => !String(call?.args[key] ?? '').trim();

// `check` looks at the model's own call; `outcome` at what the user sees, for cases where the
// server makes up for the model (an alias, or a role misread as a manager).
type Outcome = (last: ChatMessageView) => boolean;
const CASES: { message: string; tool: string; check?: Check; outcome?: Outcome }[] = [
  { message: 'Show all employees', tool: 'list_employees', check: (c) => blank(c, 'search') },
  { message: 'Find Mike', tool: 'list_employees', check: (c) => has(c, 'search', /mike/i) },
  { message: 'Who works in HR?', tool: 'list_employees', check: (c) => has(c, 'department', /hr/i) },
  { message: 'How many employees work in Engineering?', tool: 'count_employees', check: (c) => has(c, 'department', /engineering/i) },
  { message: "Change Mike's department to HR", tool: 'update_employee', check: (c) => has(c, 'employee', /mike/i) && has(c, 'department', /hr/i) },
  { message: "Update Mike's email to mike@newcompany.com", tool: 'update_employee', check: (c) => has(c, 'email', /mike@newcompany\.com/i) },
  { message: "Disable Mike Ross's account", tool: 'update_employee', check: (c) => has(c, 'employee', /ross/i) && has(c, 'status', /disabled/) },
  {
    message: 'Make Mike Johnson a Manager',
    tool: 'update_employee',
    outcome: (last) => Boolean(last.action?.card.rows.some((r) => (r.label === 'Role' || r.label === 'Job title') && /manager/i.test(r.value))),
  },
  { message: 'Delete Mike', tool: 'delete_employee', check: (c) => has(c, 'employee', /mike/i) },
  { message: 'remove sara at company dot com', tool: 'delete_employee', check: (c) => has(c, 'employee', /sara/i) },
  { message: 'Create an employee from Mike', tool: 'create_employee', outcome: (last) => /I'll copy Mike|Which one should I copy/.test(last.result?.text ?? '') },
  { message: 'Create an employee named Mike Johnson in Engineering.', tool: 'create_employee', check: (c) => has(c, 'name', /mike johnson/i) && has(c, 'department', /engineering/i) },
  { message: 'Add Priya Shah as a QA Engineer in Engineering, priya@company.com', tool: 'create_employee', check: (c) => has(c, 'jobTitle', /qa engineer/i) && has(c, 'email', /priya@company\.com/i) },
  { message: 'Create an employee named Mike Johnson, email mike@company.com, department Engineering, and salary 75,000.', tool: 'create_employee', check: (c) => has(c, 'email', /mike@company\.com/i) },
  { message: 'Rahul ko HR mein daal do', tool: 'update_employee', check: (c) => has(c, 'employee', /rahul/i) && has(c, 'department', /hr/i) },
];

/** The real model, recording the tool calls it makes. */
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

run(`employee eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('picks the right tool and fields for the documented phrases', async () => {
    const report: { message: string; ok: boolean; got: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = new FakeApi([
        row('Mike Johnson', 'mike@company.com'),
        row('Mike Ross', 'mike.ross@company.com'),
        row('Rahul Verma', 'rahul@company.com'),
        row('Sara Khan', 'sara@company.com', D_HR),
      ]);
      const model = recording();
      const started = Date.now();
      const { last } = await turn({ api, message: c.message, model });
      // A tool call the model wrote as text counts too: the agent recovers it (toolCallFromText).
      const written = model.texts.map(toolCallFromText).find((c): c is ModelToolCall => Boolean(c) && c !== 'malformed');
      const call = model.calls[model.calls.length - 1] ?? written;
      const ok = call?.name === c.tool && (c.outcome ? c.outcome(last) : c.check ? c.check(call) : true);
      report.push({ message: c.message, ok, got: call ? `${call.name} ${JSON.stringify(call.args)}` : `no tool call: "${model.texts.join(' ').slice(0, 120)}"`, seconds: ((Date.now() - started) / 1000).toFixed(1) });
      // Whatever the model did, nothing may be written without a Confirm.
      expect(api.writes()).toEqual([]);
    }
    console.table(report);
    const passed = report.filter((r) => r.ok).length;
    console.log(`${passed}/${report.length} correct on ${env.OLLAMA_MODEL}`);
    expect(passed / report.length).toBeGreaterThanOrEqual(0.8);
  });
});
