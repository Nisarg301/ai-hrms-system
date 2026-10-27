import { ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { taskModule } from '../../src/ai/modules/task.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { roleRepository } from '../../src/repositories/role.repository';
import { addDays, todayIso } from '../../src/utils/dates';
import { employeeUser, FakeTaskApi, M_MIKE_J, M_MIKE_R, M_RAHUL, P_APOLLO, P_HERMES, stubPersistence, turn } from './support';

// The Tasks eval set (docs/AI_TASKS_ASSISTANT.md, section 11) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/task.eval
// The API is the in-memory fake, so no real data is touched. The user is Priya Shah, an
// employee with every task right.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

type Check = (call: ModelToolCall | undefined) => boolean;
type Outcome = (last: ChatMessageView) => boolean;
const has = (call: ModelToolCall | undefined, key: string, pattern: RegExp) => pattern.test(String(call?.args[key] ?? ''));
const row = (last: ChatMessageView, label: string, pattern: RegExp) => Boolean(last.action?.card.rows.some((r) => r.label === label && pattern.test(r.value)));
const says = (last: ChatMessageView, pattern: RegExp) => pattern.test(last.result?.text ?? '');

// `check` looks at the model's own call; `outcome` at what the user sees.
const CASES: { message: string; tool: string; check?: Check; outcome?: Outcome }[] = [
  { message: 'Show my open tasks', tool: 'list_tasks', outcome: (last) => says(last, /2 open tasks\*\* assigned to you/) },
  { message: "What's overdue?", tool: 'list_tasks|count_tasks', outcome: (last) => says(last, /onboarding docs|1 task\*\* is overdue/) },
  { message: 'Which tasks are blocked?', tool: 'list_tasks', outcome: (last) => says(last, /Update the onboarding docs/) },
  { message: 'Show the tasks in Hermes', tool: 'list_tasks', outcome: (last) => says(last, /in Hermes/) },
  { message: 'What is Mike Johnson working on?', tool: 'list_tasks', outcome: (last) => says(last, /Update the onboarding docs/) },
  { message: 'How many tasks are done?', tool: 'count_tasks|list_tasks', outcome: (last) => says(last, /1 done task|Plan the offsite/) },
  { message: 'Count tasks by status', tool: 'count_tasks', outcome: (last) => says(last, /5 tasks\*\* in total/) },
  {
    message: 'Create a task to fix the signup page in Apollo for Rahul, due Friday',
    tool: 'create_task',
    outcome: (last) => says(last, /signup page\*\* in Apollo\. I still need a short \*\*description\*\*\.$/i),
  },
  {
    message: 'Add a task "Write the test plan" in Hermes for Rahul and me, due 30 Oct: cover login and signup',
    tool: 'create_task',
    outcome: (last) => row(last, 'Members', /Rahul Verma and Priya Shah/) && row(last, 'Project', /Hermes/) && row(last, 'Title', /test plan/i),
  },
  { message: 'Mark the login bug as done', tool: 'update_task', outcome: (last) => row(last, 'Status', /^Done$/) },
  { message: "I've started the review of the API spec", tool: 'update_task', outcome: (last) => row(last, 'Status', /In Progress/) },
  { message: 'Push the login bug to next Monday', tool: 'update_task', outcome: (last) => row(last, 'Due date', /Mon/) },
  { message: 'Add Mike Johnson to the release notes task', tool: 'update_task', outcome: (last) => row(last, 'Members', /Priya Shah, Rahul Verma and Mike Johnson/) },
  { message: 'Remove Rahul from the release notes', tool: 'update_task', outcome: (last) => row(last, 'Members', /^Priya Shah$/) },
  { message: 'Move the login bug task to Hermes', tool: 'update_task', outcome: (last) => row(last, 'Project', /Hermes/) },
  { message: 'Delete the offsite task', tool: 'delete_task', outcome: (last) => last.action?.card.tone === 'danger' && /offsite/i.test(last.action.card.title) },
  { message: 'Login bug wala task done kar do', tool: 'update_task', outcome: (last) => row(last, 'Status', /^Done$/) },
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

function fakeApi(): FakeTaskApi {
  const today = todayIso();
  const api = new FakeTaskApi();
  api.task('Fix the login bug', { projectId: P_APOLLO, userId: [M_RAHUL], status: 'todo', dueDate: addDays(today, 4) });
  api.task('Write release notes', { projectId: P_HERMES, userId: [employeeUser.id, M_RAHUL], status: 'in-progress', dueDate: addDays(today, 10) });
  api.task('Review the API spec', { projectId: P_APOLLO, userId: [employeeUser.id], status: 'todo', dueDate: addDays(today, 6) });
  api.task('Update the onboarding docs', { projectId: P_APOLLO, userId: [M_MIKE_J], status: 'blocked', dueDate: addDays(today, -3) });
  api.task('Plan the offsite', { projectId: P_HERMES, userId: [M_MIKE_R], status: 'done', dueDate: addDays(today, -10) });
  return api;
}

run(`task eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('picks the right tool and fields for the documented phrases', async () => {
    jest.spyOn(roleRepository, 'findById').mockResolvedValue({
      permissions: [
        { module: 'tasks', read: true, create: true, update: true, delete: true },
        { module: 'projects', read: true, create: false, update: false, delete: false },
      ],
    } as never);
    const report: { message: string; ok: boolean; got: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = fakeApi();
      const model = recording();
      const started = Date.now();
      const { last } = await turn({ module: taskModule, user: employeeUser, api, message: c.message, model });
      // A tool call the model wrote as text counts too: the agent recovers it (toolCallFromText).
      const written = model.texts.map(toolCallFromText).find((x): x is ModelToolCall => Boolean(x) && x !== 'malformed');
      const call = model.calls[model.calls.length - 1] ?? written;
      // Plain status statements never reach the model (section 6): then only the outcome counts.
      const byServer = model.calls.length === 0 && model.texts.length === 0;
      const ok = (byServer || Boolean(call && c.tool.split('|').includes(call.name))) && (c.outcome ? c.outcome(last) : c.check ? c.check(call) : true);
      report.push({
        message: c.message,
        ok,
        got: byServer ? 'read by the server' : call ? `${call.name} ${JSON.stringify(call.args)}` : `no tool call: "${model.texts.join(' ').slice(0, 120)}"`,
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
      if (!ok) console.log(c.message, '→', JSON.stringify(last.result ?? last.action?.card));
      // Whatever the model did, nothing may be written without a Confirm.
      expect(api.writes()).toEqual([]);
    }
    console.table(report);
    const passed = report.filter((r) => r.ok).length;
    console.log(`${passed}/${report.length} correct on ${env.OLLAMA_MODEL}; ${report.filter((r) => r.got === 'read by the server').length} read without the model`);
    expect(passed / report.length).toBeGreaterThanOrEqual(0.8);
  });
});
