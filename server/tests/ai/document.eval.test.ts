import { ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { documentModule } from '../../src/ai/modules/document.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { documentRow, FakeDocumentApi, stubPersistence, turn } from './support';

// The Documents eval set (docs/AI_DOCUMENTS_ASSISTANT.md, section 12) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/document.eval
// The API is the in-memory fake, so no real data is touched; an ORG_ADMIN has every right.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

type Outcome = (last: ChatMessageView) => boolean;
const row = (last: ChatMessageView, label: string, pattern: RegExp) => Boolean(last.action?.card.rows.some((r) => r.label === label && pattern.test(r.value)));
const says = (last: ChatMessageView, pattern: RegExp) => pattern.test(last.result?.text ?? '');
// Exactly these rows change: an extra one is a change nobody asked for.
const only = (last: ChatMessageView, ...labels: string[]) => JSON.stringify(last.action?.card.rows.map((r) => r.label) ?? []) === JSON.stringify(labels);

// Judged by what the user sees.
const CASES: { message: string; outcome: Outcome }[] = [
  { message: 'Show all documents', outcome: (last) => says(last, /5 documents\*\*/) },
  { message: 'Show HR documents', outcome: (last) => says(last, /2 documents\*\* in HR/) },
  { message: 'Which documents are archived?', outcome: (last) => says(last, /^\*\*Leave policy 2024\*\*/) },
  { message: 'Find the travel policy', outcome: (last) => says(last, /^\*\*Travel policy\*\*/) },
  { message: 'How many documents are in each category?', outcome: (last) => says(last, /5 documents\*\* in total/) },
  { message: 'Download the payroll guide', outcome: (last) => Boolean(last.result?.downloads?.[0]?.label === 'payroll-guide.pdf' && last.result.autoDownload) },
  { message: 'Upload a document', outcome: (last) => says(last, /I still need the \*\*title\*\*/) },
  {
    message: 'Upload the onboarding checklist under HR: steps for new joiners',
    outcome: (last) =>
      row(last, 'Title', /^Onboarding checklist$/i) && row(last, 'Category', /^HR$/) && row(last, 'Description', /steps for new joiners/) && Boolean(last.action?.card.file?.required) && !last.action?.card.notes?.length,
  },
  { message: 'Rename the travel policy to Travel policy 2026', outcome: (last) => only(last, 'Title') && row(last, 'Title', /Travel policy 2026/) },
  { message: 'Archive the travel policy', outcome: (last) => only(last, 'Status') && row(last, 'Status', /^Archived$/) },
  { message: 'Restore the leave policy', outcome: (last) => only(last, 'Status') && row(last, 'Status', /^Active$/) },
  { message: 'Move the payroll guide to the HR category', outcome: (last) => only(last, 'Category') && row(last, 'Category', /^HR$/) },
  { message: 'Upload a new version of the employee handbook', outcome: (last) => only(last, 'File') && Boolean(last.action?.card.file?.required) && /handbook/i.test(last.action?.card.title ?? '') },
  { message: 'Delete the draft notes', outcome: (last) => last.action?.card.tone === 'danger' && /Draft notes/.test(last.action.card.title) },
  { message: 'Handbook ka naya version upload karna hai', outcome: (last) => only(last, 'File') && Boolean(last.action?.card.file?.required) && /handbook/i.test(last.action?.card.title ?? '') },
  { message: 'Is there a document about leave?', outcome: (last) => says(last, /Leave policy 2024/) },
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

const library = () =>
  new FakeDocumentApi([
    documentRow('Employee handbook', 'HR'),
    documentRow('Travel policy', 'Policy'),
    documentRow('Leave policy 2024', 'Policy', { status: 'archived' }),
    documentRow('Payroll guide', 'Finance'),
    documentRow('Draft notes', 'HR', { file: null }),
  ]);

run(`document eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('shows the user the right answer or card for the documented phrases', async () => {
    const report: { message: string; ok: boolean; got: string; seconds: string }[] = [];
    for (const c of CASES) {
      const api = library();
      const model = recording();
      const started = Date.now();
      const { last } = await turn({ module: documentModule, api, message: c.message, model });
      const written = model.texts.map(toolCallFromText).find((x): x is ModelToolCall => Boolean(x) && x !== 'malformed');
      const call = model.calls[model.calls.length - 1] ?? written;
      const ok = c.outcome(last);
      report.push({
        message: c.message,
        ok,
        got: call ? `${call.name} ${JSON.stringify(call.args)}` : model.texts.length ? `no tool call: "${model.texts.join(' ').slice(0, 100)}"` : 'read by the server',
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
      if (!ok) console.log(c.message, '→', JSON.stringify(last.result ?? last.action?.card).slice(0, 300));
      // Whatever the model did, nothing may be written without a Confirm.
      expect(api.writes()).toEqual([]);
    }
    console.table(report);
    const passed = report.filter((r) => r.ok).length;
    console.log(`${passed}/${report.length} correct on ${env.OLLAMA_MODEL}`);
    expect(passed / report.length).toBeGreaterThanOrEqual(0.8);
  });
});
