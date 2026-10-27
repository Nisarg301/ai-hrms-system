import { ChatMessageView } from '../../src/ai/agent.service';
import { exportsModule } from '../../src/ai/modules/exports.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { FakeExportApi, stubPersistence, turn } from './support';

// The Exports eval set (docs/AI_EXPORTS_ASSISTANT.md, section 13) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/exports.eval
// Plain commands never reach the model (section 6); the report shows which phrases did.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();

const ALL4 = ['employees', 'documents', 'projects', 'tasks'];
const files = (last: ChatMessageView) => (last.result?.downloads ?? []).map((d) => d.path.replace('/exports/', ''));
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Downloads exactly these, started at once unless `offered` (a question gets buttons instead). */
const downloads =
  (modules: string[], opts: { offered?: boolean; note?: RegExp } = {}) =>
  (last: ChatMessageView) =>
    same(files(last), modules) && Boolean(last.result?.autoDownload) === !opts.offered && (!opts.note || opts.note.test(last.result?.text ?? ''));

// `before`: an earlier message in the same conversation (the reported case: a download, then thanks).
const CASES: { message: string; before?: string; outcome: (last: ChatMessageView) => boolean }[] = [
  { message: 'Download the CSV for employees, documents, projects and tasks', outcome: downloads(ALL4) },
  { message: 'Download the employees CSV', outcome: downloads(['employees']) },
  { message: 'Export projects and tasks', outcome: downloads(['projects', 'tasks']) },
  { message: 'Download everything', outcome: downloads(ALL4) },
  { message: 'Download everything except documents', outcome: downloads(['employees', 'projects', 'tasks']) },
  { message: 'Mujhe employees aur projects ki CSV chahiye', outcome: downloads(['employees', 'projects']) },
  { message: 'Can I get documents and staff records as an Excel file?', outcome: downloads(['employees', 'documents'], { note: /open in Excel/ }) },
  { message: 'I need the project list for the board meeting', outcome: downloads(['projects']) },
  { message: 'Give me the task data, I want to check deadlines', outcome: downloads(['tasks']) },
  { message: 'Download the emplyees list', outcome: downloads(['employees']) },
  { message: 'Projects aur tasks dono download karo', outcome: downloads(['projects', 'tasks']) },
  { message: 'Download only the active employees', outcome: downloads(['employees'], { note: /can't be filtered/ }) },
  { message: "What's in the tasks export?", outcome: downloads(['tasks'], { offered: true }) },
  // The list of exports with buttons, or a plain answer naming them: either is right, as long as nothing downloads.
  { message: 'What can I export?', outcome: (last) => !files(last).length && (Boolean(last.result?.buttons?.length) || /employees/i.test(last.result?.text ?? '')) },
  { message: 'Download attendance', outcome: (last) => !files(last).length && /Team attendance page/.test(last.result?.text ?? '') },
  // A download happens only when the latest message asks for one.
  { message: 'Thank you for making my work easy', before: 'Download the documents and projects CSV', outcome: (last) => !files(last).length },
  { message: 'You made my work so easy', before: 'Download the documents and projects CSV', outcome: (last) => !files(last).length },
  { message: 'Projects are important to me', outcome: (last) => !last.result?.autoDownload },
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

run(`exports eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('downloads the right files for the documented phrases', async () => {
    const report: { message: string; ok: boolean; readBy: string; got: string; seconds: string }[] = [];
    for (const c of CASES) {
      const model = recording();
      const started = Date.now();
      const api = new FakeExportApi();
      const earlier = c.before ? await turn({ module: exportsModule, api, message: c.before, model: recording() }) : null;
      const { last } = await turn({ module: exportsModule, api, message: c.message, model, conversationId: earlier?.conversationId });
      const used = model.calls.length > 0 || model.texts.length > 0;
      const call = model.calls[model.calls.length - 1];
      report.push({
        message: c.message,
        ok: c.outcome(last),
        readBy: used ? `model ${call ? `${call.name} ${JSON.stringify(call.args)}` : `text: "${model.texts.join(' ').slice(0, 60)}"`}` : 'server',
        got: `${files(last).join(', ') || '(no files)'}${last.result?.autoDownload === false ? ' [offered]' : ''}`,
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
    }
    console.table(report);
    const passed = report.filter((r) => r.ok).length;
    console.log(`${passed}/${report.length} correct on ${env.OLLAMA_MODEL}; ${report.filter((r) => r.readBy === 'server').length} read without the model`);
    expect(passed / report.length).toBeGreaterThanOrEqual(0.8);
  });
});
