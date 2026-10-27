import { cleanProjectArgs, deadlineDay, deadlineInstant, dueRange, fillProjectFromText, statusesIn, statusFromWords } from '../../src/ai/modules/project.helpers';

describe('statusFromWords', () => {
  it.each([
    ['on hold', 'on-hold'],
    ['Put it on hold', 'on-hold'],
    ['paused', 'on-hold'],
    ['done', 'completed'],
    ['mark it finished', 'completed'],
    ['in progress', 'active'],
    ['start it', 'active'],
    ['not started', 'planning'],
    ['planning', 'planning'],
    ['on-hold', 'on-hold'],
  ])('%s -> %s', (words, status) => {
    expect(statusFromWords(words)).toBe(status);
  });

  it('returns null for words that name no status', () => {
    expect(statusFromWords('purple')).toBeNull();
  });
});

describe('statusesIn', () => {
  it('finds every status the user mentioned', () => {
    expect(statusesIn('Move Apollo from on hold back to active')).toEqual(['on-hold', 'active']);
    expect(statusesIn('not started yet')).toEqual(['planning']);
    expect(statusesIn('Push the Apollo deadline to 15 January')).toEqual([]);
  });
});

describe('dueRange', () => {
  const friday = '2026-10-16';

  it('reads overdue as "deadline before today"', () => {
    expect(dueRange('overdue', friday)).toEqual({ to: '2026-10-15', overdue: true, label: 'overdue' });
  });

  it.each([
    ['this week', '2026-10-12', '2026-10-18'],
    ['next week', '2026-10-19', '2026-10-25'],
    ['this month', '2026-10-01', '2026-10-31'],
    ['due next month', '2026-11-01', '2026-11-30'],
    ['next 30 days', '2026-10-16', '2026-11-15'],
    ['31 Dec', '2026-12-31', '2026-12-31'],
  ])('%s -> %s..%s', (words, from, to) => {
    expect(dueRange(words, friday)).toMatchObject({ from, to });
  });

  it('reads open-ended ranges', () => {
    expect(dueRange('before 31 Dec', friday)).toEqual({ to: '2026-12-31', label: 'due by Thu 31 Dec 2026' });
    expect(dueRange('after 1 Nov', friday)).toEqual({ from: '2026-11-01', label: 'due from Sun 1 Nov 2026' });
  });

  it('returns null when there is no time in the words', () => {
    expect(dueRange('soonish maybe', friday)).toBeNull();
  });
});

describe('deadlines are days in APP_TIMEZONE', () => {
  it('reads a deadline the page stored (local midnight in India) as that day, not the UTC one', () => {
    expect(deadlineDay('2026-12-30T18:30:00.000Z')).toBe('2026-12-31');
  });

  it('stores a day the same way the page does', () => {
    expect(deadlineInstant('2026-12-31')).toBe('2026-12-30T18:30:00.000Z');
    expect(deadlineDay(deadlineInstant('2027-01-15'))).toBe('2027-01-15');
  });
});

describe('cleanProjectArgs', () => {
  it('keeps what the user said and drops an invented description', () => {
    const said = 'Create a project called Apollo due 31 December';
    expect(cleanProjectArgs({ name: 'Apollo', description: 'A brand new initiative', deadline: '31 December', status: '' }, said)).toEqual({
      name: 'Apollo',
      deadline: '31 December',
    });
  });
});

describe('fillProjectFromText (follow-up fast path)', () => {
  it('takes the reply as the one missing description', () => {
    expect(fillProjectFromText(['description'], 'Rewrite of the customer mobile app.', '2026-10-16')).toEqual({ description: 'Rewrite of the customer mobile app' });
  });

  it('takes a date for the one missing deadline', () => {
    expect(fillProjectFromText(['deadline'], 'by next Friday', '2026-10-16')).toEqual({ deadline: '2026-10-23' });
  });

  it('leaves two missing fields to the model', () => {
    expect(fillProjectFromText(['description', 'deadline'], 'mobile app, due Friday', '2026-10-16')).toBeNull();
  });
});
