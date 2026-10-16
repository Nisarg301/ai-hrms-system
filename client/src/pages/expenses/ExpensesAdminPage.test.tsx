import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { adminAuth, CATEGORIES, claim, item, listView, recompute } from '../../test/expenseFixtures';
import type { ExpenseCategory, ExpenseClaimDetail, ExpenseSummary } from '../../types/expense';
import ExpensesAdminPage from './ExpensesAdminPage';

let claims: ExpenseClaimDetail[];
let categories: ExpenseCategory[];
let claimQueries: Record<string, string>[];
let summaryQueries: Record<string, string>[];
let exportQueries: Record<string, string>[];
let payments: unknown[];
let categoryWrites: { method: string; id?: string; body: unknown }[];
let downloads: string[];

const ok = (data: unknown, meta?: object, status = 200) => HttpResponse.json({ success: true, data, meta }, { status });
const fail = (status: number, message: string, details?: unknown) => HttpResponse.json({ success: false, error: { message, details } }, { status });
const find = (id: unknown) => claims.find((c) => c.id === id)!;
const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams);

const SUMMARY: ExpenseSummary = {
  from: '2026-10-01',
  to: '2026-10-05',
  approvedPaise: 350000,
  paidPaise: 100000,
  byCategory: [
    { categoryId: 'c1', name: 'Travel', totalPaise: 250000, count: 3 },
    { categoryId: 'c2', name: 'Food & meals', totalPaise: 100000, count: 1 },
  ],
  byDepartment: [{ departmentId: null, name: 'No department', totalPaise: 350000, count: 4 }],
  awaitingApproval: { count: 2, totalPaise: 45050 },
  awaitingPayment: { count: 1, totalPaise: 250000 },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
  Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  claimQueries = [];
  summaryQueries = [];
  exportQueries = [];
  payments = [];
  categoryWrites = [];
  categories = [...CATEGORIES, { id: 'c3', name: 'Internet & phone', limitPaise: null, receiptRequiredAbovePaise: 0, isActive: true }];
  claims = [
    claim('a1', { number: 'EXP-2026-0005', title: 'Pune visit', status: 'approved', submittedAt: '2026-10-01T05:00:00.000Z', items: [item('i1', { amountPaise: 100000 })] }),
    claim('a2', { number: 'EXP-2026-0006', title: 'Books', status: 'approved', employeeId: 'u2', employeeName: 'Raj Patel', submittedAt: '2026-10-02T05:00:00.000Z', items: [item('i2', { amountPaise: 50050 })] }),
    claim('s1', { number: 'EXP-2026-0007', title: 'Cab', status: 'submitted', submittedAt: '2026-10-03T05:00:00.000Z', items: [item('i3', { categoryId: 'c2', amountPaise: 120000 })] }),
    claim('p1', { number: 'EXP-2026-0001', title: 'Internet', status: 'paid', paidOn: '2026-09-15', paymentReference: 'UTR1', submittedAt: '2026-09-10T05:00:00.000Z', items: [item('i4')] }),
  ].map(recompute);

  server.use(
    http.get(`${API_BASE_URL}/people`, () => ok([])),
    http.get(`${API_BASE_URL}/expense-categories`, () => ok(categories)),
    http.post(`${API_BASE_URL}/expense-categories`, async ({ request }) => {
      const body = (await request.json()) as Omit<ExpenseCategory, 'id'>;
      categoryWrites.push({ method: 'post', body });
      if (categories.some((c) => c.name.toLowerCase() === body.name.toLowerCase())) {
        return fail(400, 'Validation failed', { fieldErrors: { name: ['There is already a category with this name'] } });
      }
      const created = { id: `c${categories.length + 1}`, ...body };
      categories.push(created);
      return ok(created, undefined, 201);
    }),
    http.put(`${API_BASE_URL}/expense-categories/:id`, async ({ params, request }) => {
      const body = await request.json();
      categoryWrites.push({ method: 'put', id: String(params.id), body });
      const c = categories.find((x) => x.id === params.id)!;
      Object.assign(c, body);
      return ok(c);
    }),
    http.delete(`${API_BASE_URL}/expense-categories/:id`, () => fail(400, 'This category is used by expenses. Deactivate it instead.')),
    http.get(`${API_BASE_URL}/expenses/pending-count`, () => ok({ count: claims.filter((c) => c.status === 'submitted').length })),
    http.get(`${API_BASE_URL}/expenses/summary`, ({ request }) => {
      summaryQueries.push(query(request));
      return ok(SUMMARY);
    }),
    http.get(`${API_BASE_URL}/expenses`, ({ request }) => {
      const q = query(request);
      claimQueries.push(q);
      const rows = claims.filter((c) => !q.status || c.status === q.status).map((c) => ({ ...listView(c), overLimitCount: c.items.filter((i) => i.overLimit).length }));
      return ok(rows, { page: 1, limit: 20, total: rows.length });
    }),
    http.post(`${API_BASE_URL}/expenses/pay`, async ({ request }) => {
      const body = (await request.json()) as { claimIds: string[]; paidOn: string; reference: string };
      payments.push(body);
      const paid = [];
      const skipped = [];
      for (const id of body.claimIds) {
        const c = find(id);
        if (c.status !== 'approved') {
          skipped.push({ id, number: c.number, reason: `It's ${c.status}, not approved` });
          continue;
        }
        Object.assign(c, { status: 'paid', paidOn: body.paidOn, paymentReference: body.reference });
        paid.push(listView(c));
      }
      return ok({ paid, skipped, totalPaidPaise: paid.reduce((sum, c) => sum + c.totalPaise, 0) });
    }),
    http.get(`${API_BASE_URL}/expenses/:id`, ({ params }) => ok(find(params.id))),
    http.get(`${API_BASE_URL}/exports/expenses`, ({ request }) => {
      exportQueries.push(query(request));
      return new HttpResponse('Claim,Title\n', {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="expenses-2026-10-01-to-2026-10-05.csv"' },
      });
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPage(url = '/expenses', plan: 'basic' | 'professional' = 'professional') {
  render(
    <Provider store={makeTestStore({ auth: adminAuth(plan) })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/expenses" element={<ExpensesAdminPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;
/**
 * The open modal. The review drawer is a dialog too, and in tests every generated id is the same,
 * so dialogs can't be told apart by their accessible name.
 */
const dialog = () => screen.getAllByRole('dialog').filter((d) => d.classList.contains('ant-modal')).at(-1)!;

describe('Expenses admin: claims', () => {
  it('pays ticked approved claims in bulk and reports one that was already paid', async () => {
    renderPage();
    await screen.findByText('Pune visit');
    expect(screen.getByRole('button', { name: /Mark as paid/ })).toBeDisabled();
    // Only approved claims can be ticked.
    expect(within(rowOf('Cab')).getByRole('checkbox')).toBeDisabled();
    expect(within(rowOf('Internet')).getByRole('checkbox')).toBeDisabled();

    await userEvent.click(within(rowOf('Pune visit')).getByRole('checkbox'));
    await userEvent.click(within(rowOf('Books')).getByRole('checkbox'));
    const payButton = screen.getByRole('button', { name: /Mark 2 as paid · ₹1,500.50/ });
    // Ticking (or clicking a disabled box) doesn't open the claim.
    await userEvent.click(within(rowOf('Cab')).getByRole('checkbox').closest('td')!);
    expect(document.querySelector('.ant-drawer-open')).toBeNull();

    // Meanwhile another admin pays Books.
    Object.assign(find('a2'), { status: 'paid', paidOn: '2026-10-04', paymentReference: 'UTR7' });

    await userEvent.click(payButton);
    expect(within(dialog()).getByText(/2 claims/)).toHaveTextContent('₹1,500.50');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Mark as paid' }));
    expect(within(dialog()).getByText('Enter the payment reference (e.g. the UTR)')).toBeInTheDocument();
    expect(payments).toEqual([]);

    await userEvent.click(within(dialog()).getByLabelText('Payment reference'));
    await userEvent.paste('UTR998');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Mark as paid' }));

    const result = await screen.findByTestId('pay-result');
    expect(payments).toEqual([{ claimIds: ['a1', 'a2'], paidOn: '2026-10-05', reference: 'UTR998' }]);
    expect(result).toHaveTextContent('Marked 1 claim as paid · ₹1,000.00.');
    expect(within(dialog()).getByText("EXP-2026-0006: It's paid, not approved")).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));

    // The list reloaded and the ticks are gone.
    await waitFor(() => expect(within(rowOf('Pune visit')).getByText('Paid')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Mark as paid/ })).toBeDisabled();
  });

  it('reviews a claim and pays it from the drawer, and filters by status', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Pune visit'));
    const drawer = await waitFor(() => document.querySelector('.ant-drawer-open') as HTMLElement);
    await within(drawer).findByText('EXP-2026-0005');
    expect(within(drawer).queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: /Mark as paid/ }));

    expect(within(dialog()).getByText(/EXP-2026-0005 · Ivy Mehta/)).toHaveTextContent('₹1,000.00');
    await userEvent.click(within(dialog()).getByLabelText('Payment reference'));
    await userEvent.paste('CHQ 1123');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Mark as paid' }));
    expect(await screen.findByTestId('pay-result')).toHaveTextContent('Marked 1 claim as paid · ₹1,000.00.');
    expect(payments).toEqual([{ claimIds: ['a1'], paidOn: '2026-10-05', reference: 'CHQ 1123' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull());

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByTitle('Awaiting approval'));
    await waitFor(() => expect(claimQueries.at(-1)).toMatchObject({ status: 'submitted', page: '1' }));
    await waitFor(() => expect(screen.queryByText('Pune visit')).not.toBeInTheDocument());
    expect(screen.getByText('Cab')).toBeInTheDocument();
  });

  it('exports CSV on Professional only', async () => {
    renderPage();
    await screen.findByText('Pune visit');
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(downloads).toEqual(['expenses-2026-10-01-to-2026-10-05.csv']));
    expect(exportQueries).toEqual([{}]);
  });

  it('has no export on Basic', async () => {
    renderPage('/expenses', 'basic');
    await screen.findByText('Pune visit');
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
  });
});

describe('Expenses admin: summary', () => {
  it('shows this month by default, with bars by category and department, and follows a preset', async () => {
    renderPage('/expenses?tab=summary');
    await waitFor(() => expect(screen.getByTestId('stat-approved')).toHaveTextContent('₹3,500.00'));
    expect(summaryQueries[0]).toEqual({ from: '2026-10-01', to: '2026-10-05' });
    expect(screen.getByTestId('stat-paid')).toHaveTextContent('₹1,000.00');
    expect(screen.getByTestId('stat-awaiting-approval')).toHaveTextContent('₹450.50');
    expect(screen.getByTestId('stat-awaiting-approval')).toHaveTextContent('2 claims, right now');
    expect(screen.getByTestId('stat-to-be-paid')).toHaveTextContent('1 claim, right now');

    const bars = within(screen.getByTestId('by-category')).getAllByTestId('spend-row');
    expect(bars[0]).toHaveTextContent('Travel₹2,500.00· 3 expenses');
    expect(bars[1]).toHaveTextContent('Food & meals₹1,000.00· 1 expense');
    expect(within(screen.getByTestId('by-department')).getByText('No department')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.click(await screen.findByText('Last month'));
    await waitFor(() => expect(summaryQueries.at(-1)).toEqual({ from: '2026-09-01', to: '2026-09-30' }));
  });
});

describe('Expenses admin: categories', () => {
  it('lists categories with their rules, and creates one (catching a duplicate name)', async () => {
    renderPage('/expenses?tab=categories');
    const travel = (await screen.findByText('Travel')).closest('tr') as HTMLElement;
    expect(travel).toHaveTextContent('No limit');
    expect(travel).toHaveTextContent('Above ₹500.00');
    expect(rowOf('Food & meals')).toHaveTextContent('₹1,000.00');
    expect(rowOf('Internet & phone')).toHaveTextContent('Always');

    await userEvent.click(screen.getByRole('button', { name: /New category/ }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(await within(dialog()).findByText('Name is required')).toBeInTheDocument();

    await userEvent.click(within(dialog()).getByLabelText('Name'));
    await userEvent.paste('travel');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(await within(dialog()).findByText('There is already a category with this name')).toBeInTheDocument();

    await userEvent.clear(within(dialog()).getByLabelText('Name'));
    await userEvent.paste('Client meals');
    await userEvent.click(within(dialog()).getByLabelText('Limit per expense'));
    await userEvent.paste('1500');
    await userEvent.clear(within(dialog()).getByLabelText('Receipt needed above'));
    await userEvent.paste('0');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('New category', { selector: '.ant-modal-title' })).not.toBeInTheDocument());
    expect(categoryWrites.at(-1)).toEqual({ method: 'post', body: { name: 'Client meals', limitPaise: 150000, receiptRequiredAbovePaise: 0, isActive: true } });
    expect(rowOf('Client meals')).toHaveTextContent('₹1,500.00');
    expect(rowOf('Client meals')).toHaveTextContent('Always');
  });

  it('switches a category off, and explains why a used one cannot be deleted', async () => {
    renderPage('/expenses?tab=categories');
    await screen.findByText('Travel');
    await userEvent.click(screen.getByLabelText('Travel active'));
    await waitFor(() => expect(within(rowOf('Travel')).getByText('Inactive')).toBeInTheDocument());
    expect(categoryWrites).toEqual([{ method: 'put', id: 'c1', body: { isActive: false } }]);

    await userEvent.click(screen.getByRole('button', { name: 'Delete Travel' }));
    const confirm = (await screen.findByText('Delete Travel?', { selector: '.ant-modal-confirm-title' })).closest('.ant-modal') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('This category is used by expenses. Deactivate it instead.')).toBeInTheDocument();
    expect(screen.getByText('Travel')).toBeInTheDocument();
  });
});
