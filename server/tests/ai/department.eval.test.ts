import { ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { departmentModule } from '../../src/ai/modules/department.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { department, FakeDepartmentApi, stubPersistence, turn } from './support';

// The Departments eval set (docs/AI_DEPARTMENTS_ASSISTANT.md, section 11) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/department.eval
// The API is the in-memory fake, so no real data is touched.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

type Check = (call: ModelToolCall | undefined) => boolean;
type Outcome = (last: ChatMessageView) => boolean;
const has = (call: ModelToolCall | undefined, key: string, pattern: RegExp) => pattern.test(String(call?.args[key] ?? ''));
const row = (last: ChatMessageView, label: string, pattern: RegExp) => Boolean(last.action?.card.rows.some((r) => r.label === label && pattern.test(r.value)));
const says = (last: ChatMessageView, pattern: RegExp) => pattern.test(last.result?.text ?? '');

// `check` looks at the model's own call; `outcome` at what the user sees.
const CASES: { message: string; tool: string; check?: Check; outcome?: Outcome }[] = [
  { message: 'Show all departments', tool: 'list_departments', outcome: (last) => says(last, /4 departments/) },
  { message: 'Find Engineering', tool: 'list_departments', check: (c) => has(c, 'search', /engineering/i) },
  { message: 'Which departments are inactive?', tool: 'list_departments', outcome: (last) => says(last, /Archive/) },
  // A list or a count both answer these.
  { message: 'How many people work in Engineering?', tool: 'list_departments|count_departments', outcome: (last) => says(last, /12 employees/) },
  { message: 'How many departments do we have?', tool: 'count_departments|list_departments', outcome: (last) => says(last, /4 departments/) },
  { message: 'How many inactive departments are there?', tool: 'count_departments|list_departments', outcome: (last) => says(last, /1 inactive department|Archive/) },
  { message: 'Headcount by department', tool: 'list_departments|count_departments', outcome: (last) => Boolean(last.result?.table?.columns.some((c) => c.title === 'Employees')) },
  {
    message: 'Create a department called Design for product and brand design',
    tool: 'create_department',
    outcome: (last) => row(last, 'Title', /^design$/i) && row(last, 'Description', /brand/i),
  },
  { message: 'Add a new department named Legal', tool: 'create_department', outcome: (last) => says(last, /Legal.*description/) },
  { message: 'Rename HR to People Operations', tool: 'update_department', outcome: (last) => row(last, 'Title', /people operations/i) },
  { message: 'Deactivate Sales', tool: 'update_department', outcome: (last) => row(last, 'Status', /inactive/i) },
  { message: 'Reactivate the Archive department', tool: 'update_department', outcome: (last) => row(last, 'Status', /^active$/i) },
  { message: 'Change the description of Sales to Field and inside sales', tool: 'update_department', outcome: (last) => row(last, 'Description', /field and inside sales/i) },
  { message: 'Delete the Archive department', tool: 'delete_department', outcome: (last) => last.action?.card.tone === 'danger' },
  { message: 'Delete Engineering', tool: 'delete_department', outcome: (last) => says(last, /still has 12 employees/) },
  { message: 'Sales ko deactivate kar do', tool: 'update_department', outcome: (last) => row(last, 'Status', /inactive/i) },
];

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

function fakeApi(): FakeDepartmentApi {
  const eng = department('Engineering', 'active', 'Builds the product');
  const hr = department('Human Resources', 'active', 'Hiring and payroll');
  const sales = department('Sales', 'active', 'Sells the product');
  const api = new FakeDepartmentApi([eng, hr, sales, department('Archive', 'inactive', 'Old records')]);
  api.employeesByDepartment.set(eng.id, 12);
  api.employeesByDepartment.set(hr.id, 3);
  api.employeesByDepartment.set(sales.id, 4);
  return api;
}

run(`department eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('picks the right tool and fields for the documented phrases', async () => {
    const report: { message: string; ok: boolean; got: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = fakeApi();
      const model = recording();
      const started = Date.now();
      const { last } = await turn({ module: departmentModule, api, message: c.message, model });
      // A tool call the model wrote as text counts too: the agent recovers it (toolCallFromText).
      const written = model.texts.map(toolCallFromText).find((c): c is ModelToolCall => Boolean(c) && c !== 'malformed');
      const call = model.calls[model.calls.length - 1] ?? written;
      const ok = Boolean(call && c.tool.split('|').includes(call.name)) && (c.outcome ? c.outcome(last) : c.check ? c.check(call) : true);
      report.push({
        message: c.message,
        ok,
        got: call ? `${call.name} ${JSON.stringify(call.args)}` : `no tool call: "${model.texts.join(' ').slice(0, 120)}"`,
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
