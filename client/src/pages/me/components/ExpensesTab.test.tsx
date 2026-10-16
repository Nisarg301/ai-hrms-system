import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/setup';
import { API_BASE_URL } from '../../../services/api';
import { makeTestStore } from '../../../test/makeTestStore';
import { memberAuth } from '../../../test/fixtures';
import { uploadReceiptRequest } from '../../../services/endpoints/expenses.endpoints';
import { CATEGORIES, claim, item, recompute } from '../../../test/expenseFixtures';
import type { ExpenseClaimDetail, ExpenseItemPayload } from '../../../types/expense';
import MePage from '../MePage';

// jsdom's multipart bodies can't be read by MSW, so the upload itself is mocked (like the document tests do).
vi.mock('../../../services/endpoints/expenses.endpoints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/endpoints/expenses.endpoints')>()),
  uploadReceiptRequest: vi.fn(),
}));

let claims: ExpenseClaimDetail[];
let itemsPosted: ExpenseItemPayload[];
let uploads: string[];
let seq: number;

const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
const find = (id: unknown) => claims.find((c) => c.id === id)!;
const listView = () => claims.map(({ items: _items, ...c }) => c);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
  claims = [];
  itemsPosted = [];
  uploads = [];
  seq = 0;
  vi.mocked(uploadReceiptRequest).mockImplementation(async (claimId, itemId, file) => {
    uploads.push(file.name);
    const c = find(claimId);
    c.items.find((i) => i.id === itemId)!.receipts.push({ id: `f${++seq}`, originalName: file.name, mimeType: file.type, size: file.size });
    // A copy, like a real response: the store freezes what it is given.
    return { data: structuredClone(recompute(c)) } as Awaited<ReturnType<typeof uploadReceiptRequest>>;
  });
  server.use(
    http.get(`${API_BASE_URL}/expense-categories`, () => ok(CATEGORIES)),
    http.get(`${API_BASE_URL}/expenses/mine`, () => ok(listView())),
    http.post(`${API_BASE_URL}/expenses`, async ({ request }) => {
      const { title } = (await request.json()) as { title: string };
      const created = claim(`n${++seq}`, { title, createdAt: '2026-10-05T04:30:00.000Z' });
      claims.unshift(created);
      return ok(created, 201);
    }),
    http.get(`${API_BASE_URL}/expenses/:id`, ({ params }) => ok(find(params.id))),
    http.put(`${API_BASE_URL}/expenses/:id`, async ({ params, request }) => {
      Object.assign(find(params.id), await request.json());
      return ok(find(params.id));
    }),
    http.delete(`${API_BASE_URL}/expenses/:id`, ({ params }) => {
      claims = claims.filter((c) => c.id !== params.id);
      return ok({ id: params.id, deleted: true });
    }),
    http.post(`${API_BASE_URL}/expenses/:id/items`, async ({ params, request }) => {
      const payload = (await request.json()) as ExpenseItemPayload;
      itemsPosted.push(payload);
      find(params.id).items.push(item(`i${++seq}`, payload));
      return ok(recompute(find(params.id)), 201);
    }),
    http.put(`${API_BASE_URL}/expenses/:id/items/:itemId`, async ({ params, request }) => {
      const c = find(params.id);
      Object.assign(c.items.find((i) => i.id === params.itemId)!, await request.json());
      return ok(recompute(c));
    }),
    http.delete(`${API_BASE_URL}/expenses/:id/items/:itemId`, ({ params }) => {
      const c = find(params.id);
      c.items = c.items.filter((i) => i.id !== params.itemId);
      return ok(recompute(c));
    }),
    http.get(`${API_BASE_URL}/expenses/:id/items/:itemId/receipts/:fileId`, () => new HttpResponse(new Blob(['%PDF-1.4'], { type: 'application/pdf' }))),
    http.delete(`${API_BASE_URL}/expenses/:id/items/:itemId/receipts/:fileId`, ({ params }) => {
      const c = find(params.id);
      const it = c.items.find((i) => i.id === params.itemId)!;
      it.receipts = it.receipts.filter((r) => r.id !== params.fileId);
      return ok(recompute(c));
    }),
    http.post(`${API_BASE_URL}/expenses/:id/submit`, ({ params }) => {
      const c = find(params.id);
      const missing = c.items.filter((i) => i.missingReceipt);
      if (missing.length) {
        const problems = missing.map((i) => ({ itemId: i.id, merchant: i.merchant, message: `${i.merchant} (${i.date}) needs a receipt` }));
        const message = `${problems.length} expense${problems.length === 1 ? ' needs' : 's need'} attention: ${problems.map((p) => p.message).join(', ')}`;
        return HttpResponse.json({ success: false, error: { message, details: { problems } } }, { status: 400 });
      }
      Object.assign(c, { status: 'submitted', number: c.number ?? 'EXP-2026-0001', submittedAt: '2026-10-05T04:31:00.000Z' });
      return ok(c);
    }),
    http.post(`${API_BASE_URL}/expenses/:id/withdraw`, ({ params }) => {
      Object.assign(find(params.id), { status: 'draft', submittedAt: null });
      return ok(find(params.id));
    }),
    http.post(`${API_BASE_URL}/expenses/:id/copy`, ({ params }) => {
      const source = find(params.id);
      const copy = recompute(
        claim(`n${++seq}`, {
          title: source.title,
          items: source.items.map((i) => ({ ...i, id: `${i.id}-copy`, receipts: i.receipts.map((r) => ({ ...r, id: `${r.id}-copy` })) })),
        })
      );
      claims.unshift(copy);
      return ok(copy, 201);
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderTab(url = '/me/expenses') {
  render(
    <Provider store={makeTestStore({ auth: memberAuth('basic') })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/me/:tab"
            element={
              <>
                <MePage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

const drawer = () => document.querySelector('.ant-drawer-open') as HTMLElement;
const rows = () => within(drawer()).queryAllByTestId('expense-item');

async function addExpense({ date, category, rupees, merchant }: { date: string; category: string; rupees: string; merchant: string }) {
  await userEvent.click(within(drawer()).getByRole('button', { name: /Add expense/ }));
  const form = within(drawer()).getByTestId('expense-item-form');
  await pasteInto(within(form).getByLabelText('Date'), date);
  await userEvent.keyboard('{Enter}');
  await userEvent.click(within(form).getByLabelText('Category'));
  await userEvent.click(await screen.findByText(category));
  await pasteInto(within(form).getByLabelText('Amount'), rupees);
  await pasteInto(within(form).getByLabelText('Merchant'), merchant);
}

/** Faster than typing: antd re-renders on every keystroke. */
async function pasteInto(input: HTMLElement, text: string) {
  await userEvent.click(input);
  await userEvent.paste(text);
}

/** Clicks the confirm dialog's OK button (the drawer's own button has the same words, so take the dialog's). */
async function confirm(okText: string) {
  const dialog = (await screen.findByText((_, el) => el?.classList.contains('ant-modal-confirm-body-wrapper') ?? false)) as HTMLElement;
  await userEvent.click(within(dialog).getByRole('button', { name: okText }));
}

describe('Me → Expenses', () => {
  it('starts a claim and adds an expense, with the over-limit and receipt hints', async () => {
    renderTab();
    expect(await screen.findByText('No claims yet')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /New claim/ }));
    await pasteInto(await screen.findByLabelText('What is it for?'), 'Client visit to Pune');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(drawer()).toBeTruthy());
    expect(within(drawer()).getByText('Client visit to Pune')).toBeInTheDocument();
    expect(within(drawer()).getByText('Draft')).toBeInTheDocument();
    expect(within(drawer()).getByRole('button', { name: /Submit/ })).toBeDisabled();

    // Over the ₹1,000 food limit and above the ₹500 receipt threshold: both hints show before saving.
    await addExpense({ date: '2026-10-01', category: 'Food & meals · limit ₹1,000.00', rupees: '1200.75', merchant: 'Taj' });
    const form = within(drawer()).getByTestId('expense-item-form');
    expect(within(form).getByText(/Over the ₹1,000.00 limit for Food & meals/)).toBeInTheDocument();
    expect(within(form).getByText('This amount needs a receipt. Add it after saving.')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Add expense' }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    // Rupees are sent as whole paise.
    expect(itemsPosted).toEqual([{ date: '2026-10-01', categoryId: 'c2', amountPaise: 120075, merchant: 'Taj', note: '' }]);
    const row = rows()[0];
    expect(within(row).getByText('₹1,200.75')).toBeInTheDocument();
    expect(within(row).getByText('Over limit')).toBeInTheDocument();
    expect(within(row).getByText('Receipt required')).toBeInTheDocument();
    expect(within(drawer()).getByTestId('claim-total')).toHaveTextContent('₹1,200.75');
    expect(within(drawer()).getByRole('button', { name: /Submit/ })).toBeEnabled();

    // The list behind the drawer has the new draft.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Client visit to Pune')).toBeInTheDocument();
    expect(within(table).getByText('Not submitted yet')).toBeInTheDocument();
  });

  it('adds a receipt, which clears the warning, and submits', async () => {
    claims = [
      claim('d1', {
        title: 'Client visit to Pune',
        items: [item('i1', { merchant: 'Taj', categoryId: 'c2', amountPaise: 120000 }), item('i2', { merchant: 'Uber', amountPaise: 35050 })],
      }),
    ].map(recompute);
    renderTab();
    await userEvent.click(await screen.findByText('Client visit to Pune'));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(drawer()).getByTestId('claim-total')).toHaveTextContent('₹1,550.50');
    expect(within(rows()[0]).getByText('Receipt required')).toBeInTheDocument();

    const file = new File(['%PDF-1.4'], 'taj-bill.pdf', { type: 'application/pdf' });
    await userEvent.upload(rows()[0].querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(await within(rows()[0]).findByText('taj-bill.pdf')).toBeInTheDocument();
    expect(uploads).toEqual(['taj-bill.pdf']);
    expect(within(rows()[0]).queryByText('Receipt required')).not.toBeInTheDocument();

    await userEvent.click(within(drawer()).getByRole('button', { name: /Submit/ }));
    expect(await screen.findByText('Submitted as EXP-2026-0001. Your admin has been notified.')).toBeInTheDocument();
    expect(within(drawer()).getByText('EXP-2026-0001')).toBeInTheDocument();
    expect(within(drawer()).getByText('Awaiting approval')).toBeInTheDocument();
    expect(within(drawer()).getByText(/^Submitted 5 Oct 2026/)).toBeInTheDocument();
    expect(within(drawer()).queryByRole('button', { name: /Add expense/ })).not.toBeInTheDocument();
    expect(within(drawer()).queryByRole('button', { name: 'Add receipt for Taj' })).not.toBeInTheDocument();
    expect(within(drawer()).getByRole('button', { name: /Withdraw/ })).toBeInTheDocument();

    // The list behind the drawer caught up.
    const table = screen.getByRole('table');
    expect(within(table).getByText('EXP-2026-0001')).toBeInTheDocument();
    expect(within(table).getByText('Awaiting approval')).toBeInTheDocument();
  });

  it("shows the server's reasons when a submit is refused and marks the expense", async () => {
    claims = [
      claim('d1', {
        title: 'Conference',
        items: [item('i1', { merchant: 'Uber', amountPaise: 60000 }), item('i2', { merchant: 'Metro', amountPaise: 4000 })],
      }),
    ].map(recompute);
    renderTab();
    await userEvent.click(await screen.findByText('Conference'));
    await waitFor(() => expect(rows()).toHaveLength(2));

    await userEvent.click(within(drawer()).getByRole('button', { name: /Submit/ }));
    expect(await within(drawer()).findByText('1 expense needs attention: Uber (2026-10-01) needs a receipt')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('Uber (2026-10-01) needs a receipt')).toBeInTheDocument();
    expect(within(rows()[1]).queryByText(/needs a receipt/)).not.toBeInTheDocument();
    expect(within(drawer()).getByText('Draft')).toBeInTheDocument();

    // A change the server refuses says why.
    server.use(
      http.delete(`${API_BASE_URL}/expenses/:id/items/:itemId`, () =>
        HttpResponse.json({ success: false, error: { message: 'Only a draft can be changed' } }, { status: 409 })
      )
    );
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Remove Metro' }));
    expect(await screen.findByText('Only a draft can be changed')).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it('edits and removes expenses, opens a receipt, and deletes the draft', async () => {
    Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:receipt'), revokeObjectURL: vi.fn() });
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
    claims = [
      claim('d1', {
        title: 'Offsite',
        items: [
          item('i1', { merchant: 'Cab', amountPaise: 20000, receipts: [{ id: 'f1', originalName: 'cab.png', mimeType: 'image/png', size: 10 }] }),
          item('i2', { merchant: 'Snacks', categoryId: 'c2', amountPaise: 30000 }),
        ],
      }),
    ].map(recompute);
    renderTab();
    await userEvent.click(await screen.findByText('Offsite'));
    await waitFor(() => expect(rows()).toHaveLength(2));

    await userEvent.click(within(rows()[0]).getByRole('button', { name: 'cab.png' }));
    // The tab opens with the click, then gets the file.
    expect(open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab.location.href).toBe('blob:receipt'));
    expect(tab.opener).toBeNull();

    await userEvent.click(within(rows()[0]).getByLabelText('Remove cab.png'));
    await waitFor(() => expect(within(rows()[0]).queryByText('cab.png')).not.toBeInTheDocument());

    await userEvent.click(within(drawer()).getByRole('button', { name: 'Edit Cab' }));
    const form = within(drawer()).getByTestId('expense-item-form');
    expect(within(form).getByLabelText('Merchant')).toHaveValue('Cab');
    await userEvent.clear(within(form).getByLabelText('Amount'));
    await pasteInto(within(form).getByLabelText('Amount'), '250');
    await userEvent.click(within(form).getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(within(drawer()).getByTestId('claim-total')).toHaveTextContent('₹550.00'));

    await userEvent.click(within(drawer()).getByRole('button', { name: 'Remove Snacks' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(drawer()).getByTestId('claim-total')).toHaveTextContent('₹250.00');

    await userEvent.click(within(drawer()).getByRole('button', { name: /Delete draft/ }));
    await confirm('Delete');
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull());
    expect(await screen.findByText('No claims yet')).toBeInTheDocument();
    open.mockRestore();
  });

  it('shows the summary, withdraws a submitted claim and copies a rejected one', async () => {
    claims = [
      claim('d1', { title: 'Half done' }),
      claim('s1', { title: 'Pune trip', status: 'submitted', number: 'EXP-2026-0007', submittedAt: '2026-10-02T05:00:00.000Z', items: [item('i1', { amountPaise: 150000, receipts: [{ id: 'f1', originalName: 'train.pdf', mimeType: 'application/pdf', size: 10 }] })] }),
      claim('a1', { title: 'Laptop bag', status: 'approved', number: 'EXP-2026-0005', submittedAt: '2026-09-20T05:00:00.000Z', decidedAt: '2026-09-21T05:00:00.000Z', decidedByName: 'Ann Admin', items: [item('i2', { amountPaise: 250000 })] }),
      claim('r1', {
        title: 'Hotel',
        status: 'rejected',
        number: 'EXP-2026-0004',
        submittedAt: '2026-09-10T05:00:00.000Z',
        decidedAt: '2026-09-11T05:00:00.000Z',
        decidedByName: 'Ann Admin',
        decisionNote: 'Add the hotel bill',
        items: [item('i3', { merchant: 'Hotel Blue', amountPaise: 40000 })],
      }),
      claim('p1', { title: 'Sept internet', status: 'paid', number: 'EXP-2026-0002', paidOn: '2026-09-15', paymentReference: 'UTR123', items: [item('i4', { amountPaise: 100000 })] }),
      claim('p0', { title: 'Old claim', status: 'paid', number: 'EXP-2025-0009', paidOn: '2025-12-20', paymentReference: 'UTR9', items: [item('i5', { amountPaise: 500000 })] }),
    ].map(recompute);
    renderTab();
    await screen.findByText('Pune trip');

    expect(screen.getByTestId('chip-Drafts')).toHaveTextContent('1');
    expect(screen.getByTestId('chip-Awaiting approval')).toHaveTextContent('₹1,500.00');
    expect(screen.getByTestId('chip-Awaiting approval')).toHaveTextContent('1 claim');
    expect(screen.getByTestId('chip-To be paid')).toHaveTextContent('₹2,500.00');
    // Last year's payment doesn't count.
    expect(screen.getByTestId('chip-Paid in 2026')).toHaveTextContent('₹1,000.00');

    // A rejected claim shows who and why, and copies into a fresh draft.
    await userEvent.click(screen.getByText('Hotel'));
    await waitFor(() => expect(within(drawer()).getByText('EXP-2026-0004')).toBeInTheDocument());
    expect(within(drawer()).getByText(/Rejected by Ann Admin/)).toBeInTheDocument();
    expect(within(drawer()).getByText('“Add the hotel bill”')).toBeInTheDocument();
    expect(within(drawer()).queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
    await userEvent.click(within(drawer()).getByRole('button', { name: /Copy to new claim/ }));
    await waitFor(() => expect(within(drawer()).getByText('New claim')).toBeInTheDocument());
    expect(within(drawer()).getByText('Draft')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('Hotel Blue')).toBeInTheDocument();
    expect(within(drawer()).getByRole('button', { name: /Add expense/ })).toBeInTheDocument();
    expect(screen.getByTestId('chip-Drafts')).toHaveTextContent('2');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Close' }));

    // A submitted claim goes back to a draft, keeping its number.
    await userEvent.click(screen.getByText('Pune trip'));
    await waitFor(() => expect(within(drawer()).getByText('EXP-2026-0007')).toBeInTheDocument());
    await userEvent.click(within(drawer()).getByRole('button', { name: /Withdraw/ }));
    await confirm('Withdraw');
    await waitFor(() => expect(within(drawer()).getByText('Draft')).toBeInTheDocument());
    expect(within(drawer()).getByText('EXP-2026-0007')).toBeInTheDocument();
    expect(within(drawer()).getByRole('button', { name: /Submit/ })).toBeEnabled();
    expect(screen.getByTestId('chip-Awaiting approval')).toHaveTextContent('₹0.00');
  });

  it('opens New claim straight away from /me/expenses?new=1 and tidies the URL', async () => {
    renderTab('/me/expenses?new=1');
    expect(await screen.findByLabelText('What is it for?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/me\/expenses$/));
    // An empty title isn't accepted.
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Give the claim a title')).toBeInTheDocument();
    expect(claims).toHaveLength(0);
  });
});
