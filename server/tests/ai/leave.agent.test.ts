import { confirmAction } from '../../src/ai/agent.service';
import { leaveModule } from '../../src/ai/modules/leave.module';
import * as dates from '../../src/utils/dates';
import { employeeUser, FakeMeApi, id, leaveTypes, PAID, scriptedModel, stubPersistence, toolCall, turn, TurnOptions, UNPAID } from './support';

stubPersistence();
const TODAY = '2026-10-22'; // a Thursday
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue(TODAY);
});

const run = (opts: TurnOptions) => turn({ module: leaveModule, user: employeeUser, ...opts });
const rows = (card: { rows: { label: string; value: string }[] }) => Object.fromEntries(card.rows.map((r) => [r.label, r.value]));

describe('apply_leave (section 3)', () => {
  it('applies paid leave when the balance covers it, and sends it on Confirm', async () => {
    const api = new FakeMeApi(leaveTypes(9), TODAY);
    const { last } = await run({ api, message: 'Apply for leave from 3 Nov to 5 Nov', model: scriptedModel(toolCall('apply_leave', { dates: '3 Nov to 5 Nov' })) });
    expect(rows(last.action!.card)).toEqual({ Type: 'Paid Leave', Dates: 'Tue 3 Nov → Thu 5 Nov 2026', Days: '3', 'Left after this': '6', Reason: '—' });
    expect(last.action!.card.notes).toBeUndefined();
    const done = await confirmAction({ user: employeeUser, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'POST', path: '/leave/requests', body: { leaveTypeId: PAID, startDate: '2026-11-03', endDate: '2026-11-05', halfDay: null, reason: '' } }]);
    expect(done.message.result!.text).toBe('✅ **Leave applied:** Paid Leave, Tue 3 Nov → Thu 5 Nov 2026 (3 days). Status: pending. Your admin has been notified.');
  });

  it('falls back to unpaid leave when the balance is short, saying why', async () => {
    const api = new FakeMeApi(leaveTypes(3), TODAY);
    const { last } = await run({ api, message: 'Leave next Monday to Friday, family function', model: scriptedModel(toolCall('apply_leave', { dates: 'next Monday to Friday', reason: 'family function' })) });
    expect(rows(last.action!.card)).toMatchObject({ Type: 'Unpaid Leave', Dates: 'Mon 26 Oct → Fri 30 Oct 2026', Days: '5', 'Left after this': 'Unlimited', Reason: 'family function' });
    expect(last.action!.card.notes).toEqual(['Paid Leave has 3 days left and this needs 5 days, so this is Unpaid Leave. You can change the type.']);
  });

  it('takes a half day, first half unless the second is said', async () => {
    const api = new FakeMeApi(leaveTypes(), TODAY);
    const first = await run({ api, message: 'Half day tomorrow', model: scriptedModel(toolCall('apply_leave', { dates: 'tomorrow', halfDay: 'half day' })) });
    expect(rows(first.last.action!.card)).toMatchObject({ Dates: 'Fri 23 Oct 2026 (first half)', Days: '0.5' });
    const second = await run({ api, message: "Second half on 28 Oct, doctor's appointment", model: scriptedModel(toolCall('apply_leave', { dates: '28 Oct' })) });
    expect(rows(second.last.action!.card)).toMatchObject({ Dates: 'Wed 28 Oct 2026 (second half)', Reason: "doctor's appointment" });
  });

  it('takes a named type, and drops one the model invented', async () => {
    const api = new FakeMeApi(leaveTypes(), TODAY);
    const named = await run({ api, message: 'Unpaid leave on 6 Nov', model: scriptedModel(toolCall('apply_leave', { dates: '6 Nov', type: 'unpaid' })) });
    expect(rows(named.last.action!.card).Type).toBe('Unpaid Leave');
    const invented = await run({ api, message: 'Leave on 6 Nov', model: scriptedModel(toolCall('apply_leave', { dates: '6 Nov', type: 'unpaid', reason: 'Personal work' })) });
    expect(rows(invented.last.action!.card)).toMatchObject({ Type: 'Paid Leave', Reason: '—' });
  });

  it("says so for a type that doesn't exist, and for weekend dates", async () => {
    const api = new FakeMeApi(leaveTypes(), TODAY);
    const sick = await run({ api, message: 'Apply sick leave for tomorrow', model: scriptedModel(toolCall('apply_leave', { dates: 'tomorrow', type: 'sick' })) });
    expect(sick.last.result!.text).toBe(`There's no leave type called "sick". Types: Paid Leave or Unpaid Leave.`);
    const weekend = await run({ api, message: 'Leave on Saturday', model: scriptedModel(toolCall('apply_leave', { dates: 'Saturday' })) });
    expect(weekend.last.result!.text).toBe('The selected dates are all weekends or holidays');
  });

  it('asks for the dates, and takes a plain reply without the model', async () => {
    const api = new FakeMeApi(leaveTypes(), TODAY);
    const first = await run({ api, message: 'I want to apply for leave', model: scriptedModel(toolCall('apply_leave', {})) });
    expect(first.last.result!.text).toBe('Which dates do you want leave for?');
    const second = await run({ api, conversationId: first.conversationId, message: 'next Monday and Tuesday', model: scriptedModel() });
    expect(rows(second.last.action!.card)).toMatchObject({ Dates: 'Mon 26 Oct → Tue 27 Oct 2026', Days: '2' });
  });

  it('points work from home to the Attendance tab', async () => {
    const api = new FakeMeApi(leaveTypes(), TODAY);
    const { last } = await run({ api, message: 'Work from home tomorrow', model: scriptedModel(toolCall('apply_leave', { dates: 'tomorrow' })) });
    expect(last.result!.text).toBe('Work from home is on the **Attendance** tab: open it and ask there.');
  });
});

describe('leave_balance, list_my_leave and cancel_leave', () => {
  it('shows the balance', async () => {
    const api = new FakeMeApi(leaveTypes(9), TODAY);
    const { last } = await run({ api, toolCall: { name: 'leave_balance', args: {} } });
    expect(last.result!.table!.rows).toEqual([
      { type: 'Paid Leave', quota: '12', taken: '3', pending: '0', available: '9' },
      { type: 'Unpaid Leave', quota: 'Unlimited', taken: '0', pending: '0', available: 'Unlimited' },
    ]);
  });

  it('cancels the request a date points to', async () => {
    const api = new FakeMeApi(leaveTypes(), TODAY);
    const r = { id: id(), leaveTypeId: PAID, leaveTypeName: 'Paid Leave', startDate: '2026-11-03', endDate: '2026-11-05', halfDay: null, days: 3, reason: '', status: 'pending' as const, canCancel: true };
    api.leave = [r, { ...r, id: id(), leaveTypeId: UNPAID, leaveTypeName: 'Unpaid Leave', startDate: '2026-12-01', endDate: '2026-12-01', days: 1 }];
    const { last } = await run({ api, message: 'Cancel my leave on 5 Nov', model: scriptedModel(toolCall('cancel_leave', { which: 'my leave on 5 Nov' })) });
    expect(last.action!.card).toMatchObject({ title: 'Cancel Paid Leave?', tone: 'danger' });
    await confirmAction({ user: employeeUser, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'POST', path: `/leave/requests/${r.id}/cancel` }]);
  });

  it('applies instead when the model called cancel for an application', async () => {
    const api = new FakeMeApi(leaveTypes(), TODAY);
    const { last } = await run({ api, message: 'Leave on 6 Nov', model: scriptedModel(toolCall('cancel_leave', { which: '6 Nov' })) });
    expect(last.action!.card.title).toBe('Apply for leave');
  });
});
