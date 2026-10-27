import { AiEvent, ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { expenseModule } from '../../src/ai/modules/expense.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { category, E_PRIYA, E_RAHUL, E_RAHUL_V, FakeExpenseApi, stubPersistence, turn } from './support';

// The Expenses eval set (docs/AI_EXPENSES_ASSISTANT.md, section 13) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/expense.eval
// The API is the in-memory fake, so no real data is touched.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

type Outcome = (last: ChatMessageView, api: FakeExpenseApi) => boolean;
const says = (last: ChatMessageView, pattern: RegExp) => pattern.test(last.result?.text ?? '');
/** The card shows exactly these rows, label → value: a field the user didn't name fails. */
const rows = (last: ChatMessageView, expected: Record<string, string>) =>
  JSON.stringify(Object.fromEntries((last.action?.card.rows ?? []).map((r) => [r.label, r.value]))) === JSON.stringify(expected);
/** The claims list asked the API for exactly these filters. */
const asked = (api: FakeExpenseApi, expected: Record<string, unknown>) => {
  const q = api.lastQuery('/expenses') ?? {};
  return ['status', 'employeeId', 'categoryId', 'from', 'to'].every((k) => (q[k] ?? undefined) === expected[k]);
};

const TRAVEL = category('Travel', 500000);
const FOOD = category('Food & meals', 200000);
const SNACKS = category('Snacks', 30000);

// `tool` is the model's own call, or the server's when it reads the message itself; `outcome` is what the user sees.
const CASES: { message: string; tool: string; outcome: Outcome }[] = [
  { message: 'Load the claims', tool: 'list_claims', outcome: (last, api) => says(last, /3 claims/) && asked(api, {}) },
  { message: 'Show pending claims', tool: 'list_claims', outcome: (_l, api) => asked(api, { status: 'submitted' }) },
  { message: 'Show approved claims of Priya Shah', tool: 'list_claims', outcome: (_l, api) => asked(api, { status: 'approved', employeeId: E_PRIYA }) },
  { message: 'List rejected claims in Travel', tool: 'list_claims', outcome: (_l, api) => asked(api, { status: 'rejected', categoryId: TRAVEL.id }) },
  {
    message: 'Show paid claims from 1 September 2026 to 30 September 2026',
    // The server answers a summary call about claims with the list (section 9).
    tool: 'list_claims|expense_summary',
    outcome: (_l, api) => asked(api, { status: 'paid', from: '2026-09-01', to: '2026-09-30' }),
  },
  { message: 'Show claims from Rahul', tool: 'list_claims', outcome: (last) => says(last, /2 people match "Rahul"/) },
  { message: 'Export the CSV', tool: 'export_claims', outcome: (last) => Boolean(last.result?.autoDownload && last.result.downloads?.length) },
  {
    message: 'Download the expenses CSV for September 2026',
    tool: 'export_claims',
    outcome: (last) => last.result?.downloads?.[0]?.path === '/exports/expenses?from=2026-09-01&to=2026-09-30' && Boolean(last.result.autoDownload),
  },
  { message: "Show this month's spending summary", tool: 'expense_summary', outcome: (last) => says(last, /approved/) && Boolean(last.result?.view?.includes('tab=summary')) },
  {
    message: 'Summary from 1 September 2026 to 15 October 2026',
    tool: 'expense_summary',
    outcome: (last) => last.result?.view === '/expenses?tab=summary&from=2026-09-01&to=2026-10-15',
  },
  { message: 'Spending by department last month', tool: 'expense_summary', outcome: (last) => last.result?.table?.columns[0].title === 'Department' },
  { message: 'Show the expense categories', tool: 'list_categories', outcome: (last) => says(last, /4 categories/) },
  {
    message: 'Add a new category Client meals with a limit of ₹2,000 per expense and receipt needed above ₹500',
    tool: 'create_category',
    outcome: (last) => rows(last, { Name: 'Client meals', 'Limit per expense': '₹2,000.00', 'Receipt needed': 'Above ₹500.00', Active: 'Yes' }),
  },
  {
    message: 'Create a category called Internet',
    tool: 'create_category',
    outcome: (last) => rows(last, { Name: 'Internet', 'Limit per expense': 'No limit', 'Receipt needed': 'Above ₹500.00', Active: 'Yes' }),
  },
  { message: 'Set the Travel limit to 10k', tool: 'update_category|create_category', outcome: (last) => rows(last, { 'Limit per expense': '₹10,000.00' }) },
  { message: 'Deactivate the Snacks category', tool: 'update_category', outcome: (last) => rows(last, { Active: 'No' }) },
  { message: 'Remove the limit on Snacks', tool: 'update_category|delete_category', outcome: (last) => rows(last, { 'Limit per expense': 'No limit' }) },
  { message: 'Food & meals always needs a receipt', tool: 'update_category|create_category', outcome: (last) => rows(last, { 'Receipt needed': 'Always' }) },
  { message: 'Delete the Snacks category', tool: 'delete_category', outcome: (last) => last.action?.card.tone === 'danger' && last.action.card.title === 'Delete Snacks?' },
  { message: 'Delete Travel', tool: 'delete_category', outcome: (last) => says(last, /is used by 2 claims/) },
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

function fakeApi(): FakeExpenseApi {
  const api = new FakeExpenseApi([{ ...TRAVEL }, { ...FOOD }, { ...SNACKS }, category('Other')]);
  api.claim('Client visit Pune', 'approved', E_RAHUL, [TRAVEL.id], ['2026-10-05', '2026-10-06']);
  api.claim('Team lunch', 'submitted', E_PRIYA, [FOOD.id], ['2026-10-10']);
  api.claim('Airport cab', 'paid', E_RAHUL_V, [TRAVEL.id], ['2026-09-12']);
  return api;
}

run(`expense eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(15 * 60 * 1000);

  it('picks the right tool, and reads the filters and fields exactly, for the documented phrases', async () => {
    const report: { message: string; ok: boolean; got: string; shown: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = fakeApi();
      const model = recording();
      const started = Date.now();
      const { last, events } = await turn({ module: expenseModule, api, message: c.message, model });
      // A tool call the model wrote as text counts too: the agent recovers it (toolCallFromText).
      const written = model.texts.map(toolCallFromText).find((c): c is ModelToolCall => Boolean(c) && c !== 'malformed');
      const call = model.calls[model.calls.length - 1] ?? written;
      // A message the module read itself (expenseModule.direct) runs its tool with no model call at all.
      const direct = !model.calls.length && !model.texts.length ? (events.find((e) => e.type === 'tool') as Extract<AiEvent, { type: 'tool' }> | undefined) : undefined;
      const name = call?.name ?? direct?.name;
      const ok = Boolean(name && c.tool.split('|').includes(name)) && c.outcome(last, api);
      report.push({
        message: c.message,
        ok,
        got: call ? `${call.name} ${JSON.stringify(call.args)}` : direct ? `${direct.name} (server, no model)` : `no tool call: "${model.texts.join(' ').slice(0, 120)}"`,
        shown: last.action ? last.action.card.rows.map((r) => `${r.label}: ${r.value}`).join(' | ') : `${(last.result?.text ?? '').slice(0, 90)} ${JSON.stringify(api.lastQuery('/expenses') ?? {})}`,
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
