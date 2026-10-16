import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { adminAuth, claim, item, listView, recompute } from '../../test/expenseFixtures';
import type { ExpenseClaimDetail } from '../../types/expense';
import LeaveApprovalsPage from './LeaveApprovalsPage';

let claims: ExpenseClaimDetail[];
let decisions: { id: string; action: string; note: string }[];
/** Another admin decides first: the next decision finds the claim already approved. */
let stale: boolean;

const ok = (data: unknown, meta?: object) => HttpResponse.json({ success: true, data, meta });
const find = (id: unknown) => claims.find((c) => c.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
  Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:receipt'), revokeObjectURL: vi.fn() });
  decisions = [];
  stale = false;
  claims = [
    claim('s1', {
      number: 'EXP-2026-0001',
      title: 'Pune visit',
      status: 'submitted',
      submittedAt: '2026-09-28T05:00:00.000Z',
      items: [
        item('i1', { merchant: 'Taj', categoryId: 'c2', amountPaise: 150000, receipts: [{ id: 'f1', originalName: 'taj.png', mimeType: 'image/png', size: 10 }] }),
        item('i2', { merchant: 'Uber', amountPaise: 60000, receipts: [{ id: 'f2', originalName: 'uber.pdf', mimeType: 'application/pdf', size: 10 }] }),
      ],
    }),
    claim('s2', { number: 'EXP-2026-0002', title: 'Books', status: 'submitted', employeeId: 'u2', employeeName: 'Raj Patel', submittedAt: '2026-10-01T05:00:00.000Z', items: [item('i3', { merchant: 'Amazon', amountPaise: 20000 })] }),
    claim('a1', { number: 'EXP-2026-0000', title: 'Old', status: 'approved', submittedAt: '2026-09-01T05:00:00.000Z', items: [item('i4')] }),
  ].map(recompute);

  server.use(
    http.get(`${API_BASE_URL}/people`, () => ok([])),
    http.get(`${API_BASE_URL}/leave/pending-count`, () => ok({ count: 0 })),
    http.get(`${API_BASE_URL}/leave/requests`, () => ok([], { page: 1, limit: 20, total: 0 })),
    http.get(`${API_BASE_URL}/attendance/pending-count`, () => ok({ regularization: 0, wfh: 0, total: 0 })),
    http.get(`${API_BASE_URL}/expenses/pending-count`, () => ok({ count: claims.filter((c) => c.status === 'submitted').length })),
    http.get(`${API_BASE_URL}/expenses`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      const rows = claims.filter((c) => c.status === status).map((c) => ({ ...listView(c), overLimitCount: c.items.filter((i) => i.overLimit).length }));
      return ok(rows, { page: 1, limit: 20, total: rows.length });
    }),
    http.get(`${API_BASE_URL}/expenses/:id/items/:itemId/receipts/:fileId`, () => new HttpResponse(new Blob(['png'], { type: 'image/png' }))),
    http.get(`${API_BASE_URL}/expenses/:id`, ({ params }) => ok(find(params.id))),
    http.post(`${API_BASE_URL}/expenses/:id/:action`, async ({ params, request }) => {
      const c = find(params.id);
      if (stale) {
        Object.assign(c, { status: 'approved', decidedByName: 'Other Admin', decidedAt: '2026-10-05T04:00:00.000Z' });
        return HttpResponse.json({ success: false, error: { message: 'This claim is already approved' } }, { status: 409 });
      }
      const { note } = (await request.json()) as { note: string };
      decisions.push({ id: String(params.id), action: String(params.action), note });
      Object.assign(c, {
        status: params.action === 'approve' ? 'approved' : 'rejected',
        decidedByName: 'Ann Admin',
        decidedAt: '2026-10-05T04:30:00.000Z',
        decisionNote: note,
      });
      return ok(c);
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function renderPage() {
  render(
    <Provider store={makeTestStore({ auth: adminAuth() })}>
      <MemoryRouter initialEntries={['/leave/approvals?tab=expenses']}>
        <Routes>
          <Route path="/leave/approvals" element={<LeaveApprovalsPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

const drawer = () => document.querySelector('.ant-drawer-open') as HTMLElement;
const tableRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

async function openClaim(number: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Review ${number}` }));
  await waitFor(() => expect(drawer()).toBeTruthy());
  await within(drawer()).findByText(number);
}

describe('Approvals → Expenses', () => {
  it('lists waiting claims oldest first, shows the receipts, and approves one', async () => {
    renderPage();
    await screen.findByText('Pune visit');
    expect(screen.getByRole('tab', { name: /Expenses/ })).toHaveTextContent('2');
    const rows = tableRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ivy Mehta');
    expect(rows[0]).toHaveTextContent('1 over limit');
    expect(rows[0]).toHaveTextContent('₹2,100.00');
    expect(rows[1]).toHaveTextContent('Raj Patel');

    await openClaim('EXP-2026-0001');
    expect(within(drawer()).getByText('1 expense is over the category limit. You can still approve.')).toBeInTheDocument();
    // An image receipt shows inline; a PDF is a link.
    expect(await within(drawer()).findByAltText('taj.png')).toHaveAttribute('src', 'blob:receipt');
    expect(within(drawer()).getByRole('button', { name: 'uber.pdf' })).toBeInTheDocument();

    await userEvent.click(within(drawer()).getByLabelText('Note to Ivy Mehta (required to reject)'));
    await userEvent.paste('Thanks for the receipts');
    await userEvent.click(within(drawer()).getByRole('button', { name: /Approve/ }));

    expect(await screen.findByText('Approved EXP-2026-0001 for Ivy Mehta')).toBeInTheDocument();
    expect(decisions).toEqual([{ id: 's1', action: 'approve', note: 'Thanks for the receipts' }]);
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull());
    await waitFor(() => expect(tableRows()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Expenses/ })).toHaveTextContent('1'));
  });

  it('needs a note to reject, then rejects', async () => {
    renderPage();
    await openClaim('EXP-2026-0002');
    await userEvent.click(within(drawer()).getByRole('button', { name: /Reject/ }));
    expect(within(drawer()).getByText('Say why, so they can fix it')).toBeInTheDocument();
    expect(decisions).toEqual([]);

    await userEvent.click(within(drawer()).getByLabelText('Note to Raj Patel (required to reject)'));
    await userEvent.paste('Books need a manager’s OK first');
    expect(within(drawer()).queryByText('Say why, so they can fix it')).not.toBeInTheDocument();
    await userEvent.click(within(drawer()).getByRole('button', { name: /Reject/ }));
    expect(await screen.findByText('Rejected EXP-2026-0002 for Raj Patel')).toBeInTheDocument();
    expect(decisions).toEqual([{ id: 's2', action: 'reject', note: 'Books need a manager’s OK first' }]);
  });

  it('says so when someone else decided first, and shows where the claim stands', async () => {
    stale = true;
    renderPage();
    await openClaim('EXP-2026-0001');
    await userEvent.click(within(drawer()).getByRole('button', { name: /Approve/ }));

    expect(await screen.findByText('This claim is already approved')).toBeInTheDocument();
    await waitFor(() => expect(within(drawer()).getByText('Approved – to be paid')).toBeInTheDocument());
    expect(within(drawer()).getByText(/Approved by Other Admin/)).toBeInTheDocument();
    expect(within(drawer()).queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    await waitFor(() => expect(tableRows()).toHaveLength(1));
  });
});
