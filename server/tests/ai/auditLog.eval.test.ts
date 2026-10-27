import { AiEvent, toolCallFromText } from '../../src/ai/agent.service';
import { auditLogModule } from '../../src/ai/modules/auditLog.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import * as dates from '../../src/utils/dates';
import { auditRow, FakeAuditApi, stubPersistence, turn } from './support';

// The Audit Logs eval set (docs/AI_AUDIT_LOGS_ASSISTANT.md, section 12) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/auditLog.eval --runInBand
// The API is the in-memory fake. Today is Thu 22 Oct 2026, in Asia/Kolkata.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue('2026-10-22');
});

const DAY_START = (d: string) => new Date(new Date(`${d}T00:00:00+05:30`).getTime()).toISOString();
const DAY_END = (d: string) => new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86_400_000 - 1).toISOString();
type Query = { module?: string; action?: string; from?: string; to?: string };

// `query`: exactly the filters the API must be asked for (anything not named is unset).
const CASES: { message: string; query: Query }[] = [
  { message: 'Show all audit logs', query: {} },
  { message: 'Load all the audit logs for Leave', query: { module: 'leave' } },
  { message: 'Leave logs', query: { module: 'leave' } },
  { message: 'What was deleted?', query: { action: 'delete' } },
  { message: 'Who signed in today?', query: { action: 'login', from: DAY_START('2026-10-22'), to: DAY_END('2026-10-22') } },
  { message: 'Audit logs from 1 Oct to 15 Oct', query: { from: DAY_START('2026-10-01'), to: DAY_END('2026-10-15') } },
  { message: 'Show updated roles this week', query: { module: 'roles', action: 'update', from: DAY_START('2026-10-19'), to: DAY_END('2026-10-22') } },
  { message: 'Deleted documents since 1 Oct', query: { module: 'documents', action: 'delete', from: DAY_START('2026-10-01'), to: DAY_END('2026-10-22') } },
  { message: 'Attendance activity yesterday', query: { module: 'attendance', from: DAY_START('2026-10-21'), to: DAY_END('2026-10-21') } },
  { message: 'Load all the audit logs for Leave created last month', query: { module: 'leave', action: 'create', from: DAY_START('2026-09-01'), to: DAY_END('2026-09-30') } },
  { message: 'Show me what was created in projects', query: { module: 'projects', action: 'create' } },
  { message: 'Who logged out yesterday?', query: { action: 'logout', from: DAY_START('2026-10-21'), to: DAY_END('2026-10-21') } },
  { message: 'Show logins in Projects', query: { action: 'login' } },
  // "Changes" covers creating, updating and deleting: no action filter (section 3.2).
  { message: 'Any changes to permissions this month?', query: { module: 'roles', from: DAY_START('2026-10-01'), to: DAY_END('2026-10-22') } },
  { message: 'Kal kya delete hua?', query: { action: 'delete', from: DAY_START('2026-10-21'), to: DAY_END('2026-10-21') } },
  { message: 'Expense claims removed in September', query: { module: 'expenses', action: 'delete', from: DAY_START('2026-09-01'), to: DAY_END('2026-09-30') } },
  { message: 'Onboarding entries between 5 and 10 October', query: { module: 'onboarding', from: DAY_START('2026-10-05'), to: DAY_END('2026-10-10') } },
  // No filter words at all: the model is asked, and nothing may be invented.
  { message: 'Show me what happened recently', query: {} },
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

run(`audit log eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('asks the API for exactly the filters said, for the documented phrases', async () => {
    const report: { message: string; ok: boolean; got: string; asked: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = new FakeAuditApi([auditRow('create', 'leave', '2026-10-21T06:00:00.000Z', 'Leave')]);
      const model = recording();
      const started = Date.now();
      const { events } = await turn({ module: auditLogModule, api, message: c.message, model });
      const written = model.texts.map(toolCallFromText).find((x): x is ModelToolCall => Boolean(x) && x !== 'malformed');
      const call = model.calls[model.calls.length - 1] ?? written;
      const direct = !model.calls.length && !model.texts.length ? (events.find((e) => e.type === 'tool') as Extract<AiEvent, { type: 'tool' }> | undefined) : undefined;
      const q = (api.lastQuery() ?? {}) as Query;
      const ok = Boolean(api.lastQuery()) && (['module', 'action', 'from', 'to'] as const).every((k) => (q[k] ?? undefined) === c.query[k]);
      report.push({
        message: c.message,
        ok,
        got: call ? `${call.name} ${JSON.stringify(call.args)}` : direct ? `${direct.name} (server, no model)` : `no tool call: "${model.texts.join(' ').slice(0, 100)}"`,
        asked: JSON.stringify({ module: q.module, action: q.action, from: q.from?.slice(0, 10), to: q.to?.slice(0, 10) }),
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
    }
    console.table(report);
    const passed = report.filter((r) => r.ok).length;
    console.log(`${passed}/${report.length} correct on ${env.OLLAMA_MODEL}`);
    expect(passed / report.length).toBeGreaterThanOrEqual(0.8);
  });
});
