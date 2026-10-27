import {
  activeFrom,
  asksForAnyStatus,
  asksToCreate,
  asksToDelete,
  categoryAmounts,
  categoryNameFrom,
  dateRange,
  inr,
  rangeLabel,
  statusesIn,
} from '../../src/ai/modules/expense.helpers';

const TODAY = '2026-10-21';
const range = (text: string) => {
  const r = dateRange(text, TODAY);
  return r ? `${r.from ?? ''}..${r.to ?? ''}` : null;
};

describe('claim statuses (section 3)', () => {
  it('reads the words people use', () => {
    expect(statusesIn('Show pending claims')).toEqual(['submitted']);
    expect(statusesIn('claims awaiting approval')).toEqual(['submitted']);
    expect(statusesIn('claims to be paid')).toEqual(['approved']);
    expect(statusesIn('approved but not paid yet')).toEqual(['approved']);
    expect(statusesIn('pending payment')).toEqual(['approved']);
    expect(statusesIn('declined claims')).toEqual(['rejected']);
    expect(statusesIn('reimbursed claims')).toEqual(['paid']);
    expect(statusesIn('Show claims')).toEqual([]);
  });

  it('knows "all claims" from no status said', () => {
    expect(asksForAnyStatus('Show all claims')).toBe(true);
    expect(asksForAnyStatus('claims of any status')).toBe(true);
    expect(asksForAnyStatus('Show claims')).toBe(false);
  });
});

describe('expense-date ranges', () => {
  it('reads periods', () => {
    expect(range('this month')).toBe('2026-10-01..2026-10-21');
    expect(range('last month')).toBe('2026-09-01..2026-09-30');
    expect(range('this year')).toBe('2026-01-01..2026-10-21');
    expect(range('last year')).toBe('2025-01-01..2025-12-31');
    expect(range('last 30 days')).toBe('2026-09-22..2026-10-21');
    expect(range('last week')).toBe('2026-10-12..2026-10-18');
    expect(range('yesterday')).toBe('2026-10-20..2026-10-20');
  });

  it('reads a month, in the past', () => {
    expect(range('claims for October')).toBe('2026-10-01..2026-10-21');
    expect(range('in Dec')).toBe('2025-12-01..2025-12-31');
    expect(range('Sep 2025')).toBe('2025-09-01..2025-09-30');
    // "May" is also a verb.
    expect(range('May I see the claims?')).toBeNull();
    expect(range('claims for May')).toBe('2026-05-01..2026-05-31');
  });

  it('reads from–to, since, until and one day', () => {
    expect(range('from 1 Oct to 15 Oct')).toBe('2026-10-01..2026-10-15');
    expect(range('between 1 and 15 October')).toBe('2026-10-01..2026-10-15');
    expect(range('Summary from 1 September to 15 October')).toBe('2026-09-01..2026-10-15');
    expect(range('15/09/2026 to 10/10/2026')).toBe('2026-09-15..2026-10-10');
    expect(range('since 1 Oct')).toBe('2026-10-01..2026-10-21');
    expect(range('until 15 Sep')).toBe('..2026-09-15');
    expect(range('claims on 5 Oct')).toBe('2026-10-05..2026-10-05');
  });

  it('reads back the ranges buttons carry', () => {
    expect(range('from 2026-10-01 to 2026-10-15')).toBe('2026-10-01..2026-10-15');
    expect(range('since 2026-10-01')).toBe('2026-10-01..2026-10-21');
    expect(range('until 2026-09-15')).toBe('..2026-09-15');
  });

  it('finds no dates in names', () => {
    expect(range('Show claims from Priya and Rahul')).toBeNull();
    expect(range('Show approved claims')).toBeNull();
  });

  it('labels ranges as the page shows dates', () => {
    expect(rangeLabel('2026-10-01', '2026-10-21')).toBe('1 Oct – 21 Oct 2026');
    expect(rangeLabel('2025-12-01', '2026-10-21')).toBe('1 Dec 2025 – 21 Oct 2026');
    expect(inr(12400000)).toBe('₹1,24,000.00');
  });
});

describe('category amounts (section 5)', () => {
  it('gives each amount to the field word before it', () => {
    expect(categoryAmounts('Add a new category Client meals with a limit of ₹2,000 per expense and receipt needed above ₹500')).toEqual({ limitRupees: 2000, receiptAboveRupees: 500 });
    expect(categoryAmounts('receipt above 0 and limit 1.5 lakh')).toEqual({ receiptAboveRupees: 0, limitRupees: 150000 });
    expect(categoryAmounts('limit 5000 rs and receipt over 2k')).toEqual({ limitRupees: 5000, receiptAboveRupees: 2000 });
  });

  it('gives an amount before its word to that word', () => {
    expect(categoryAmounts('₹2,000 limit, receipts over Rs 300')).toEqual({ limitRupees: 2000, receiptAboveRupees: 300 });
  });

  it('reads "no limit", "always needs a receipt" and paise', () => {
    expect(categoryAmounts('Remove the limit on Snacks')).toEqual({ limitRupees: null });
    expect(categoryAmounts('Travel always needs a receipt')).toEqual({ receiptAboveRupees: 0 });
    expect(categoryAmounts('limit 499.50')).toEqual({ limitRupees: 499.5 });
  });

  it('skips numbers glued to letters', () => {
    expect(categoryAmounts('Set Q3 limit to 500 rupees')).toEqual({ limitRupees: 500 });
  });
});

describe('category names and intent', () => {
  it('finds the new name in the message', () => {
    expect(categoryNameFrom('Add a new category Client meals with a limit of ₹2,000')).toBe('Client meals');
    expect(categoryNameFrom('Create a category called Internet')).toBe('Internet');
    expect(categoryNameFrom('Add category Fuel, limit 3000')).toBe('Fuel');
    expect(categoryNameFrom('Add a category')).toBeUndefined();
  });

  it('reads the active switch', () => {
    expect(activeFrom('default is active')).toBe(true);
    expect(activeFrom('Deactivate Travel')).toBe(false);
    expect(activeFrom('switch off Snacks')).toBe(false);
    expect(activeFrom('Set the limit to 10k')).toBeNull();
  });

  it('tells a new category, a delete and a limit removal apart', () => {
    expect(asksToCreate('Add a new category Fuel')).toBe(true);
    expect(asksToCreate('Set the Travel limit to 10k')).toBe(false);
    expect(asksToDelete('Delete Snacks')).toBe(true);
    expect(asksToDelete('Remove the limit on Snacks')).toBe(false);
  });
});
