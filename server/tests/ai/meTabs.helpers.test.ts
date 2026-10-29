import { asksWholeIntroduction, birthDateIn, holidayQuestion, introductionIn, otherTab, teamFocus } from '../../src/ai/modules/me.helpers';

const TODAY = '2026-10-22'; // a Thursday

describe('every tab points to the others (docs section 10, rule 6)', () => {
  it.each([
    // The four later tabs: their own words stay; the others' work is pointed to.
    ['Apply leave tomorrow', 'team', /Leave/],
    ['Who is on leave today?', 'team', null],
    ['Is my manager on leave this week?', 'team', null],
    ['Who is working from home today?', 'team', null],
    ['Request WFH tomorrow', 'team', /Attendance/],
    ['When is the next holiday?', 'team', /Holidays/],
    ['Apply leave on 24 Dec', 'holidays', /Leave/],
    ['Which holidays make a long weekend if I take a day of leave?', 'holidays', null],
    ['Who is on leave on Diwali?', 'holidays', /Team/],
    ['Set a goal to hire a designer', 'profile', /Performance/],
    ['Who is my manager?', 'profile', null],
    ['Who is on leave today?', 'profile', /Team/],
    ['Set my hobbies to cycling', 'performance', /Profile/],
    ['Apply leave tomorrow', 'performance', /Leave/],
    ['New claim for the Pune trip', 'performance', /Expenses/],
    ["Show my team's goals", 'performance', null],
    ['Who reports to me?', 'performance', /Team/],
    // The first three tabs keep their rules, and point to the new ones too.
    ['Set a goal to hire a designer', 'leave', /Performance/],
    ['When is the next holiday?', 'attendance', /Holidays/],
    ['My date of birth is 24 Oct 1995', 'expenses', /Profile/],
    ['Who is my manager?', 'leave', /Team/],
    ['Leave tomorrow', 'leave', null],
    ['Apply leave tomorrow', 'attendance', /Leave/],
  ] as const)('"%s" on %s', (message, tab, expected) => {
    const line = otherTab(message, tab);
    if (expected === null) expect(line).toBeNull();
    else expect(line).toMatch(expected);
  });
});

describe('profile words (docs section 7)', () => {
  it('reads a date of birth, and asks for a year that is missing', () => {
    expect(birthDateIn('My date of birth is 24 Oct 1995')).toEqual({ date: '1995-10-24' });
    expect(birthDateIn('I was born on 24/10/1995')).toEqual({ date: '1995-10-24' });
    expect(birthDateIn('Set my birthday to 1995-10-24')).toEqual({ date: '1995-10-24' });
    expect(birthDateIn('born October 24, 1995')).toEqual({ date: '1995-10-24' });
    expect(birthDateIn('My birthday is the 24th of October')).toEqual({ monthDay: '10-24' });
    expect(birthDateIn('My birthday is 31 Feb 1995')).toBeNull();
    expect(birthDateIn('Set my date of birth')).toBeNull();
  });

  it('reads the introduction answers named, and clears one', () => {
    expect(introductionIn('Set my hobbies to cycling and chess')).toEqual({ hobbies: 'Cycling and chess' });
    expect(introductionIn('About me: a backend engineer from Pune')).toEqual({ about: 'A backend engineer from Pune' });
    expect(introductionIn('What I love about my job is the people')).toEqual({ lovesAboutJob: 'The people' });
    expect(introductionIn('Hobbies: chess; about me: I build payment systems')).toEqual({ hobbies: 'Chess', about: 'I build payment systems' });
    expect(introductionIn('Clear my hobbies')).toEqual({ hobbies: '' });
    expect(introductionIn('Update my hobbies')).toEqual({});
  });

  it('knows a request for the whole introduction', () => {
    expect(asksWholeIntroduction('Write my introduction')).toBe(true);
    expect(asksWholeIntroduction('Introduce myself')).toBe(true);
    expect(asksWholeIntroduction('Set my hobbies to cycling')).toBe(false);
  });
});

describe('team questions (docs section 8)', () => {
  it.each([
    ['Who is my manager?', 'manager'],
    ['Who do I report to?', 'manager'],
    ['Who reports to me?', 'reports'],
    ['Who are my teammates?', 'peers'],
    ["Who's on leave today?", 'leave'],
    ['Who is off this week?', 'leave'],
    ['Is Vikram available on Friday?', 'available'],
    ['Who is working from home?', 'wfh'],
    ['Show my team', 'all'],
    ['Tell me a joke', null],
  ])('"%s" is about %s', (message, focus) => {
    expect(teamFocus(message)).toBe(focus);
  });
});

describe('holiday questions (docs section 9)', () => {
  it.each([
    ['When is the next holiday?', { kind: 'next' }],
    ['How many holidays are left this year?', { kind: 'left' }],
    ['Any long weekends?', { kind: 'long', year: undefined }],
    ['Long weekends next year', { kind: 'long', year: 2027 }],
    ['Is 25 Dec a holiday?', { kind: 'date', date: '2026-12-25' }],
    ['Was 2 Oct a holiday?', { kind: 'date', date: '2026-10-02' }],
    ['Holidays in December', { kind: 'month', month: '2026-12' }],
    ['Holidays in January', { kind: 'month', month: '2027-01' }],
    ['Holidays next month', { kind: 'month', month: '2026-11' }],
    ["Show next year's holidays", { kind: 'year', year: 2027 }],
    ['Holidays in 2025', { kind: 'year', year: 2025 }],
    ['Show holidays this year', { kind: 'year', year: 2026 }],
    ['When is Diwali?', { kind: 'named', name: 'diwali' }],
    ['May I see the holiday list?', { kind: 'year', year: 2026 }],
    ['Tell me a joke', null],
  ])('"%s"', (message, question) => {
    expect(holidayQuestion(message, TODAY)).toEqual(question);
  });
});
