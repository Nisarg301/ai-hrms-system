import { confirmAction } from '../../src/ai/agent.service';
import { performanceModule } from '../../src/ai/modules/performance.module';
import { canUseModule } from '../../src/ai/registry';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';
import { roleRepository } from '../../src/repositories/role.repository';
import * as dates from '../../src/utils/dates';
import { employeeUser, FakePerformanceApi, goal, P_NEHA, QUESTIONS, scriptedModel, stored, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();
const TODAY = '2026-10-22'; // a Thursday
const PRO = { planType: 'professional' as const, billingCycle: 'monthly' as const, expiryDate: null, active: true, modules: [...PLAN_MODULES.professional], features: [...PLAN_FEATURES.professional] };
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue(TODAY);
  // Navigation (step 1b) reads the role for "Show my goals"; it may read no module pages.
  jest.spyOn(roleRepository, 'findById').mockResolvedValue({ permissions: [] } as never);
});

const run = (opts: TurnOptions) => turn({ module: performanceModule, user: employeeUser, page: '/me/performance', ...opts });
const rows = (card: { rows: { label: string; value: string; previous?: string }[] }) => Object.fromEntries(card.rows.map((r) => [r.label, r.previous ? `${r.previous} → ${r.value}` : r.value]));
const confirm = (api: FakePerformanceApi, actionId: string, values?: unknown) => confirmAction({ user: employeeUser, subscription: PRO, token: 't', actionId, api, values });

describe('a new goal (section 6.1)', () => {
  it('reads every detail, warns about the weights, and adds it on Confirm', async () => {
    const api = new FakePerformanceApi();
    const { last } = await run({ api, message: 'Set a goal to hire a designer by 31 Jan, weight 20%', model: scriptedModel(toolCall('create_goal', { title: 'hire a designer', due: '31 Jan', weight: '20%' })) });
    expect(last.action!.card.title).toBe('New goal');
    expect(rows(last.action!.card)).toEqual({ Goal: 'Hire a designer', Start: 'Thu 22 Oct 2026', Due: 'Sun 31 Jan 2027', Weight: '20%', Description: '—' });
    expect(last.action!.card.notes).toEqual(["Your goals' weights would add up to 90% (100% is usual)."]);
    const done = await confirm(api, last.action!.id);
    expect(api.writes()).toEqual([{ method: 'POST', path: '/goals', body: { title: 'Hire a designer', description: '', startDate: '2026-10-22', dueDate: '2027-01-31', weight: 20 } }]);
    expect(done.message.result!.text).toBe('✅ **Goal added:** Hire a designer, due Sun 31 Jan 2027.');
  });

  it('asks for the due date, and reads a plain reply with no model', async () => {
    const api = new FakePerformanceApi();
    const first = await run({ api, message: 'Set a goal to write the API docs', model: scriptedModel(toolCall('create_goal', { title: 'write the API docs' })) });
    expect(first.last.result!.text).toBe('When is **Write the API docs** due?');
    const second = await run({ api, conversationId: first.conversationId, message: '15 Dec' });
    expect(rows(second.last.action!.card)).toMatchObject({ Goal: 'Write the API docs', Due: 'Tue 15 Dec 2026' });
  });

  it('sets one for a direct report, and refuses one for someone else', async () => {
    const api = new FakePerformanceApi();
    const neha = await run({ api, message: 'Set a goal for Neha to close 10 deals by 31 Dec', model: scriptedModel(toolCall('create_goal', { title: 'close 10 deals', due: '31 Dec', for: 'Neha' })) });
    expect(neha.last.action!.card.title).toBe('New goal for Neha Gupta');
    const done = await confirm(api, neha.last.action!.id);
    expect(api.writes()[0].body).toMatchObject({ title: 'Close 10 deals', dueDate: '2026-12-31', ownerId: P_NEHA });
    expect(done.message.result!.text).toBe('✅ **Goal added for Neha Gupta:** Close 10 deals, due Thu 31 Dec 2026.');

    const asha = await run({ api, message: 'Set a goal for Asha to test the app by 31 Dec', model: scriptedModel(toolCall('create_goal', { title: 'test the app', due: '31 Dec', for: 'Asha' })) });
    expect(asha.last.result!.text).toBe("**Asha Rao** doesn't report to you. You can set goals for yourself and the people who report to you.");
  });

  it('opens the form from the New goal chip', async () => {
    const { last } = await run({ api: new FakePerformanceApi(), toolCall: { name: 'create_goal', args: {}, form: true } });
    expect(last.action!.card).toMatchObject({ title: 'New goal', incomplete: true, form: { kind: 'goal', mode: 'create' } });
    expect((last.action!.card.form as { owners: { name: string }[] }).owners.map((o) => o.name)).toEqual(['Neha Gupta']);
  });
});

describe('a check-in and a change (section 6.2)', () => {
  it('records progress, keeping the status', async () => {
    const api = new FakePerformanceApi();
    const { last } = await run({ api, message: "I'm at 60% on the onboarding goal", model: scriptedModel(toolCall('check_in_goal', { goal: 'onboarding', progress: '60%' })) });
    expect(last.action!.card.title).toBe('Check in');
    expect(rows(last.action!.card)).toEqual({ Goal: 'Launch the new onboarding flow', Progress: '40% → 60%', Status: 'On track', Comment: '—' });
    const done = await confirm(api, last.action!.id);
    expect(api.writes()).toEqual([{ method: 'POST', path: `/goals/${api.goals[0].id}/check-ins`, body: { progress: 60, status: 'on_track', comment: '' } }]);
    expect(done.message.result!.text).toBe('✅ **Checked in** on Launch the new onboarding flow: 60%, On track.');
  });

  it('takes "completed" as 100%, "behind because …" as a comment, and cancels on a red card', async () => {
    const done = await run({ api: new FakePerformanceApi(), message: 'Mark the hiring goal as completed', model: scriptedModel(toolCall('check_in_goal', { goal: 'hiring', status: 'completed' })) });
    expect(rows(done.last.action!.card)).toMatchObject({ Progress: '20% → 100%', Status: 'At risk → Completed' });

    const behind = await run({ api: new FakePerformanceApi(), message: 'Hiring is behind because two candidates dropped out', model: scriptedModel(toolCall('check_in_goal', { goal: 'hiring', status: 'behind' })) });
    expect(rows(behind.last.action!.card)).toMatchObject({ Status: 'At risk → Behind', Comment: 'two candidates dropped out' });

    const cancel = await run({ api: new FakePerformanceApi(), message: 'Cancel the hiring goal', model: scriptedModel(toolCall('check_in_goal', { goal: 'hiring' })) });
    expect(cancel.last.action!.card).toMatchObject({ title: 'Cancel this goal?', tone: 'danger', confirmLabel: 'Cancel goal' });
    expect(rows(cancel.last.action!.card)).toMatchObject({ Status: 'At risk → Cancelled' });
  });

  it('asks which goal when several match, and where it stands when nothing is said', async () => {
    const api = new FakePerformanceApi();
    api.goals.push(goal('Launch the mobile app', 10, 'on_track', '2027-03-31', null));
    const which = await run({ api, message: 'Launch is going well', model: scriptedModel(toolCall('check_in_goal', { goal: 'launch', status: 'on track' })) });
    expect(which.last.result!.text).toBe('Which goal do you mean?');
    expect(which.last.result!.buttons!.map((b) => b.label)).toEqual(['Check in: Launch the new onboarding flow', 'Check in: Launch the mobile app']);

    const first = await run({ api, message: 'Check in on the hiring goal', model: scriptedModel(toolCall('check_in_goal', { goal: 'hiring' })) });
    expect(first.last.result!.text).toBe("Where does **Hire two backend engineers** stand? Say the progress (it's at 20%), a status (On track, At risk, Behind, Completed), or both.");
    const second = await run({ api, conversationId: first.conversationId, message: '50%' });
    expect(rows(second.last.action!.card)).toMatchObject({ Goal: 'Hire two backend engineers', Progress: '20% → 50%' });
  });

  it('changes a due date, and sends a check-in the model called a new goal to check_in_goal', async () => {
    const api = new FakePerformanceApi();
    const move = await run({ api, message: "Move the onboarding goal's due date to 15 Jan", model: scriptedModel(toolCall('update_goal', { goal: 'onboarding', due: '15 Jan' })) });
    expect(move.last.action!.card.title).toBe('Change this goal');
    expect(rows(move.last.action!.card)).toEqual({ Goal: 'Launch the new onboarding flow', Due: 'Thu 31 Dec 2026 → Fri 15 Jan 2027' });
    await confirm(api, move.last.action!.id);
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/goals/${api.goals[0].id}`, body: { dueDate: '2027-01-15' } }]);

    const rerouted = await run({ api: new FakePerformanceApi(), message: "I'm at 60% on the onboarding goal", model: scriptedModel(toolCall('create_goal', { title: 'onboarding goal' })) });
    expect(rerouted.last.action!.card.title).toBe('Check in');
  });
});

describe('the lists, and the section behind the drawer', () => {
  it('lists my goals with no model call, and my team goals needing attention', async () => {
    const api = new FakePerformanceApi();
    const mine = await run({ api, message: 'Show my goals' });
    expect(mine.last.result!.text).toBe('**2 goals**. Weights add up to 70% (100% is usual).');
    expect(mine.last.result!.table!.rows.map((r) => r.goal)).toEqual(['Launch the new onboarding flow', 'Hire two backend engineers']);
    expect(mine.last.result!.buttons!.map((b) => b.label)).toEqual(['Check in: Launch the new onboarding flow', 'Check in: Hire two backend engineers']);
    expect(mine.last.result!.view).toBe('/me/performance');

    const team = await run({ api, message: "Which of my team's goals need attention?" });
    expect(team.last.result).toMatchObject({ text: 'No goals needing attention in your team.', view: '/me/performance?section=team' });
    api.goals[2].status = 'at_risk';
    const atRisk = await run({ api, message: "Which of my team's goals need attention?" });
    expect(atRisk.last.result!.text).toBe('**1 goal** needing attention in your team.');
    expect(atRisk.last.result!.table!.rows[0]).toMatchObject({ goal: 'Ship the login page', owner: 'Neha Gupta' });
  });

  it('lists my reviews and the ones I write', async () => {
    const api = new FakePerformanceApi();
    const mine = await run({ api, message: 'Show my reviews' });
    expect(mine.last.result!.table!.rows).toEqual([
      { cycle: 'H2 2026', period: 'Wed 1 Jul → Thu 31 Dec 2026', self: 'Not started, due Fri 13 Nov 2026', rating: 'Not released yet' },
      { cycle: 'H1 2026', period: 'Thu 1 Jan → Tue 30 Jun 2026', self: 'Submitted', rating: '4 · Exceeds expectations' },
    ]);
    expect(mine.last.result!.buttons!.map((b) => b.label)).toEqual(['Write self review: H2 2026']);
    expect(mine.last.result!.view).toBe('/me/performance?section=reviews');

    const toWrite = await run({ api, message: 'Show the reviews I have to write', model: scriptedModel(toolCall('list_reviews', { which: 'to write' })) });
    expect(toWrite.last.result!.buttons!.map((b) => b.label)).toEqual(['Write review: Neha Gupta']);
    expect(toWrite.last.result!.view).toBe('/me/performance?section=to-write');
  });
});

describe('writing a review, a question at a time (section 6.3)', () => {
  it('asks each question, takes every reply as the answer, then the rating, and saves a draft', async () => {
    const api = new FakePerformanceApi();
    const q1 = await run({ api, message: 'Write my self review' });
    expect(q1.last.result!.text).toBe(
      '**Question 1 of 3** · H2 2026 · due Fri 13 Nov 2026: *What went well this period?* Answer in your own words. Say “skip” to leave it for later, “done” to finish now, or “stop”.'
    );
    const c = q1.conversationId;
    // "Great …" would be small talk, and "leave" another tab's word: here they're an answer.
    const q2 = await run({ api, conversationId: c, message: 'Great teamwork, and I took less leave than planned' });
    expect(q2.last.result!.text).toBe('**Question 2 of 3**: *What could have gone better?*');
    const q3 = await run({ api, conversationId: c, message: 'skip' });
    expect(q3.last.result!.text).toBe('**Question 3 of 3**: *What do you want to focus on next?*');
    const rating = await run({ api, conversationId: c, message: 'Hiring, and the payments service' });
    expect(rating.last.result!.text).toMatch(/^How would you rate yourself, from 1 to 5\? 1 Needs improvement · 2 Below expectations/);
    const card = await run({ api, conversationId: c, message: '4' });
    expect(card.last.action!.card).toMatchObject({ title: 'Your H2 2026 self review', confirmLabel: 'Save draft' });
    expect(rows(card.last.action!.card)).toEqual({
      [QUESTIONS[0].text]: 'Great teamwork, and I took less leave than planned',
      [QUESTIONS[1].text]: '—',
      [QUESTIONS[2].text]: 'Hiring, and the payments service',
      Rating: '4 · Exceeds expectations',
    });
    const done = await confirm(api, card.last.action!.id);
    expect(api.writes()).toEqual([
      {
        method: 'PUT',
        path: `/reviews/${api.reviews[0].id}/self`,
        body: { answers: [{ questionId: 'q1', text: 'Great teamwork, and I took less leave than planned' }, { questionId: 'q2', text: '' }, { questionId: 'q3', text: 'Hiring, and the payments service' }], rating: 4 },
      },
    ]);
    expect(done.message.result!.text).toBe('✅ **Draft saved** for your H2 2026 self review. Say “Submit my self review” when it\'s ready.');
  });

  it('submits a complete draft straight away, and holds an incomplete one back', async () => {
    const api = new FakePerformanceApi();
    api.reviews[0].self = { status: 'draft', answers: QUESTIONS.map((q) => ({ questionId: q.id, question: q.text, text: `About ${q.id}` })), rating: 3 };
    const ready = await run({ api, message: 'Submit my self review' });
    expect(ready.last.action!.card).toMatchObject({ confirmLabel: 'Submit review', notes: ["A submitted review can't be changed unless an admin reopens it."] });
    await confirm(api, ready.last.action!.id);
    expect(api.writes()[0]).toMatchObject({ method: 'POST', path: `/reviews/${api.reviews[0].id}/self/submit` });

    const fresh = new FakePerformanceApi();
    const q1 = await run({ api: fresh, message: 'Submit my self review' });
    const early = await run({ api: fresh, conversationId: q1.conversationId, message: 'done' });
    expect(early.last.action!.card).toMatchObject({ incomplete: true, warnings: ['Answer every question (3 left) and choose a rating to submit, or turn Submit now off to save a draft.'] });
    await expect(confirm(fresh, early.last.action!.id)).rejects.toThrow('Fill in the missing details first.');
    await confirm(fresh, early.last.action!.id, { answers: { q1: 'Shipped onboarding', q2: '', q3: '' }, rating: null, submitNow: false });
    expect(fresh.writes()[0]).toMatchObject({ method: 'PUT', path: `/reviews/${fresh.reviews[0].id}/self` });
  });

  it('stops on "stop", and ends the questions when the user goes to a page', async () => {
    const api = new FakePerformanceApi();
    const q1 = await run({ api, message: 'Write my self review' });
    const stopped = await run({ api, conversationId: q1.conversationId, message: 'stop' });
    expect(stopped.last.result!.text).toBe('OK, I stopped. Nothing was saved.');
    expect(stored.get(q1.conversationId)!.draft).toBeNull();

    const again = await run({ api, message: 'Write my self review' });
    const away = await run({ api, conversationId: again.conversationId, message: 'Take me to my leave' });
    expect(away.last.result!.goTo).toBe('/me/leave');
    expect(stored.get(again.conversationId)!.draft).toBeNull();
  });

  it("writes a direct report's review as their manager", async () => {
    const api = new FakePerformanceApi();
    const q1 = await run({ api, message: "Write Neha's review", model: scriptedModel(toolCall('write_review', { person: 'Neha' })) });
    expect(q1.last.result!.text).toMatch(/^\*\*Question 1 of 3\*\* · for \*\*Neha Gupta\*\*'s review · H2 2026 · due Fri 27 Nov 2026: \*What went well this period\?\*/);
    const c = q1.conversationId;
    await run({ api, conversationId: c, message: 'She owned the login page' });
    await run({ api, conversationId: c, message: 'done' });
    const card = stored.get(c)!.pendingActions[0];
    expect(card.card.title).toBe("Neha Gupta's H2 2026 review");
    await confirm(api, String(card._id));
    expect(api.writes()[0]).toMatchObject({ method: 'PUT', path: `/reviews/${api.reviews[2].id}/manager` });
  });
});

describe('the other tabs, and the plan', () => {
  it("points leave to the Leave tab with no model call, and isn't offered without performance", async () => {
    const { last } = await run({ api: new FakePerformanceApi(), message: 'Apply leave tomorrow' });
    expect(last.result!.text).toBe('Leave is on the **Leave** tab: open it and ask there.');
    const basic = { planType: 'basic' as const, billingCycle: 'monthly' as const, expiryDate: null, active: true, modules: [...PLAN_MODULES.basic], features: [...PLAN_FEATURES.basic] };
    expect(await canUseModule(performanceModule, employeeUser, basic)).toBe(false);
    expect(await canUseModule(performanceModule, employeeUser, PRO)).toBe(true);
  });
});
