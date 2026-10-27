import { confirmAction } from '../../src/ai/agent.service';
import { myExpenseModule } from '../../src/ai/modules/myExpense.module';
import { canUseModule } from '../../src/ai/registry';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';
import { SubscriptionState } from '../../src/services/subscription.service';
import * as dates from '../../src/utils/dates';
import { category, employeeUser, FakeMyExpenseApi, pdf, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();
const TODAY = '2026-10-22';
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue(TODAY);
});

const plan: SubscriptionState = { planType: 'professional', billingCycle: 'monthly', expiryDate: null, active: true, modules: [...PLAN_MODULES.professional], features: [...PLAN_FEATURES.professional] };
const run = (opts: TurnOptions) => turn({ module: myExpenseModule, user: employeeUser, ...opts });
const rows = (card: { rows: { label: string; value: string }[] }) => Object.fromEntries(card.rows.map((r) => [r.label, r.value]));
const confirm = (api: FakeMyExpenseApi, actionId: string, extra: { values?: unknown; file?: ReturnType<typeof pdf> } = {}) =>
  confirmAction({ user: employeeUser, token: 't', actionId, api, subscription: plan, ...extra });

function fakeApi() {
  const travel = category('Travel', 500000, 50000);
  const food = category('Food & meals', 200000, 50000);
  const internet = category('Internet & phone', null, 50000);
  return { api: new FakeMyExpenseApi([travel, food, internet, category('Other')]), travel, food, internet };
}

describe('create_claim (section 5.1)', () => {
  it('asks for the expense, takes the reply, asks for the receipt, and makes, attaches and submits on one Confirm', async () => {
    const { api, travel } = fakeApi();
    const first = await run({ api, message: 'Add a new claim, client visit to Pune', model: scriptedModel(toolCall('create_claim', { title: 'client visit to Pune' })) });
    expect(first.last.result!.text).toBe('For **client visit to Pune**, what did you spend? I need the **date**, **category**, **amount** and **merchant**. A note is optional.');

    // The model reads the reply; the server checks every value against it.
    const second = await run({
      api,
      conversationId: first.conversationId,
      message: 'Uber to the airport on 15 Oct, 850 rupees, travel',
      model: scriptedModel(toolCall('create_claim', { date: '15 Oct', category: 'travel', amount: '850', merchant: 'Uber', note: 'to the airport' })),
    });
    const card = second.last.action!.card;
    expect(rows(card)).toEqual({ Claim: 'client visit to Pune', Date: 'Thu 15 Oct 2026', Category: 'Travel', Amount: '₹850.00', Merchant: 'Uber', Note: 'to the airport' });
    expect(card.file).toEqual({ required: true, kind: 'receipt' });
    expect(card.notes).toEqual(['Travel needs a receipt above ₹500.00.', 'Confirm sends it to your admin for approval.']);
    expect(card.confirmLabel).toBe('Submit claim');

    // No receipt: refused before anything is made.
    await expect(confirm(api, second.last.action!.id)).rejects.toThrow('Choose a file first.');
    expect(api.writes()).toEqual([]);

    const done = await confirm(api, second.last.action!.id, { file: pdf('uber.pdf') });
    const claim = api.claims[0];
    expect(api.writes().map((c) => [c.path, c.file])).toEqual([
      ['/expenses', undefined],
      [`/expenses/${claim.id}/items`, undefined],
      [`/expenses/${claim.id}/items/${claim.items[0].id}/receipts`, 'uber.pdf'],
      [`/expenses/${claim.id}/submit`, undefined],
    ]);
    expect(api.writes()[1].body).toEqual({ date: '2026-10-15', categoryId: travel.id, amountPaise: 85000, merchant: 'Uber', note: 'to the airport' });
    expect(done.message.result!.text).toBe('✅ **Claim submitted:** client visit to Pune · EXP-2026-0012 · ₹850.00. Your admin has been notified.');
  });

  it('reads everything from one sentence, the category from the title, with the receipt optional below the limit', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'New claim for the September internet bill, ₹499 at Airtel on 5 Oct', model: scriptedModel(toolCall('create_claim', { title: 'September internet bill', amount: '499', merchant: 'Airtel', date: '5 Oct' })) });
    expect(rows(last.action!.card)).toMatchObject({ Claim: 'September internet bill', Date: 'Mon 5 Oct 2026', Category: 'Internet & phone', Amount: '₹499.00', Merchant: 'Airtel', Note: '—' });
    expect(last.action!.card.file).toEqual({ required: false, kind: 'receipt' });
    // No file chosen: the optional receipt is skipped.
    await confirm(api, last.action!.id);
    expect(api.writes().map((c) => c.path.replace(/\/[0-9a-f]{24}/g, '/:id'))).toEqual(['/expenses', '/expenses/:id/items', '/expenses/:id/submit']);
  });

  it('drops a merchant and an amount the user never said, and asks for them', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'New claim for the team lunch on 16 Oct, food', model: scriptedModel(toolCall('create_claim', { title: 'team lunch', amount: '1200', merchant: 'Haldiram', category: 'food' })) });
    expect(last.result!.text).toBe('For **team lunch**, I still need the **amount** and the **merchant**.');
  });

  it('keeps it a draft when asked, and warns over the limit', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'New claim for the Pune hotel: ₹6,000 at Taj on 14 Oct, travel, save it as a draft', model: scriptedModel(toolCall('create_claim', { title: 'Pune hotel' })) });
    expect(last.action!.card.confirmLabel).toBe('Save as draft');
    expect(last.action!.card.warnings).toEqual(['Over the ₹5,000.00 limit for Travel: allowed, but your admin sees it flagged.']);
    await confirm(api, last.action!.id, { file: pdf('taj.pdf') });
    expect(api.writes().some((c) => c.path.endsWith('/submit'))).toBe(false);
    expect(api.claims[0].status).toBe('draft');
  });

  it("refuses a date over 90 days back, asking for another", async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'New claim for the conference, ₹900 at Ola on 2 Jun, travel', model: scriptedModel(toolCall('create_claim', { title: 'conference' })) });
    expect(last.result!.text).toBe('Expenses can be claimed up to 90 days after they happen. Which date was it?');
  });

  it('closes the card with what was saved when the submit fails, so Confirm cannot make it twice', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'New claim for stationery, ₹300 at Staples on 20 Oct, other', model: scriptedModel(toolCall('create_claim', { title: 'stationery' })) });
    api.failOn = { path: /\/submit$/, message: 'Your organization has paused expense claims.' };
    const result = await confirm(api, last.action!.id);
    expect(result.action.status).toBe('confirmed');
    expect(result.message.result!.text).toBe("The claim **stationery** was saved as a draft, but it couldn't be submitted: Your organization has paused expense claims. Finish it on the Expenses tab, or ask me again.");
    await expect(confirm(api, last.action!.id)).rejects.toThrow();
    expect(api.claims).toHaveLength(1);
  });
});

describe('add_expense, add_receipt and submit_claim', () => {
  it('adds an expense to a draft, attaching the receipt to the new one even when it sorts first', async () => {
    const { api, travel, food } = fakeApi();
    const claim = api.claim('Client visit to Pune', [{ date: '2026-10-15', categoryId: travel.id, amountPaise: 30000, merchant: 'Ola', note: '' }]);
    const { last } = await run({
      api,
      message: "Add another expense to the Pune claim: lunch ₹620 at Haldiram's on 12 Oct, food",
      model: scriptedModel(toolCall('add_expense', { claim: 'Pune', amount: '620', merchant: "Haldiram's", date: '12 Oct', category: 'food' })),
    });
    expect(last.action!.card.title).toBe('Add to Client visit to Pune');
    expect(rows(last.action!.card)).toMatchObject({ Category: 'Food & meals', Amount: '₹620.00', Merchant: "Haldiram's" });
    await confirm(api, last.action!.id, { file: pdf('lunch.pdf') });
    const added = claim.items.find((i) => i.merchant === "Haldiram's")!;
    expect(added.receipts).toHaveLength(1);
    expect(claim.items.find((i) => i.merchant === 'Ola')!.receipts).toHaveLength(0);
    expect(api.writes().find((c) => c.path.endsWith('/items'))!.body).toMatchObject({ categoryId: food.id, amountPaise: 62000 });
  });

  it('refuses to submit with a receipt missing, offering to add it', async () => {
    const { api, travel } = fakeApi();
    const claim = api.claim('Client visit to Pune', [{ date: '2026-10-15', categoryId: travel.id, amountPaise: 85000, merchant: 'Uber', note: '' }]);
    const { last } = await run({ api, message: 'Submit my Pune claim', model: scriptedModel(toolCall('submit_claim', { claim: 'Pune' })) });
    expect(last.result!.text).toBe('Uber (Thu 15 Oct 2026) needs a receipt before the claim can be submitted.');
    const button = last.result!.buttons![0];
    expect(button).toEqual({ label: 'Add the receipt for Uber', toolCall: { name: 'add_receipt', args: { claim: claim.id, expense: claim.items[0].id } } });

    const receipt = await run({ api, toolCall: button.toolCall });
    await confirm(api, receipt.last.action!.id, { file: pdf('uber.pdf') });
    const submit = await run({ api, message: 'Submit my Pune claim', model: scriptedModel(toolCall('submit_claim', { claim: 'Pune' })) });
    expect(rows(submit.last.action!.card)).toEqual({ Expenses: '1', Total: '₹850.00' });
  });

  it('lists my claims', async () => {
    const { api, travel } = fakeApi();
    api.claim('Client visit to Pune', [{ date: '2026-10-15', categoryId: travel.id, amountPaise: 30000, merchant: 'Ola', note: '' }]);
    const { last } = await run({ api, toolCall: { name: 'list_my_claims', args: {} } });
    expect(last.result!.table!.rows).toEqual([{ title: 'Client visit to Pune', number: '—', items: '1', total: '₹300.00', status: 'Draft' }]);
  });
});

describe('without the model', () => {
  it('reads a whole new claim itself, and names the Leave tab for leave', async () => {
    const { api } = fakeApi();
    // No scripted replies: any model call fails the test.
    const claim = await run({ api, message: 'New claim for the September internet bill, ₹1,299 at Airtel on 5 Oct', model: scriptedModel() });
    expect(rows(claim.last.action!.card)).toMatchObject({ Claim: 'September internet bill', Category: 'Internet & phone', Amount: '₹1,299.00', Merchant: 'Airtel' });
    const leave = await run({ api, message: 'Apply leave tomorrow', model: scriptedModel() });
    expect(leave.last.result!.text).toBe('Leave is on the **Leave** tab: open it and ask there.');
  });

  it('asks what the claim is for when the model sends "New claim" as its title', async () => {
    const { api } = fakeApi();
    const { last } = await run({ api, message: 'New claim', model: scriptedModel(toolCall('create_claim', { title: 'New claim' })) });
    expect(last.result!.text).toBe('What is the claim for? For example, a trip or a bill.');
  });
});

describe('who can use it', () => {
  it('needs the expenses feature', async () => {
    expect(await canUseModule(myExpenseModule, employeeUser, plan)).toBe(true);
    expect(await canUseModule(myExpenseModule, employeeUser, { ...plan, features: ['ai'] })).toBe(false);
  });
});
