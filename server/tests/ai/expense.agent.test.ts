import { confirmAction } from '../../src/ai/agent.service';
import { expenseModule } from '../../src/ai/modules/expense.module';
import { allowedTools, canUseModule } from '../../src/ai/registry';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';
import { SubscriptionState } from '../../src/services/subscription.service';
import { monthRange, todayIso } from '../../src/utils/dates';
import { admin, category, E_PRIYA, E_RAHUL, E_RAHUL_V, employeeUser, FakeExpenseApi, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();

const run = (opts: TurnOptions) => turn({ module: expenseModule, ...opts });

function fakeApi() {
  const travel = category('Travel', 500000);
  const food = category('Food & meals', 200000);
  const snacks = category('Snacks', 30000);
  const api = new FakeExpenseApi([travel, food, snacks, category('Other')]);
  api.claim('Client visit Pune', 'approved', E_RAHUL, [travel.id], ['2026-10-05', '2026-10-06']);
  api.claim('Team lunch', 'submitted', E_PRIYA, [food.id], ['2026-10-10']);
  api.claim('Airport cab', 'paid', E_RAHUL_V, [travel.id], ['2026-09-12']);
  return { api, travel, food, snacks };
}

const plan = (type: 'basic' | 'professional'): SubscriptionState => ({
  planType: type,
  billingCycle: 'monthly',
  expiryDate: null,
  active: true,
  modules: [...PLAN_MODULES[type]],
  features: [...PLAN_FEATURES[type]],
});

describe('list_claims (section 3)', () => {
  it('filters by status, employee, category and dates, and moves the Claims tab', async () => {
    const { api, travel } = fakeApi();
    const { last } = await run({
      api,
      message: 'Show approved claims from Rahul Sharma in Travel from 1 Oct 2026 to 15 Oct 2026',
      model: scriptedModel(toolCall('list_claims', { status: 'approved', employee: 'Rahul Sharma', category: 'Travel', dates: '1 Oct 2026 to 15 Oct 2026' })),
    });
    expect(api.lastQuery('/expenses')).toMatchObject({ status: 'approved', employeeId: E_RAHUL, categoryId: travel.id, from: '2026-10-01', to: '2026-10-15' });
    expect(last.result!.text).toBe('**1 claim** · Approved – to be paid · Rahul Sharma · Travel · 1 Oct – 15 Oct 2026.');
    expect(last.result!.table!.rows[0]).toEqual({
      employee: 'Rahul Sharma',
      claim: 'Client visit Pune · EXP-0001',
      submitted: '6 Oct 2026',
      items: '2',
      total: '₹2,500.00',
      status: 'Approved – to be paid',
    });
    expect(last.result!.view).toBe(`/expenses?status=approved&employee=${E_RAHUL}&category=${travel.id}&from=2026-10-01&to=2026-10-15`);
  });

  it('drops a status the user never said, and clears filters for "all claims"', async () => {
    const { api } = fakeApi();
    await run({ api, message: 'Show claims from Priya', model: scriptedModel(toolCall('list_claims', { status: 'approved', employee: 'Priya' })) });
    expect(api.lastQuery('/expenses')).toMatchObject({ status: undefined, employeeId: E_PRIYA });

    const all = await run({ api, message: 'Show all claims', model: scriptedModel(toolCall('list_claims', { status: 'all' })) });
    expect(api.lastQuery('/expenses')).toMatchObject({ status: undefined, employeeId: undefined, categoryId: undefined, from: undefined });
    expect(all.last.result!.text).toBe('**3 claims**.');
    expect(all.last.result!.view).toBe('/expenses');
  });

  it("takes the message's status over the model's", async () => {
    const { api } = fakeApi();
    await run({ api, message: 'Show pending claims', model: scriptedModel(toolCall('list_claims', { status: 'approved' })) });
    expect(api.lastQuery('/expenses')).toMatchObject({ status: 'submitted' });
  });

  it('asks whose claims when several people match, then lists from the button', async () => {
    const { api } = fakeApi();
    const first = await run({ api, message: 'Show claims from Rahul for October', model: scriptedModel(toolCall('list_claims', { employee: 'Rahul' })) });
    expect(first.last.result!.text).toBe('2 people match "Rahul". Whose claims?');
    const button = first.last.result!.buttons!.find((b) => b.label.startsWith('Rahul Verma'))!;
    await run({ api, conversationId: first.conversationId, toolCall: button.toolCall });
    expect(api.lastQuery('/expenses')).toMatchObject({ employeeId: E_RAHUL_V, from: expect.stringMatching(/-10-01$/) });
  });

  it('finds a category the message names when the model gives none', async () => {
    const { api, travel } = fakeApi();
    await run({ api, message: 'Show Travel claims', model: scriptedModel(toolCall('list_claims', {})) });
    expect(api.lastQuery('/expenses')).toMatchObject({ categoryId: travel.id });
  });

  it('notes a category that does not exist instead of guessing', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'Show claims in Parking', model: scriptedModel(toolCall('list_claims', { category: 'Parking' })) });
    expect(last.result!.warnings).toEqual(['No category called "Parking", so the list isn\'t filtered by category.']);
  });
});

describe('export_claims (section 3)', () => {
  it('downloads the CSV for the dates said, without the model', async () => {
    const { api } = fakeApi();
    // No scripted replies: any model call fails the test.
    const { last } = await run({ api, message: 'Export the CSV for 1 Sep 2026 to 30 Sep 2026', model: scriptedModel() });
    expect(last.result!.downloads).toEqual([{ label: 'Expenses CSV', path: '/exports/expenses?from=2026-09-01&to=2026-09-30' }]);
    expect(last.result!.autoDownload).toBe(true);
    expect(last.result!.text).toMatch(/^Downloading the \*\*Expenses CSV\*\* for 1 Sep – 30 Sep 2026\. It has one row per expense/);
  });

  it('uses the dates of the latest list in the chat, and this month when there are none', async () => {
    const { api } = fakeApi();
    const list = await run({ api, message: 'Show paid claims from 1 Sep 2026 to 30 Sep 2026', model: scriptedModel(toolCall('list_claims', { status: 'paid' })) });
    const exported = await run({ api, conversationId: list.conversationId, message: 'Export the CSV', model: scriptedModel() });
    expect(exported.last.result!.downloads![0].path).toBe('/exports/expenses?from=2026-09-01&to=2026-09-30');

    const fresh = await run({ api, message: 'Export the CSV', model: scriptedModel() });
    const today = todayIso();
    expect(fresh.last.result!.downloads![0].path).toBe(`/exports/expenses?from=${today.slice(0, 7)}-01&to=${today}`);
    expect(fresh.last.result!.text).toMatch(/\(this month: no dates were given\)/);
  });

  it('downloads nothing for a thank-you, or for a question about the CSV', async () => {
    const { api } = fakeApi();
    const first = await run({ api, message: 'Export the CSV', model: scriptedModel() });
    const thanks = await run({ api, conversationId: first.conversationId, message: 'Thank you so much', model: scriptedModel() });
    expect(thanks.last.result!.downloads).toBeUndefined();

    const question = await run({ api, message: 'What is in the expenses CSV?', model: scriptedModel(toolCall('export_claims', {})) });
    expect(question.last.result!.autoDownload).toBe(false);
    expect(question.last.result!.downloads).toHaveLength(1);
  });

  it("says so when exports aren't in the plan", async () => {
    const { api } = fakeApi();
    api.planModules = [...PLAN_MODULES.basic];
    const { last } = await run({ api, message: 'Export the CSV', model: scriptedModel() });
    expect(last.result!.downloads).toBeUndefined();
    expect(last.result!.text).toBe("Exports aren't included in your plan, so the CSV can't be downloaded.");
  });
});

describe('expense_summary (section 4)', () => {
  it('sums up a range by category and moves the Summary tab', async () => {
    const { api } = fakeApi();
    const { last } = await run({
      api,
      message: 'Summary from 1 September 2026 to 15 October 2026',
      model: scriptedModel(toolCall('expense_summary', { dates: '1 September to 15 October' })),
    });
    expect(api.lastQuery('/expenses/summary')).toEqual({ from: '2026-09-01', to: '2026-10-15' });
    expect(last.result!.text).toBe(
      '**1 Sep – 15 Oct 2026**: ₹84,500.00 approved, ₹60,000.00 of it paid. Waiting now: 3 claims (₹12,400.00) to approve, 2 (₹9,800.00) to pay.'
    );
    expect(last.result!.table!.rows).toEqual([
      { name: 'Travel', total: '₹50,000.00', count: '12' },
      { name: 'Food & meals', total: '₹34,500.00', count: '30' },
    ]);
    expect(last.result!.buttons![0].label).toBe('By department');
    expect(last.result!.view).toBe('/expenses?tab=summary&from=2026-09-01&to=2026-10-15');
  });

  it('shows departments when asked, and this month with no dates', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, toolCall: { name: 'expense_summary', args: {} } });
    const today = todayIso();
    expect(api.lastQuery('/expenses/summary')).toEqual({ from: `${today.slice(0, 7)}-01`, to: today });
    expect(last.result!.table!.columns[0].title).toBe('Category');

    const byDept = await run({ api, message: 'Spending by department last month', model: scriptedModel(toolCall('expense_summary', { dates: 'last month' })) });
    expect(byDept.last.result!.table!.columns[0].title).toBe('Department');
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    expect(api.lastQuery('/expenses/summary')).toEqual(monthRange(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`));
  });

  it('lists claims when the model answered a request for claims with the summary', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'Show paid claims from 1 Sep 2026 to 30 Sep 2026', model: scriptedModel(toolCall('expense_summary', { dates: '1 Sep to 30 Sep' })) });
    expect(api.lastQuery('/expenses')).toMatchObject({ status: 'paid', from: '2026-09-01', to: '2026-09-30' });
    expect(last.result!.text).toBe('**1 claim** · Paid · 1 Sep – 30 Sep 2026.');
  });

  it('refuses a range over a year', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'Summary from 1 Jan 2024 to 1 Oct 2026', model: scriptedModel(toolCall('expense_summary', {})) });
    expect(last.result!.text).toBe('Choose a range of at most a year for the summary.');
  });
});

describe('create_category (section 5)', () => {
  it("reads every field from the user's sentence and creates on Confirm", async () => {
    const { api } = fakeApi();
    const { last } = await run({
      api,
      message: 'Add a new category Client meals with a limit of ₹2,000 per expense and receipt needed above ₹500 and default is active',
      // The model's amounts are swapped: the message's own reading wins.
      model: scriptedModel(toolCall('create_category', { name: 'Client meals', limit: '500', receiptAbove: '2000', active: 'active' })),
    });
    expect(last.action!.card.rows).toEqual([
      { label: 'Name', value: 'Client meals' },
      { label: 'Limit per expense', value: '₹2,000.00' },
      { label: 'Receipt needed', value: 'Above ₹500.00' },
      { label: 'Active', value: 'Yes' },
    ]);
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api, subscription: plan('professional') });
    expect(api.writes()).toEqual([{ method: 'POST', path: '/expense-categories', body: { name: 'Client meals', limitPaise: 200000, receiptRequiredAbovePaise: 50000, isActive: true } }]);
    expect(done.message.result!.text).toBe('✅ **Category created:** Client meals · Limit ₹2,000.00 · Receipt above ₹500.00 · Active.');
  });

  it("takes the page's defaults for what isn't said", async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'Create a category called Internet', model: scriptedModel(toolCall('create_category', { name: 'Internet', limit: '1000' })) });
    expect(last.action!.card.rows).toEqual([
      { label: 'Name', value: 'Internet' },
      { label: 'Limit per expense', value: 'No limit' },
      { label: 'Receipt needed', value: 'Above ₹500.00' },
      { label: 'Active', value: 'Yes' },
    ]);
  });

  it('asks for the name, and takes a plain reply without the model', async () => {
    const { api } = fakeApi();
    const first = await run({ api, message: 'Add a new category with a limit of 3000', model: scriptedModel(toolCall('create_category', { limit: '3000' })) });
    expect(first.last.result!.text).toBe('What should the new category be called?');
    const second = await run({ api, conversationId: first.conversationId, message: 'Fuel', model: scriptedModel() });
    expect(second.last.action!.card.rows.slice(0, 2)).toEqual([
      { label: 'Name', value: 'Fuel' },
      { label: 'Limit per expense', value: '₹3,000.00' },
    ]);
  });

  it('refuses a name already in use, offering to edit it', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'Add a new category travel', model: scriptedModel(toolCall('create_category', { name: 'travel' })) });
    expect(last.result!.text).toMatch(/^There is already a category called \*\*Travel\*\*/);
    expect(last.result!.buttons![0].label).toBe('Edit Travel');
  });

  it('checks an inactive category made on purpose', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'Add a category Gifts, inactive for now', model: scriptedModel(toolCall('create_category', { name: 'Gifts' })) });
    expect(last.action!.card.rows.find((r) => r.label === 'Active')!.value).toBe('No');
  });
});

describe('update_category', () => {
  it('changes only the field asked about, showing old → new', async () => {
    const { api, travel } = fakeApi();
    const { last } = await run({ api, message: 'Set the Travel limit to 10k', model: scriptedModel(toolCall('update_category', { category: 'Travel', limit: '10k', receiptAbove: '500' })) });
    expect(last.action!.card.rows).toEqual([{ label: 'Limit per expense', value: '₹10,000.00', previous: '₹5,000.00' }]);
    await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api, subscription: plan('professional') });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/expense-categories/${travel.id}`, body: { limitPaise: 1000000 } }]);
  });

  it('switches a category off, and renames only when asked', async () => {
    const { api } = fakeApi();
    const off = await run({ api, message: 'Deactivate Travel', model: scriptedModel(toolCall('update_category', { category: 'Travel' })) });
    expect(off.last.action!.card.rows).toEqual([{ label: 'Active', value: 'No', previous: 'Yes' }]);
    expect(off.last.action!.card.notes![0]).toMatch(/can't be chosen for new expenses/);

    const rename = await run({ api, message: 'Rename Food & meals to Meals', model: scriptedModel(toolCall('update_category', { category: 'Food & meals', newName: 'Meals' })) });
    expect(rename.last.action!.card.rows).toEqual([{ label: 'Name', value: 'Meals', previous: 'Food & meals' }]);

    const invented = await run({ api, message: 'Travel always needs a receipt', model: scriptedModel(toolCall('update_category', { category: 'Travel', newName: 'Travel receipts' })) });
    expect(invented.last.action!.card.rows).toEqual([{ label: 'Receipt needed', value: 'Always', previous: 'Above ₹500.00' }]);
  });

  it('goes to update when the model called delete for a limit removal, or create for an existing category', async () => {
    const { api } = fakeApi();
    const remove = await run({ api, message: 'Remove the limit on Snacks', model: scriptedModel(toolCall('delete_category', { category: 'Snacks' })) });
    expect(remove.last.action!.card).toMatchObject({ title: 'Update Snacks', rows: [{ label: 'Limit per expense', value: 'No limit', previous: '₹300.00' }] });

    const create = await run({ api, message: 'Set the Travel limit to 10k', model: scriptedModel(toolCall('create_category', { name: 'Travel', limit: '10k' })) });
    expect(create.last.action!.card).toMatchObject({ title: 'Update Travel', rows: [{ label: 'Limit per expense', value: '₹10,000.00', previous: '₹5,000.00' }] });
  });
});

describe('delete_category', () => {
  it('shows a red card and deletes on Confirm', async () => {
    const { api, snacks } = fakeApi();
    const { last } = await run({ api, message: 'Delete Snacks', model: scriptedModel(toolCall('delete_category', { category: 'Snacks' })) });
    expect(last.action!.card).toMatchObject({ title: 'Delete Snacks?', tone: 'danger', confirmLabel: 'Delete category' });
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api, subscription: plan('professional') });
    expect(api.writes()).toEqual([{ method: 'DELETE', path: `/expense-categories/${snacks.id}` }]);
    expect(done.message.result!.text).toBe('✅ **Snacks** was deleted.');
  });

  it('refuses while claims use it, offering to deactivate it', async () => {
    const { api, travel } = fakeApi();
    const { last } = await run({ api, message: 'Delete the Travel category', model: scriptedModel(toolCall('delete_category', { category: 'Travel' })) });
    expect(last.action).toBeNull();
    expect(last.result!.text).toMatch(/^\*\*Travel\*\* is used by 2 claims, so it can't be deleted\./);
    expect(last.result!.buttons![0]).toEqual({ label: 'Deactivate Travel instead', toolCall: { name: 'update_category', args: { category: travel.id, active: 'no' } } });
  });
});

describe('who can use it', () => {
  it('is for ORG_ADMIN on a plan with expenses', async () => {
    expect(await canUseModule(expenseModule, admin, plan('professional'))).toBe(true);
    expect(await canUseModule(expenseModule, employeeUser, plan('professional'))).toBe(false);
    expect(await canUseModule(expenseModule, admin, { ...plan('professional'), features: ['ai'] })).toBe(false);
    expect((await allowedTools(expenseModule, admin)).map((t) => t.name)).toEqual([
      'list_claims',
      'export_claims',
      'expense_summary',
      'list_categories',
      'create_category',
      'update_category',
      'delete_category',
    ]);
  });
});
