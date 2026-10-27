import { auditLogModule } from '../../src/ai/modules/auditLog.module';
import { actionsIn, auditRange, modulesIn } from '../../src/ai/modules/auditLog.helpers';
import { allowedTools, canUseModule } from '../../src/ai/registry';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';
import { SubscriptionState } from '../../src/services/subscription.service';
import * as dates from '../../src/utils/dates';
import { admin, auditRow, FakeAuditApi, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();
const TODAY = '2026-10-22'; // a Thursday
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue(TODAY);
});

const run = (opts: TurnOptions) => turn({ module: auditLogModule, ...opts });
const plan = (type: 'basic' | 'professional'): SubscriptionState => ({ planType: type, billingCycle: 'monthly', expiryDate: null, active: true, modules: [...PLAN_MODULES[type]], features: [...PLAN_FEATURES[type]] });

function fakeApi() {
  return new FakeAuditApi([
    auditRow('create', 'leave', '2026-09-15T05:00:00.000Z', 'Leave 2026-09-20 (Priya)'),
    auditRow('create', 'leave', '2026-10-21T06:00:00.000Z', 'Leave 2026-10-28 (Rahul)'),
    auditRow('delete', 'projects', '2026-10-20T09:30:00.000Z', 'Apollo'),
    auditRow('update', 'roles', '2026-10-19T10:00:00.000Z', 'HR Manager'),
    auditRow('login', null, '2026-10-22T03:45:00.000Z', null, 'Priya Shah'),
    auditRow('logout', null, '2026-10-21T12:00:00.000Z', null, 'Priya Shah'),
  ]);
}

describe('readers (section 3)', () => {
  it('reads module and action words as words of their own', () => {
    expect(modulesIn('Load all the audit logs for Leave created last month')).toEqual(['leave']);
    expect(modulesIn('the post-lunch logins')).toEqual([]);
    expect(modulesIn('logs of WFH requests')).toEqual(['attendance']);
    expect(modulesIn('claims removed yesterday')).toEqual(['expenses']);
    expect(modulesIn('Leave and attendance logs')).toEqual(['leave', 'attendance']);
    expect(actionsIn('Who signed in today?')).toEqual(['login']);
    expect(actionsIn('sign ins and sign outs')).toEqual(['login', 'logout']);
    expect(actionsIn('what changed in tasks')).toEqual(['update']);
    expect(actionsIn('Show all audit logs')).toEqual([]);
  });

  it('sends dates as the page does: the whole days, in Asia/Kolkata', () => {
    expect(auditRange('Audit logs from 1 Oct to 15 Oct', TODAY)).toMatchObject({ fromInstant: '2026-09-30T18:30:00.000Z', toInstant: '2026-10-15T18:29:59.999Z', label: '1 Oct – 15 Oct 2026' });
  });
});

describe('list_audit_logs (section 4)', () => {
  it.each([
    ['Load all the audit logs for Leave', { module: 'leave' }, '**2 entries** · Leave.'],
    ['Show everything that was deleted', { action: 'delete' }, '**1 entry** · Deleted.'],
    ['Audit logs from 19 Oct to 20 Oct', { from: '2026-10-18T18:30:00.000Z', to: '2026-10-20T18:29:59.999Z' }, '**2 entries** · 19 Oct – 20 Oct 2026.'],
    ['Show created entries in Leave', { module: 'leave', action: 'create' }, '**2 entries** · Leave · Created.'],
    ['Leave activity last month', { module: 'leave', from: '2026-08-31T18:30:00.000Z', to: '2026-09-30T18:29:59.999Z' }, '**1 entry** · Leave · 1 Sep – 30 Sep 2026.'],
    ['Who signed in today?', { action: 'login', from: '2026-10-21T18:30:00.000Z', to: '2026-10-22T18:29:59.999Z' }, '**1 entry** · Signed in · 22 Oct 2026.'],
    ['Deleted projects since 1 Oct', { module: 'projects', action: 'delete', from: '2026-09-30T18:30:00.000Z', to: '2026-10-22T18:29:59.999Z' }, '**1 entry** · Projects · Deleted · 1 Oct – 22 Oct 2026.'],
    ['Load all the audit logs', {}, '**6 entries**.'],
  ])('"%s" needs no model', async (message, query, line) => {
    const api = fakeApi();
    // No scripted replies: any model call fails the test.
    const { last } = await run({ api, message, model: scriptedModel() });
    expect(api.lastQuery()).toMatchObject({ module: undefined, action: undefined, from: undefined, to: undefined, ...query });
    expect(last.result!.text).toBe(line);
  });

  it('shows the rows as the page does, and moves the page to the same filters', async () => {
    const api = fakeApi();
    const { last } = await run({ api, message: 'Deleted projects since 1 Oct', model: scriptedModel() });
    expect(last.result!.table!.rows).toEqual([{ when: '20 Oct 2026, 15:00', user: 'Nisarg (Org Admin)', action: 'Deleted', module: 'Projects', record: 'Apollo' }]);
    expect(last.result!.view).toBe('/audit-logs?module=projects&action=delete&from=2026-10-01&to=2026-10-22');
  });

  it('shows sign-ins for a module, saying why, and one module at a time', async () => {
    const api = fakeApi();
    const logins = await run({ api, message: 'Show logins in Projects', model: scriptedModel() });
    expect(api.lastQuery()).toMatchObject({ module: undefined, action: 'login' });
    expect(logins.last.result!.warnings).toEqual(["Sign-ins and sign-outs aren't recorded per module, so this shows all of them, not only Projects."]);
    const two = await run({ api, message: 'Leave and attendance logs', model: scriptedModel() });
    expect(api.lastQuery()).toMatchObject({ module: 'leave' });
    expect(two.last.result!.warnings).toEqual(['One module at a time: showing Leave.']);
  });

  it('takes the model only for unusual wording, and checks its words against the message', async () => {
    const api = fakeApi();
    await run({ api, message: 'What did people do around the staff area?', model: scriptedModel(toolCall('list_audit_logs', { module: 'employees', action: 'deleted' })) });
    // "people" and "staff" name Employees, so no model was needed; "deleted" wasn't said.
    expect(api.lastQuery()).toMatchObject({ module: 'employees', action: undefined });
  });

  it('says so when nothing matches, and pages through more', async () => {
    const api = fakeApi();
    const none = await run({ api, message: 'Deleted holidays this week', model: scriptedModel() });
    expect(none.last.result!.text).toBe('No audit entries · Holidays · Deleted · 19 Oct – 22 Oct 2026.');

    api.rows = Array.from({ length: 25 }, (_, i) => auditRow('update', 'tasks', `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T06:00:00.000Z`, `Task ${i}`));
    const first = await run({ api, message: 'Updated tasks this month', model: scriptedModel() });
    expect(first.last.result!.text).toBe('**25 entries** · Tasks · Updated · 1 Oct – 22 Oct 2026. Showing 1–20.');
    const more = await run({ api, conversationId: first.conversationId, toolCall: first.last.result!.buttons![0].toolCall });
    expect(api.lastQuery()).toMatchObject({ module: 'tasks', action: 'update', page: 2 });
    expect(more.last.result!.text).toMatch(/Showing 21–25\.$/);
  });
});

describe('who can use it', () => {
  it('needs Audit Logs, which only the Professional plan has', async () => {
    expect(await canUseModule(auditLogModule, admin, plan('professional'))).toBe(true);
    expect(await canUseModule(auditLogModule, admin, plan('basic'))).toBe(false);
    expect((await allowedTools(auditLogModule, admin)).map((t) => t.name)).toEqual(['list_audit_logs']);
  });
});
