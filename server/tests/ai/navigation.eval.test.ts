import { navigationModule } from '../../src/ai/modules/navigation.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { ApiClient } from '../../src/ai/types';
import { env } from '../../src/config/env';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';
import { roleRepository } from '../../src/repositories/role.repository';
import { admin, employeeUser, stubPersistence, turn } from './support';

// The Navigation eval set (docs/AI_NAVIGATION_ASSISTANT.md, section 13) against the real local model,
// on the Navigation assistant (Home). Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/navigation.eval --runInBand
// The employee's role reads Tasks and Documents only.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();
beforeEach(() => {
  jest.spyOn(roleRepository, 'findById').mockResolvedValue({
    permissions: ['tasks', 'documents'].map((module) => ({ module, read: true, create: false, update: false, delete: false })),
  } as never);
});

const PRO = { planType: 'professional' as const, billingCycle: 'monthly' as const, expiryDate: null, active: true, modules: [...PLAN_MODULES.professional], features: [...PLAN_FEATURES.professional] };
const noApi: ApiClient = {
  get: () => Promise.reject(new Error('no API call expected')),
  page: () => Promise.reject(new Error('no API call expected')),
  send: () => Promise.reject(new Error('no API call expected')),
};

// `goTo`: the page opened. `button`: no jump, a button for that page. `refused`: neither. `list`: the page list.
// `unknown`: a page the app doesn't have: never opened, whatever the model guesses.
type Expect = { goTo: string } | { button: string } | { refused: true } | { list: true } | { unknown: true };
const CASES: { message: string; who?: 'employee'; page?: string; expect: Expect }[] = [
  // Read by the server alone.
  { message: 'Jump to dashboard', page: '/me/team', expect: { goTo: '/home' } },
  { message: 'Go to the projects page', expect: { goTo: '/projects' } },
  { message: 'Take me to my leave', expect: { goTo: '/me/leave' } },
  { message: 'Open the expense summary', expect: { goTo: '/expenses?tab=summary' } },
  { message: 'Projects', expect: { goTo: '/projects' } },
  { message: 'Leave types kholo', expect: { goTo: '/leave/types' } },
  { message: 'Bring up my goals', expect: { goTo: '/me/performance' } },
  { message: 'Where are leave types?', expect: { button: 'leave-types' } },
  { message: 'Where can I go?', expect: { list: true } },
  { message: 'Open roles', who: 'employee', expect: { refused: true } },
  { message: 'Go to admin users', who: 'employee', expect: { refused: true } },
  { message: 'Go to holidays', who: 'employee', expect: { goTo: '/me/holidays' } },
  // Only the model can read these.
  { message: 'Take me to where I can approve leave requests', expect: { goTo: '/leave/approvals' } },
  { message: 'Navigate to the settings for office timings', expect: { goTo: '/leave/attendance-settings' } },
  { message: 'I need to approve some claims', expect: { button: 'approvals-expenses' } },
  { message: 'I want to check the company holiday calendar', expect: { button: 'holidays' } },
  { message: 'Where do I upload my bills?', who: 'employee', expect: { button: 'me-expenses' } },
  { message: 'Take me to the place where roles are managed', who: 'employee', expect: { refused: true } },
  { message: 'Open payroll', expect: { unknown: true } },
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

run(`navigation eval on ${env.OLLAMA_MODEL}`, () => {
  jest.setTimeout(10 * 60 * 1000);

  it('opens, offers or refuses the right page for the documented phrases', async () => {
    const report: { message: string; ok: boolean; model: string; answer: string; seconds: string }[] = [];
    for (const c of CASES) {
      const model = recording();
      const started = Date.now();
      const { last } = await turn({ module: navigationModule, api: noApi, model, user: c.who === 'employee' ? employeeUser : admin, message: c.message, page: c.page ?? '/home', subscription: PRO });
      const r = last?.result;
      const buttons = (r?.buttons ?? []).map((b) => String(b.toolCall.args.page ?? b.toolCall.name));
      const e = c.expect;
      const ok =
        'goTo' in e
          ? r?.goTo === e.goTo
          : 'button' in e
            ? !r?.goTo && buttons[0] === e.button
            : 'list' in e
              ? Boolean(r?.table?.rows.length)
              : 'unknown' in e
                ? !r?.goTo
                : !r?.goTo && /only for|doesn't include/.test(r?.text ?? '');
      report.push({
        message: c.message,
        ok,
        model: model.calls.length ? model.calls.map((x) => `${x.name} ${JSON.stringify(x.args)}`).join('; ') : model.texts.length ? `text: ${model.texts.join(' ').slice(0, 60)}` : '(server, no model)',
        answer: `${(r?.text ?? '').slice(0, 70)}${r?.goTo ? ` → ${r.goTo}` : ''}${buttons.length ? ` [${buttons.join(', ')}]` : ''}`,
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
    }
    console.table(report);
    const passed = report.filter((r) => r.ok).length;
    console.log(`${passed}/${report.length} correct on ${env.OLLAMA_MODEL}`);
    expect(passed / report.length).toBeGreaterThanOrEqual(0.8);
  });
});
