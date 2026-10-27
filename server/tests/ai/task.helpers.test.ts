import { resolveDate } from '../../src/ai/dates';
import {
  asksToMove,
  changesDueDate,
  cleanTaskArgs,
  fillTaskFromText,
  groundedNames,
  memberChange,
  OPEN_STATUSES,
  readStatuses,
  splitNames,
  statusesIn,
  statusFromWords,
  statusStatement,
  taskQuery,
  titleHasWords,
  whoseTasks,
} from '../../src/ai/modules/task.helpers';
import { todayIso } from '../../src/utils/dates';

describe('statusFromWords', () => {
  it.each([
    ['done', 'done'],
    ['I finished it', 'done'],
    ['ho gaya', 'done'],
    ["I've started", 'in-progress'],
    ['in progress', 'in-progress'],
    ['not started', 'todo'],
    ['reopen it', 'todo'],
    ['todo', 'todo'],
    ['stuck', 'blocked'],
    ['on hold', 'blocked'],
    ['in-progress', 'in-progress'],
  ])('%s -> %s', (words, status) => {
    expect(statusFromWords(words)).toBe(status);
  });

  it('returns null for words that name no status', () => {
    expect(statusFromWords('purple')).toBeNull();
  });
});

describe('statusesIn', () => {
  it('finds every status the user mentioned, without counting "not done" as done', () => {
    expect(statusesIn('Move it from blocked back to in progress')).toEqual(['blocked', 'in-progress']);
    expect(statusesIn('it is not done yet')).toEqual(['todo']);
    expect(statusesIn('Push the login bug to Friday')).toEqual([]);
  });
});

describe('readStatuses', () => {
  it('reads "open" and its other words as every status but Done', () => {
    expect(readStatuses('open')).toEqual(OPEN_STATUSES);
    expect(readStatuses('pending')).toEqual(OPEN_STATUSES);
    expect(readStatuses('blocked')).toEqual(['blocked']);
    expect(readStatuses('purple')).toBeNull();
  });
});

describe('members', () => {
  it('splits names however they come', () => {
    expect(splitNames('Mike and Priya')).toEqual(['Mike', 'Priya']);
    expect(splitNames('Rahul, Mike & Priya')).toEqual(['Rahul', 'Mike', 'Priya']);
    expect(splitNames(['me', 'Rahul'])).toEqual(['me', 'Rahul']);
    expect(splitNames('to Priya')).toEqual(['Priya']);
    expect(splitNames('')).toEqual([]);
  });

  it('keeps a "me" only when the user spoke of themselves, and other names only when said', () => {
    expect(groundedNames(['me'], 'Assign it to me')).toEqual(['me']);
    expect(groundedNames(['me'], 'Assign it to Rahul')).toEqual([]);
    expect(groundedNames(['Mike', 'Ann'], 'Add Mike to the login bug')).toEqual(['Mike']);
  });

  it.each([
    ['Add Rahul to the login task', 'add'],
    ['Assign it to Mike too', 'add'],
    ['Remove Priya from the release notes', 'remove'],
    ['Take Mike off the task', 'remove'],
    ['Assign the login bug to Mike', 'replace'],
    ['Give the release notes to Priya', 'replace'],
  ])('%s -> %s', (text, change) => {
    expect(memberChange(text)).toBe(change);
  });
});

describe('finding a task', () => {
  it('reads a move only from move words', () => {
    expect(asksToMove('Move the login bug to Hermes')).toBe(true);
    expect(asksToMove('Put it in Hermes')).toBe(true);
    expect(asksToMove('Mark the login bug in Apollo as done')).toBe(false);
    expect(asksToMove('Put the login task in progress')).toBe(false);
  });

  it('keeps the words that name the task', () => {
    expect(taskQuery('Mark the login bug task')).toBe('login bug');
    expect(taskQuery('the release notes')).toBe('release notes');
  });

  it('matches a title holding the words in any order', () => {
    expect(titleHasWords('Fix the login bug', ['bug', 'login'])).toBe(true);
    expect(titleHasWords('Fix the login bug', ['logout'])).toBe(false);
  });
});

describe('statusStatement', () => {
  it.each([
    'Mark the login bug as done',
    "I've started the review of the API spec",
    'The release notes are stuck',
    'Login bug wala task done kar do',
    'Set the login bug to blocked',
  ])('reads "%s" without the model', (text) => {
    expect(statusStatement(text)).toBe(true);
  });

  it.each([
    'Which tasks are blocked?',
    'Show my open tasks',
    'Is the login bug done?',
    'Create a task to fix the login bug, it is in progress',
    'Done tasks this week',
    "I'm done for today",
    'I finished the login bug and started the release notes',
  ])('leaves "%s" to the model', (text) => {
    expect(statusStatement(text)).toBe(false);
  });

  it('spots a message that moves a due date', () => {
    expect(changesDueDate('Push the login bug to next Monday')).toBe(true);
    expect(changesDueDate('Move the login bug to Hermes')).toBe(false);
  });
});

describe('whoseTasks', () => {
  it.each([
    ['What is Mike Johnson working on?', 'Mike Johnson'],
    ["What's Priya doing?", 'Priya'],
    ["Show Rahul's open tasks", 'Rahul'],
    ['Tasks for Mike in Apollo', 'Mike'],
  ])('%s -> %s', (text, name) => {
    expect(whoseTasks(text)).toBe(name);
  });

  it('finds no one in a question about everyone', () => {
    expect(whoseTasks('Show all tasks')).toBeUndefined();
    expect(whoseTasks('Which tasks are blocked?')).toBeUndefined();
  });
});

describe('cleanTaskArgs', () => {
  it('drops a due date the latest message doesn\'t hold, and members nobody named', () => {
    const args = cleanTaskArgs({ title: 'Fix login', dueDate: 'Friday', members: 'Rahul and Ann' }, 'Create Fix login for Rahul', 'Create Fix login for Rahul', false);
    expect(args).toEqual({ title: 'Fix login', members: ['Rahul'] });
  });

  it('reads a stray name as the title, and trusts a button', () => {
    expect(cleanTaskArgs({ name: 'Fix login' }, 'task Fix login', 'task Fix login', false)).toEqual({ title: 'Fix login' });
    expect(cleanTaskArgs({ members: 'me', description: 'Fix login' }, '', '', true)).toEqual({ description: 'Fix login', members: ['me'] });
  });
});

describe('fillTaskFromText', () => {
  const today = todayIso();

  it('fills the one missing detail from a plain reply', () => {
    expect(fillTaskFromText(['dueDate'], 'Friday', today)).toEqual({ dueDate: resolveDate('Friday', today) });
    expect(fillTaskFromText(['description'], "Users on Safari can't log in.", today)).toEqual({ description: "Users on Safari can't log in" });
    expect(fillTaskFromText(['title'], 'Call it Fix Safari login', today)).toEqual({ title: 'Fix Safari login' });
  });

  it('leaves a new request, or several missing details, to the model', () => {
    expect(fillTaskFromText(['description'], 'show my tasks', today)).toBeNull();
    expect(fillTaskFromText(['dueDate', 'members'], 'Friday', today)).toBeNull();
  });
});
