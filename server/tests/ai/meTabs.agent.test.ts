import { confirmAction } from '../../src/ai/agent.service';
import { myHolidaysModule } from '../../src/ai/modules/myHolidays.module';
import { myProfileModule } from '../../src/ai/modules/myProfile.module';
import { myTeamModule } from '../../src/ai/modules/myTeam.module';
import { roleRepository } from '../../src/repositories/role.repository';
import * as dates from '../../src/utils/dates';
import { admin, employeeUser, FakeMeInfoApi, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

// The Profile, Team and Holidays assistants (docs/AI_ME_ASSISTANTS.md, sections 7–9). Today is Thu 22 Oct 2026.

stubPersistence();
const TODAY = '2026-10-22';
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue(TODAY);
  jest.spyOn(roleRepository, 'findById').mockResolvedValue({ permissions: [] } as never);
});

const rows = (card: { rows: { label: string; value: string; previous?: string }[] }) => Object.fromEntries(card.rows.map((r) => [r.label, r.previous ? `${r.previous} → ${r.value}` : r.value]));
const confirm = (api: FakeMeInfoApi, actionId: string, values?: unknown) => confirmAction({ user: employeeUser, token: 't', actionId, api, values });

describe('Profile (section 7)', () => {
  const run = (opts: TurnOptions) => turn({ module: myProfileModule, user: employeeUser, page: '/me/profile', ...opts });

  it.each([
    ['Who is my manager?', 'You report to **Rahul Mehta** (Engineering Manager).'],
    ["What's my job title?", 'Your job title is **Backend Engineer**.'],
    ['When did I join?', 'You joined on **Mon 3 Mar 2025**.'],
    ["What's my email?", 'Your email is **priya@acme.com**.'],
  ])('answers "%s" with no model call', async (message, answer) => {
    const { last } = await run({ api: new FakeMeInfoApi(), message, model: scriptedModel(toolCall('my_profile', {})) });
    expect(last.result!.text).toBe(answer);
  });

  it('answers "Show my profile" here, instead of opening the My profile page', async () => {
    const { last } = await run({ api: new FakeMeInfoApi(), message: 'Show my profile' });
    expect(last.result!.goTo).toBeUndefined();
    expect(last.result!.table!.rows).toContainEqual({ label: 'Reports to', value: 'Rahul Mehta' });
    expect(last.result!.table!.rows).toContainEqual({ label: 'Introduction', value: '2 of 3 answered' });
  });

  it('sets a date of birth, asking for the year, and removes it', async () => {
    const api = new FakeMeInfoApi();
    const first = await run({ api, message: 'My date of birth is 24 Oct', model: scriptedModel(toolCall('set_birthday', { date: '24 Oct' })) });
    expect(first.last.result!.text).toBe('Which year were you born?');
    const second = await run({ api, conversationId: first.conversationId, message: '1995' });
    expect(second.last.action!.card).toMatchObject({ title: 'Set your date of birth', notes: ['Colleagues see only the day and month, to wish you on your birthday.'] });
    expect(rows(second.last.action!.card)).toEqual({ 'Date of birth': 'Tue 24 Oct 1995' });
    const done = await confirm(api, second.last.action!.id);
    expect(api.writes()).toEqual([{ method: 'PUT', path: '/me/profile-details', body: { dateOfBirth: '1995-10-24' } }]);
    expect(done.message.result!.text).toBe('✅ **Date of birth saved:** Tue 24 Oct 1995.');

    const remove = await run({ api, message: 'Remove my date of birth', model: scriptedModel(toolCall('set_birthday', { remove: 'yes' })) });
    expect(remove.last.action!.card).toMatchObject({ title: 'Remove your date of birth?', tone: 'danger' });
    await confirm(api, remove.last.action!.id);
    expect(api.writes()[1]).toEqual({ method: 'PUT', path: '/me/profile-details', body: { dateOfBirth: null } });
  });

  it('refuses a date in the future', async () => {
    const { last } = await run({ api: new FakeMeInfoApi(), message: 'My date of birth is 24 Oct 2030', model: scriptedModel(toolCall('set_birthday', { date: '24 Oct 2030' })) });
    expect(last.result!.text).toBe("A date of birth can't be in the future.");
  });

  it('changes one introduction answer, showing the old one', async () => {
    const api = new FakeMeInfoApi();
    const { last } = await run({ api, message: 'Set my hobbies to cycling and chess', model: scriptedModel(toolCall('update_introduction', { hobbies: 'cycling and chess' })) });
    expect(rows(last.action!.card)).toEqual({ 'My hobbies': 'Reading → Cycling and chess' });
    await confirm(api, last.action!.id);
    expect(api.writes()).toEqual([{ method: 'PUT', path: '/me/introduction', body: { hobbies: 'Cycling and chess' } }]);
  });

  it('asks the three introduction questions one at a time', async () => {
    const api = new FakeMeInfoApi();
    const about = await run({ api, message: 'Write my introduction' });
    expect(about.last.result!.text).toBe('**About me** (1 of 3). Tell your colleagues a little about yourself: where you are from, what you do, a fun fact. Now: *Backend engineer from Pune*. Say your answer, or “skip” to keep it.');
    const c = about.conversationId;
    const hobbies = await run({ api, conversationId: c, message: 'skip' });
    expect(hobbies.last.result!.text).toMatch(/^\*\*My hobbies\*\* \(2 of 3\)/);
    const loves = await run({ api, conversationId: c, message: 'Thanks to my kids, Lego and long walks' });
    expect(loves.last.result!.text).toMatch(/^\*\*What I love about my job\*\* \(3 of 3\)/);
    const card = await run({ api, conversationId: c, message: 'The people and the hard problems' });
    expect(rows(card.last.action!.card)).toEqual({ 'My hobbies': 'Reading → Thanks to my kids, Lego and long walks', 'What I love about my job': '— → The people and the hard problems' });
  });

  it('says where the rest is changed', async () => {
    const title = await run({ api: new FakeMeInfoApi(), message: 'Change my job title to Senior Engineer' });
    expect(title.last.result!.text).toBe('Your organization admin keeps your **job title** up to date. Ask them to change it.');
    const photo = await run({ api: new FakeMeInfoApi(), message: 'Change my photo' });
    expect(photo.last.result!.text).toMatch(/^Your photo and name are changed on \*\*My profile\*\*/);
    const goal = await run({ api: new FakeMeInfoApi(), message: 'Set a goal to hire a designer' });
    expect(goal.last.result!.text).toBe('Goals and reviews are on the **Performance** tab: open it and ask there.');
  });
});

describe('Team (section 8)', () => {
  const run = (message: string, api = new FakeMeInfoApi()) => turn({ module: myTeamModule, user: employeeUser, page: '/me/team', api, message });

  it.each([
    ['Who is my manager?', 'Your manager is **Rahul Mehta** (Engineering Manager · Engineering). Available this week.'],
    ['Who is on leave today?', '**Asha Rao** is on leave today (first half).'],
    ["Who's on leave this week?", 'On leave this week: **Asha Rao** (today, first half), **Vikram Singh** (Fri 23 Oct).'],
    ['Is Vikram available on Friday?', '**Vikram Singh** is on leave on Fri 23 Oct 2026.'],
    ['Is Vikram in on Monday?', 'I can only see leave for this week (Mon 19 Oct → Sun 25 Oct 2026). Ask Vikram, or Rahul Mehta.'],
    ['Who reports to me?', '**1 person** reports to you: Neha Gupta (Frontend Engineer).'],
    ['Who are my teammates?', 'Your teammates (they also report to Rahul Mehta): Asha Rao, Vikram Singh.'],
    ['Is Mike in my team?', "**Mike** isn't in your team. Your team is your manager, the people who share your manager, and the people who report to you."],
    ['Who is working from home today?', 'The Team tab shows leave only, not work from home.'],
  ])('answers "%s" with no model call', async (message, answer) => {
    const { last } = await run(message);
    expect(last.result!.text).toBe(answer);
  });

  it('shows the whole team, and says when there is none', async () => {
    const { last } = await run('Show my team');
    expect(last.result!.table!.rows.map((r) => [r.name, r.as, r.week])).toEqual([
      ['Rahul Mehta', 'Manager', 'Available this week'],
      ['Asha Rao', 'Teammate', 'On leave today (first half)'],
      ['Vikram Singh', 'Teammate', 'On leave Fri 23 Oct'],
      ['Neha Gupta', 'Reports to you', 'Available this week'],
    ]);
    const alone = new FakeMeInfoApi();
    alone.team = { ...alone.team, manager: null, peers: [], directReports: [] };
    expect((await run('Show my team', alone)).last.result!.text).toBe("You're not in a team yet. Ask your admin to set your manager.");
  });

  it('points leave requests to the Leave tab', async () => {
    expect((await run('Apply leave tomorrow')).last.result!.text).toBe('Leave is on the **Leave** tab: open it and ask there.');
  });
});

describe('Holidays (section 9)', () => {
  const run = (message: string, user = employeeUser) => turn({ module: myHolidaysModule, user, page: '/me/holidays', api: new FakeMeInfoApi(), message });

  it.each([
    ['When is the next holiday?', 'The next holiday is **Diwali** on **Sun 8 Nov 2026**, in 17 days.'],
    ['Holidays in December', '**1 holiday** in December 2026: Christmas, Fri 25 Dec.'],
    ['Is 25 Dec a holiday?', 'Yes: **Fri 25 Dec 2026** is **Christmas**.'],
    ['Is 3 Nov a holiday?', "No: Tue 3 Nov 2026 isn't a holiday."],
    ['Is 8 Nov a holiday?', 'Yes: **Sun 8 Nov 2026** is **Diwali**. It falls on a Sunday.'],
    ['When is Diwali?', '**Diwali** is on **Sun 8 Nov 2026**, in 17 days.'],
    ['When was Dussehra?', '**Dussehra** was on **Tue 20 Oct 2026**, 2 days ago.'],
    [
      'Any long weekends?',
      'Long weekends from today: **Christmas**, Fri 25 Dec → Sun 27 Dec 2026 (3 days). With a day of leave: **Guru Nanak Jayanti**: take Mon 23 Nov 2026 off for Sat 21 Nov → Tue 24 Nov 2026 (4 days).',
    ],
  ])('answers "%s" with no model call', async (message, answer) => {
    const { last } = await run(message);
    expect(last.result!.text).toBe(answer);
  });

  it('lists what is left, and a year, and moves the tab to its year', async () => {
    const left = await run('How many holidays are left this year?');
    expect(left.last.result!.text).toBe('**3 holidays** are left in 2026:');
    expect(left.last.result!.table!.rows.map((r) => r.name)).toEqual(['Diwali', 'Guru Nanak Jayanti', 'Christmas']);
    expect(left.last.result!.table!.rows[0].note).toBe('Next · Festival of lights');
    const next = await run("Show next year's holidays");
    expect(next.last.result).toMatchObject({ text: '**1 holiday** in 2027.', view: '/me/holidays?year=2027' });
  });

  it('sends a new holiday to the admin page, or to the admin', async () => {
    expect((await run('Add a holiday on 31 Dec', admin)).last.result!.text).toBe('Holidays are added on the **Holidays** page. Say “Go to holidays” to open it.');
    expect((await run('Add a holiday on 31 Dec')).last.result!.text).toBe("Only your organization's admin adds holidays.");
    expect((await run('Apply leave on 24 Dec')).last.result!.text).toBe('Leave is on the **Leave** tab: open it and ask there.');
  });
});
