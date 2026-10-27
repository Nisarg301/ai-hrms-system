import { fillPath } from '../../src/ai/agent.service';
import { dayOf, dayRangeOf, timesIn } from '../../src/ai/dates';
import { halfDayIn, typeIn } from '../../src/ai/modules/leave.module';
import { otherTab, reasonFrom } from '../../src/ai/modules/me.helpers';
import { amountIn, asksForDraft, categoryIn, claimTitleFrom, isTitle, merchantIn, newClaimStatement } from '../../src/ai/modules/myExpense.module';
import { category, leaveTypes } from './support';

const TODAY = '2026-10-22'; // a Thursday
const range = (text: string, lean: 'future' | 'past' | 'recent') => {
  const r = dayRangeOf(text, TODAY, lean);
  return r ? `${r.from}..${r.to}` : null;
};

describe('days, leaning as each tab needs (design choices)', () => {
  it('reads "15 Oct" as next year for leave, this year for a fix, and this year for recent WFH', () => {
    expect(dayOf('15 Oct', TODAY, 'future')).toBe('2027-10-15');
    expect(dayOf('15 Oct', TODAY, 'past')).toBe('2026-10-15');
    expect(dayOf('15 Oct', TODAY, 'recent')).toBe('2026-10-15');
    expect(dayOf('10 Oct', TODAY, 'recent')).toBe('2027-10-10');
  });

  it('reads weekdays forward, except for the past', () => {
    expect(dayOf('Friday', TODAY, 'future')).toBe('2026-10-23');
    expect(dayOf('Friday', TODAY, 'past')).toBe('2026-10-16');
    expect(dayOf('last Friday', TODAY, 'past')).toBe('2026-10-16');
    expect(dayOf('next Monday', TODAY, 'recent')).toBe('2026-10-26');
  });

  it('reads ranges', () => {
    expect(range('Apply for leave from 3 Nov to 5 Nov', 'future')).toBe('2026-11-03..2026-11-05');
    expect(range('3rd to 5th November', 'future')).toBe('2026-11-03..2026-11-05');
    expect(range('from 3 to 5 Nov', 'future')).toBe('2026-11-03..2026-11-05');
    expect(range('Leave next Monday to Friday, family function', 'future')).toBe('2026-10-26..2026-10-30');
    expect(range('WFH from Monday to Wednesday', 'recent')).toBe('2026-10-26..2026-10-28');
    expect(range('next week', 'recent')).toBe('2026-10-26..2026-10-30');
    expect(range('for 3 days from Monday', 'future')).toBe('2026-10-26..2026-10-28');
    expect(range('Take 3 days of leave from Monday', 'future')).toBe('2026-10-26..2026-10-28');
    // A length of time alone is not a date.
    expect(range('I need 3 days', 'future')).toBeNull();
    expect(range('Mujhe kal chutti chahiye', 'future')).toBe('2026-10-23..2026-10-23');
    expect(range('kal clock out bhool gaya', 'past')).toBe('2026-10-21..2026-10-21');
    expect(range('5 days from Thursday', 'future')).toBe('2026-10-29..2026-11-04');
    expect(range('Half day tomorrow', 'future')).toBe('2026-10-23..2026-10-23');
    expect(range('Fix yesterday', 'past')).toBe('2026-10-21..2026-10-21');
    expect(range('Apply for leave', 'future')).toBeNull();
  });
});

describe('clock-in and clock-out times (section 4.2)', () => {
  it('reads both, with or without am and pm', () => {
    expect(timesIn('clock in 9:30 and clock out 6:30')).toEqual({ clockIn: '09:30', clockOut: '18:30' });
    expect(timesIn('9:30 am to 6:30 pm')).toEqual({ clockIn: '09:30', clockOut: '18:30' });
    expect(timesIn('from 10 to 7')).toEqual({ clockIn: '10:00', clockOut: '19:00' });
    expect(timesIn('09:30–18:30')).toEqual({ clockIn: '09:30', clockOut: '18:30' });
    expect(timesIn('between 9.15 and 5.45')).toEqual({ clockIn: '09:15', clockOut: '17:45' });
  });

  it('reads one time alone, and an afternoon clock-in', () => {
    expect(timesIn('I came at 10')).toEqual({ clockIn: '10:00' });
    expect(timesIn('left at 7 pm')).toEqual({ clockOut: '19:00' });
    expect(timesIn('in at 2 out at 6')).toEqual({ clockIn: '14:00', clockOut: '18:00' });
  });
});

describe('leave words (section 3.1)', () => {
  it('reads half days, first half by default', () => {
    expect(halfDayIn('Half day tomorrow')).toBe('first');
    expect(halfDayIn('second half on 28 Oct')).toBe('second');
    expect(halfDayIn('leave tomorrow afternoon')).toBe('second');
    expect(halfDayIn('Leave tomorrow')).toBeNull();
  });

  it('reads the type, by word, code or name', () => {
    const types = leaveTypes();
    expect(typeIn('Unpaid leave on 6 Nov', types)).toMatchObject({ name: 'Unpaid Leave' });
    expect(typeIn('take LWP tomorrow', types)).toMatchObject({ name: 'Unpaid Leave' });
    expect(typeIn('PL on Friday', types)).toMatchObject({ name: 'Paid Leave' });
    expect(typeIn('Apply for leave tomorrow', types)).toBeNull();
    expect(typeIn('unpaid leave', types.filter((t) => t.isPaid))).toBe('unknown');
  });
});

describe('reasons and other tabs', () => {
  const NOT = /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|nov|oct|half|leave)\b/g;
  it('takes a reason the user gave, and never makes one', () => {
    expect(reasonFrom('Leave next Monday to Friday, family function', undefined, NOT)).toBe('family function');
    expect(reasonFrom('Leave on Monday, I have fever', 'fever', NOT)).toBe('fever');
    expect(reasonFrom('Apply for leave from 3 Nov to 5 Nov', 'Personal work', NOT)).toBe('');
    expect(reasonFrom('Leave on Monday', 'Leave on Monday', NOT)).toBe('');
  });

  it("names the tab for another tab's work", () => {
    expect(otherTab('Work from home tomorrow', 'leave')).toMatch(/Attendance/);
    expect(otherTab('Apply leave tomorrow', 'attendance')).toMatch(/Leave/);
    expect(otherTab('New claim for the Pune trip', 'leave')).toMatch(/Expenses/);
    expect(otherTab('Leave tomorrow', 'leave')).toBeNull();
  });
});

describe('expense words (section 5.2)', () => {
  const categories = [category('Travel', 500000), category('Food & meals', 200000), category('Internet & phone', null, 50000), category('Other')];

  it('reads the claim title', () => {
    expect(claimTitleFrom('Add a new claim, client visit to Pune')).toBe('client visit to Pune');
    expect(claimTitleFrom('New claim for the September internet bill, ₹1,299 at Airtel on 5 Oct')).toBe('September internet bill');
    expect(claimTitleFrom('apply for new claim client visit to Pune')).toBe('client visit to Pune');
    expect(claimTitleFrom('Create a new claim')).toBeUndefined();
  });

  it('reads amounts, not the date', () => {
    expect(amountIn('Uber to the airport on 15 Oct, 850 rupees, travel')).toBe(850);
    expect(amountIn('₹1,299.50 at Airtel on 5 Oct')).toBe(1299.5);
    expect(amountIn('Uber on 15 Oct, 850, travel')).toBe(850);
    expect(amountIn('lunch at Haldiram on 16 Oct')).toBeNull();
  });

  it('reads the merchant and the category', () => {
    expect(merchantIn('₹1,299 at Airtel on 5 Oct')).toBe('Airtel');
    expect(merchantIn('bought from Amazon')).toBe('Amazon');
    expect(categoryIn('850 rupees, travel', categories)?.name).toBe('Travel');
    expect(categoryIn('lunch with the client', categories)?.name).toBe('Food & meals');
    expect(categoryIn('September internet bill', categories)?.name).toBe('Internet & phone');
    expect(categoryIn('a cab and a lunch', categories)).toBeUndefined();
  });

  it('knows a title from command words, and a new claim the server reads alone', () => {
    expect(isTitle('New claim')).toBe(false);
    expect(isTitle('client visit to Pune')).toBe(true);
    expect(newClaimStatement('Add a new claim, client visit to Pune', TODAY)).toBe(true);
    expect(newClaimStatement('New claim for the September internet bill, ₹1,299 at Airtel on 5 Oct', TODAY)).toBe(true);
    // Some details but not all: the model reads it ("Uber" without "at").
    expect(newClaimStatement('New claim for a cab, 650 rupees, Uber, yesterday, travel', TODAY)).toBe(false);
    expect(newClaimStatement('Add another expense to the Pune claim', TODAY)).toBe(false);
  });

  it('knows "save it as a draft"', () => {
    expect(asksForDraft('save it as a draft, I have more to add')).toBe(true);
    expect(asksForDraft('Submit it')).toBe(false);
  });
});

describe('chained calls (section 8)', () => {
  it('fills a path from earlier results, the newest item by id', () => {
    const results = [{ id: 'c1' }, { items: [{ id: 'aa02', date: '2026-10-01' }, { id: 'aa01', date: '2026-10-05' }] }];
    expect(fillPath('/expenses/{0.id}/items', results)).toBe('/expenses/c1/items');
    expect(fillPath('/expenses/{0.id}/items/{1.items.newest.id}/receipts', results)).toBe('/expenses/c1/items/aa02/receipts');
    expect(fillPath('/x/{1.items.-1.id}', results)).toBe('/x/aa01');
    expect(() => fillPath('/x/{2.id}', results)).toThrow('An earlier step returned nothing to continue with.');
  });
});
