import { ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { projectModule } from '../../src/ai/modules/project.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { addDays, todayIso } from '../../src/utils/dates';
import { FakeProjectApi, project, stubPersistence, turn } from './support';

// The Projects eval set (docs/AI_PROJECTS_ASSISTANT.md, section 11) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/project.eval
// The API is the in-memory fake, so no real data is touched.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

type Check = (call: ModelToolCall | undefined) => boolean;
type Outcome = (last: ChatMessageView) => boolean;
const has = (call: ModelToolCall | undefined, key: string, pattern: RegExp) => pattern.test(String(call?.args[key] ?? ''));
const row = (last: ChatMessageView, label: string, pattern: RegExp) => Boolean(last.action?.card.rows.some((r) => r.label === label && pattern.test(r.value)));

// `check` looks at the model's own call; `outcome` at what the user sees.
const CASES: { message: string; tool: string; check?: Check; outcome?: Outcome }[] = [
  { message: 'Show all projects', tool: 'list_projects' },
  { message: 'Find Apollo', tool: 'list_projects', check: (c) => has(c, 'search', /apollo/i) },
  { message: 'Which projects are on hold?', tool: 'list_projects', check: (c) => has(c, 'status', /hold/i) },
  { message: "What's overdue?", tool: 'list_projects', check: (c) => has(c, 'due', /overdue|late/i) },
  { message: 'Show projects due this month', tool: 'list_projects', check: (c) => has(c, 'due', /this month/i) },
  { message: 'How many active projects do we have?', tool: 'count_projects', outcome: (last) => /active project/.test(last.result?.text ?? '') },
  { message: 'Create a project called Zephyr due 31 December', tool: 'create_project', check: (c) => has(c, 'name', /zephyr/i) && has(c, 'deadline', /31|dec/i) },
  {
    message: 'New project Hermes: payments revamp, deadline next Friday, start it now',
    tool: 'create_project',
    outcome: (last) => row(last, 'Name', /hermes/i) && row(last, 'Status', /active/i),
  },
  { message: 'Put Apollo on hold', tool: 'update_project', outcome: (last) => row(last, 'Status', /on hold/i) },
  { message: 'Mark Apollo as done', tool: 'update_project', outcome: (last) => row(last, 'Status', /completed/i) },
  { message: 'Push the Apollo deadline to 15 January', tool: 'update_project', outcome: (last) => row(last, 'Deadline', /15 Jan/) },
  { message: 'Rename Apollo to Apollo Mobile', tool: 'update_project', outcome: (last) => row(last, 'Name', /apollo mobile/i) },
  { message: 'Delete the Apollo project', tool: 'delete_project', outcome: (last) => last.action?.card.tone === 'danger' },
  { message: 'Apollo ko on hold kar do', tool: 'update_project', outcome: (last) => row(last, 'Status', /on hold/i) },
  // A list or a count both answer this one.
  { message: 'Is anything due this week?', tool: 'list_projects|count_projects', check: (c) => has(c, 'due', /this week/i) },
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

run(`project eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('picks the right tool and fields for the documented phrases', async () => {
    const today = todayIso();
    const report: { message: string; ok: boolean; got: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = new FakeProjectApi([project('Apollo', addDays(today, 20), 'active'), project('Borealis', addDays(today, -4), 'planning')]);
      const model = recording();
      const started = Date.now();
      const { last } = await turn({ module: projectModule, api, message: c.message, model });
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
