import {
  asksToSubmit,
  commentIn,
  controlWord,
  dueIn,
  endOf,
  findGoals,
  goalStatusIn,
  goalTitleFrom,
  newDueIn,
  progressIn,
  ratingIn,
  startIn,
  titleFromReply,
  weightIn,
} from '../../src/ai/modules/performance.helpers';

const TODAY = '2026-10-22'; // a Thursday

describe('a new goal (docs section 6.1)', () => {
  it.each([
    ['Set a goal to launch the onboarding flow by 31 Dec', 'Launch the onboarding flow'],
    ['New goal: hire a designer, due 31 Jan', 'Hire a designer'],
    ['Add a goal called Ship v2 with weight 20%', 'Ship v2'],
    ['Set a goal for Neha to close 10 deals by 31 Dec', 'Close 10 deals'],
    ['Create a goal of reducing churn by 10% by the end of the year', 'Reducing churn by 10%'],
    ['Set a goal to write the API docs', 'Write the API docs'],
  ])('reads the title of "%s"', (message, title) => {
    expect(goalTitleFrom(message)).toBe(title);
  });

  it('finds no title where none was said', () => {
    expect(goalTitleFrom('Set a new goal')).toBeUndefined();
    expect(goalTitleFrom('I am at 60% on the onboarding goal')).toBeUndefined();
    expect(titleFromReply("It's to hire a designer by 31 Jan")).toBe('Hire a designer');
  });

  it('reads the due date, leaning to the future, and the end of a year, month or quarter', () => {
    expect(dueIn('Set a goal to hire a designer by 31 Jan, weight 20%', TODAY)).toBe('2027-01-31');
    expect(dueIn('New goal: write docs, due 15 Dec', TODAY)).toBe('2026-12-15');
    expect(dueIn('Set a goal to ship v2 by the end of the year', TODAY)).toBe('2026-12-31');
    expect(endOf('by the end of next month', TODAY)).toBe('2026-11-30');
    expect(endOf('end of this quarter', TODAY)).toBe('2026-12-31');
    expect(endOf('end of next quarter', TODAY)).toBe('2027-03-31');
    expect(dueIn('Set a goal to write the API docs', TODAY)).toBeUndefined();
  });

  it('reads the start and the weight', () => {
    expect(startIn('Set a goal to ship v2 starting 1 Nov, due 31 Dec', TODAY)).toBe('2026-11-01');
    expect(startIn('Set a goal to ship v2 from 1 Oct to 31 Dec', TODAY)).toBe('2026-10-01');
    expect(weightIn('weight 20%')).toBe(20);
    expect(weightIn('with a 30% weight')).toBe(30);
    expect(weightIn('weightage 15')).toBe(15);
    expect(weightIn('weight 120%')).toBeUndefined();
  });
});

describe('a check-in (docs section 6.2)', () => {
  it('reads progress, but not a weight', () => {
    expect(progressIn("I'm at 60% on the onboarding goal")).toBe(60);
    expect(progressIn('progress to 75 on hiring')).toBe(75);
    expect(progressIn('we are halfway there')).toBe(50);
    expect(progressIn('Set its weight to 20%')).toBeUndefined();
    expect(progressIn('Hiring is behind')).toBeUndefined();
  });

  it('reads the status, and "60% done" as progress only', () => {
    expect(goalStatusIn('Mark the hiring goal as completed')).toBe('completed');
    expect(goalStatusIn("I'm done with the hiring goal")).toBe('completed');
    expect(goalStatusIn('Onboarding is 60% done')).toBeUndefined();
    expect(goalStatusIn('Hiring is behind because two candidates dropped out')).toBe('behind');
    expect(goalStatusIn('The onboarding flow is at risk')).toBe('at_risk');
    expect(goalStatusIn('Cancel the hiring goal')).toBe('cancelled');
    expect(goalStatusIn('Reopen the hiring goal')).toBe('reopen');
    expect(goalStatusIn('On track because the client cancelled the meeting')).toBe('on_track');
  });

  it('reads a comment after because, since or "comment:"', () => {
    expect(commentIn('Hiring is behind because two candidates dropped out')).toBe('two candidates dropped out');
    expect(commentIn('60% on onboarding, comment: waiting for design')).toBe('waiting for design');
    expect(commentIn('Mark the hiring goal as completed')).toBeUndefined();
  });

  it('reads a new due date in a change', () => {
    expect(newDueIn("Move the onboarding goal's due date to 15 Jan", TODAY)).toBe('2027-01-15');
    expect(newDueIn('Push the hiring goal to the end of next month', TODAY)).toBe('2026-11-30');
  });

  it('finds the goal by the words of its title, and asks between equals', () => {
    const goals = [{ title: 'Launch the new onboarding flow' }, { title: 'Hire two backend engineers' }, { title: 'Launch the mobile app' }];
    expect(findGoals("I'm at 60% on the onboarding goal", goals)).toEqual([goals[0]]);
    expect(findGoals('The hiring goal is behind', goals)).toEqual([goals[1]]);
    expect(findGoals('Launch is going well', goals)).toEqual([goals[0], goals[2]]);
    expect(findGoals('Hire two backend engineers is done', goals)).toEqual([goals[1]]);
    expect(findGoals('The payroll goal is at 50%', goals)).toEqual([]);
  });
});

describe('a review (docs section 6.3)', () => {
  it.each([
    ['4', 4],
    ['four', 4],
    ['4 out of 5', 4],
    ['4/5', 4],
    ["I'd rate myself 3", 3],
    ['Exceeds expectations', 4],
    ['outstanding', 5],
    ['Write my self review', undefined],
    ['We shipped 2 features', undefined],
  ])('reads the rating in "%s"', (message, rating) => {
    expect(ratingIn(message)).toBe(rating);
  });

  it('knows skip, done and stop, and any other reply is an answer', () => {
    expect(controlWord('skip')).toBe('skip');
    expect(controlWord('Skip this one')).toBe('skip');
    expect(controlWord("That's all")).toBe('done');
    expect(controlWord('never mind')).toBe('stop');
    expect(controlWord('Great teamwork this quarter')).toBeNull();
  });

  it('submits only when asked, never for a draft', () => {
    expect(asksToSubmit('Submit my self review')).toBe(true);
    expect(asksToSubmit("Write my self review but don't submit it yet")).toBe(false);
    expect(asksToSubmit('Save my self review as a draft')).toBe(false);
    expect(asksToSubmit('Write my self review')).toBe(false);
  });
});
