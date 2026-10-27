import { confirmAction } from '../../src/ai/agent.service';
import { attendanceModule } from '../../src/ai/modules/attendance.module';
import * as dates from '../../src/utils/dates';
import { employeeUser, FakeMeApi, id, leaveTypes, PAID, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();
const TODAY = '2026-10-22'; // a Thursday
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue(TODAY);
  // 13:30 in India.
  jest.spyOn(dates, 'now').mockReturnValue(new Date('2026-10-22T08:00:00Z'));
});

const run = (opts: TurnOptions) => turn({ module: attendanceModule, user: employeeUser, ...opts });
const rows = (card: { rows: { label: string; value: string }[] }) => Object.fromEntries(card.rows.map((r) => [r.label, r.value]));
const api = () => new FakeMeApi(leaveTypes(), TODAY);

describe('request_wfh (section 4.1)', () => {
  it('asks for one day, with no reason, and sends it on Confirm', async () => {
    const fake = api();
    const { last } = await run({ api: fake, message: 'Work from home tomorrow', model: scriptedModel(toolCall('request_wfh', { dates: 'tomorrow' })) });
    expect(rows(last.action!.card)).toEqual({ Dates: 'Fri 23 Oct 2026', 'Working days': '1', Reason: '—' });
    const done = await confirmAction({ user: employeeUser, token: 't', actionId: last.action!.id, api: fake });
    expect(fake.writes()).toEqual([{ method: 'POST', path: '/attendance/requests', body: { kind: 'wfh', startDate: '2026-10-23', endDate: '2026-10-23', reason: '' } }]);
    expect(done.message.result!.text).toBe('✅ **Work from home requested** for Fri 23 Oct 2026. Status: pending.');
  });

  it('asks for a range, with the reason said', async () => {
    const { last } = await run({ api: api(), message: 'Work from home next week for a plumber visit', model: scriptedModel(toolCall('request_wfh', { dates: 'next week', reason: 'a plumber visit' })) });
    expect(rows(last.action!.card)).toEqual({ Dates: 'Mon 26 Oct → Fri 30 Oct 2026', 'Working days': '5', Reason: 'a plumber visit' });
  });

  it('refuses an overlap before the card, and dates too far back', async () => {
    const fake = api();
    fake.requests = [{ id: id(), kind: 'wfh', startDate: '2026-10-26', endDate: '2026-10-26', clockIn: null, clockOut: null, reason: '', status: 'approved', canCancel: true }];
    const overlap = await run({ api: fake, message: 'WFH on 26 Oct', model: scriptedModel(toolCall('request_wfh', { dates: '26 Oct' })) });
    expect(overlap.last.result!.text).toBe('You already have approved work from home on Mon 26 Oct 2026.');

    fake.leave = [{ id: id(), leaveTypeId: PAID, leaveTypeName: 'Paid Leave', startDate: '2026-10-29', endDate: '2026-10-30', halfDay: null, days: 2, reason: '', status: 'pending', canCancel: true }];
    const leave = await run({ api: fake, message: 'WFH on 29 Oct', model: scriptedModel(toolCall('request_wfh', { dates: '29 Oct' })) });
    expect(leave.last.result!.text).toBe('That overlaps your pending Paid Leave on Thu 29 Oct → Fri 30 Oct 2026.');
  });

  it('asks for the dates, and takes a plain reply', async () => {
    const fake = api();
    const first = await run({ api: fake, message: 'I want to work from home', model: scriptedModel(toolCall('request_wfh', {})) });
    expect(first.last.result!.text).toBe('Which day or days do you want to work from home?');
    const second = await run({ api: fake, conversationId: first.conversationId, message: 'Monday to Wednesday', model: scriptedModel() });
    expect(rows(second.last.action!.card).Dates).toBe('Mon 26 Oct → Wed 28 Oct 2026');
  });
});

describe('request_fix (section 4.2)', () => {
  it('reads the date and both times, and sends it on Confirm', async () => {
    const fake = api();
    const { last } = await run({
      api: fake,
      message: 'Fix yesterday, clock in 9:30 and clock out 6:30, forgot to clock out',
      model: scriptedModel(toolCall('request_fix', { date: 'yesterday', clockIn: '9:30', clockOut: '6:30', reason: 'forgot to clock out' })),
    });
    expect(rows(last.action!.card)).toEqual({ Date: 'Wed 21 Oct 2026', 'Clock in': '09:30 (9:30 am)', 'Clock out': '18:30 (6:30 pm)', Reason: 'forgot to clock out' });
    await confirmAction({ user: employeeUser, token: 't', actionId: last.action!.id, api: fake });
    expect(fake.writes()).toEqual([{ method: 'POST', path: '/attendance/requests', body: { kind: 'regularization', date: '2026-10-21', clockIn: '09:30', clockOut: '18:30', reason: 'forgot to clock out' } }]);
  });

  it("asks for the missing time, and takes a bare time as it", async () => {
    const fake = api();
    const first = await run({ api: fake, message: 'Fix 15 Oct, I came at 10', model: scriptedModel(toolCall('request_fix', { date: '15 Oct', clockIn: '10' })) });
    expect(first.last.result!.text).toBe('What time did you clock out on Thu 15 Oct 2026?');
    const second = await run({ api: fake, conversationId: first.conversationId, message: '7', model: scriptedModel() });
    expect(rows(second.last.action!.card)).toMatchObject({ Date: 'Thu 15 Oct 2026', 'Clock in': '10:00 (10:00 am)', 'Clock out': '19:00 (7:00 pm)' });
  });

  it('refuses a day in the future, a day of leave, and a clock-out later than now', async () => {
    const fake = api();
    const future = await run({ api: fake, message: 'Fix tomorrow, 9 to 6', model: scriptedModel(toolCall('request_fix', { date: 'tomorrow', clockIn: '9', clockOut: '6' })) });
    // "tomorrow" leans to the past for a fix, so it can't be read as a past day: the date is asked for.
    expect(future.last.result!.text).toMatch(/hasn't happened yet|Which day/);

    fake.leave = [{ id: id(), leaveTypeId: PAID, leaveTypeName: 'Paid Leave', startDate: '2026-10-20', endDate: '2026-10-20', halfDay: null, days: 1, reason: '', status: 'approved', canCancel: false }];
    const leave = await run({ api: fake, message: 'Fix 20 Oct, 9 to 6', model: scriptedModel(toolCall('request_fix', { date: '20 Oct' })) });
    expect(leave.last.result!.text).toBe("You're on Paid Leave on Tue 20 Oct 2026, so there's nothing to fix.");

    const later = await run({ api: fake, message: 'Fix today, clock in 9:30, clock out 6:30 pm', model: scriptedModel(toolCall('request_fix', { date: 'today' })) });
    expect(later.last.result!.text).toBe("Clock-out can't be later than now.");
  });
});

describe('reasons and misrouted requests', () => {
  it('reads "forgot to clock out" as the reason, and never times or command words', async () => {
    const forgot = await run({ api: api(), message: 'I forgot to clock out on 20 Oct, I came at 9:15 and left at 7 pm', model: scriptedModel(toolCall('request_fix', { date: '20 Oct', clockIn: '09:15', clockOut: '19:00' })) });
    expect(rows(forgot.last.action!.card).Reason).toBe('Forgot to clock out');
    const plain = await run({ api: api(), message: 'Regularize 15 Oct from 10 to 7', model: scriptedModel(toolCall('request_fix', { date: '15 Oct', reason: 'Regularize' })) });
    expect(rows(plain.last.action!.card).Reason).toBe('—');
    const times = await run({ api: api(), message: 'Fix yesterday, clock in 9:30 and clock out 6:30', model: scriptedModel(toolCall('request_fix', { date: 'yesterday' })) });
    expect(rows(times.last.action!.card).Reason).toBe('—');
  });

  it('cancels when the model called request_wfh for a cancel', async () => {
    const fake = api();
    fake.requests = [{ id: id(), kind: 'wfh', startDate: '2026-11-02', endDate: '2026-11-02', clockIn: null, clockOut: null, reason: '', status: 'approved', canCancel: true }];
    const { last } = await run({ api: fake, message: 'Cancel my WFH request for 2 Nov', model: scriptedModel(toolCall('request_wfh', { dates: '2 Nov' })) });
    expect(last.action!.card).toMatchObject({ title: 'Cancel this work from home request?', tone: 'danger' });
  });
});

describe('my_attendance, list and cancel', () => {
  it('sums up the month, with a fix button for a missing clock-out', async () => {
    const { last } = await run({ api: api(), message: 'How many days was I late this month?', model: scriptedModel(toolCall('my_attendance', {})) });
    expect(last.result!.text).toBe('**October 2026:** 14 present, 1 half day, 0 absent, **2 late**, 1 leave day. Average day 8h 40m. You didn\'t clock out on Mon 5 Oct 2026.');
    expect(last.result!.buttons![0]).toEqual({ label: 'Fix Mon 5 Oct 2026', toolCall: { name: 'request_fix', args: { date: '2026-10-05' } } });
  });

  it('cancels the request the words point to', async () => {
    const fake = api();
    const wfh = { id: id(), kind: 'wfh' as const, startDate: '2026-10-23', endDate: '2026-10-23', clockIn: null, clockOut: null, reason: '', status: 'pending' as const, canCancel: true };
    fake.requests = [wfh, { ...wfh, id: id(), kind: 'regularization', startDate: '2026-10-21', endDate: '2026-10-21', clockIn: '09:30', clockOut: '18:30' }];
    const { last } = await run({ api: fake, message: 'Cancel my WFH request for Friday', model: scriptedModel(toolCall('cancel_attendance_request', { which: 'WFH on Friday' })) });
    expect(last.action!.card).toMatchObject({ title: 'Cancel this work from home request?', tone: 'danger' });
    await confirmAction({ user: employeeUser, token: 't', actionId: last.action!.id, api: fake });
    expect(fake.writes()).toEqual([{ method: 'POST', path: `/attendance/requests/${wfh.id}/cancel` }]);
  });

  it('points leave to the Leave tab', async () => {
    const { last } = await run({ api: api(), message: 'Apply leave tomorrow', model: scriptedModel(toolCall('request_wfh', { dates: 'tomorrow' })) });
    expect(last.result!.text).toBe('Leave is on the **Leave** tab: open it and ask there.');
  });
});
