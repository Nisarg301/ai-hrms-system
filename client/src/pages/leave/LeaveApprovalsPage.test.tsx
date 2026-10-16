import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { attendanceBackground } from '../../test/attendanceFixtures';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { AdminLeaveRequestRow } from '../../types/leave';
import LeaveApprovalsPage from './LeaveApprovalsPage';

function row(id: string, employeeName: string, extra: Partial<AdminLeaveRequestRow> = {}): AdminLeaveRequestRow {
  return {
    id,
    employeeId: `emp-${id}`,
    employeeName,
    leaveTypeId: 't1',
    leaveTypeName: 'Paid Leave',
    leaveTypeCode: 'PL',
    isPaid: true,
    startDate: '2026-10-20',
    endDate: '2026-10-21',
    halfDay: null,
    days: 2,
    reason: 'Family wedding',
    status: 'pending',
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    recordedByName: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    canCancel: false,
    availableAfter: 8,
    ...extra,
  };
}

let db: {
  rows: AdminLeaveRequestRow[];
  queries: Record<string, string>[];
  decisions: { id: string; action: string; note: string }[];
  alreadyDecided: boolean;
  pendingCountCalls: number;
};

beforeEach(() => {
  db = {
    rows: [row('r1', 'Ivy Mehta'), row('r2', 'Raj Patel', { availableAfter: -1, reason: '' }), row('r3', 'Omar Old', { leaveTypeName: 'Unpaid Leave', availableAfter: null })],
    queries: [],
    decisions: [],
    alreadyDecided: false,
    pendingCountCalls: 0,
  };
  const ok = (data: unknown, meta?: object) => HttpResponse.json({ success: true, data, meta });
  server.use(
    ...attendanceBackground,
    http.get(`${API_BASE_URL}/people`, () => ok([])),
    http.get(`${API_BASE_URL}/leave/pending-count`, () => {
      db.pendingCountCalls += 1;
      return ok({ count: db.rows.filter((r) => r.status === 'pending').length });
    }),
    http.get(`${API_BASE_URL}/leave/requests`, ({ request }) => {
      const q = Object.fromEntries(new URL(request.url).searchParams);
      db.queries.push(q);
      const rows = q.status ? db.rows.filter((r) => r.status === q.status) : db.rows;
      return ok(rows, { page: 1, limit: 20, total: rows.length });
    }),
    http.post(`${API_BASE_URL}/leave/requests/:id/:action`, async ({ params, request }) => {
      const { note } = (await request.json()) as { note: string };
      if (db.alreadyDecided) {
        return HttpResponse.json({ success: false, error: { message: 'This request is already approved' } }, { status: 409 });
      }
      db.decisions.push({ id: params.id as string, action: params.action as string, note });
      const r = db.rows.find((x) => x.id === params.id)!;
      r.status = params.action === 'approve' ? 'approved' : 'rejected';
      r.decisionNote = note;
      return ok(r);
    })
  );
});

function renderPage() {
  render(
    <Provider store={makeTestStore()}>
      <MemoryRouter>
        <LeaveApprovalsPage />
      </MemoryRouter>
    </Provider>
  );
}

function rowOf(name: string) {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('LeaveApprovalsPage', () => {
  it('lists pending requests oldest first with the balance left after', async () => {
    renderPage();
    expect(await screen.findByText('Ivy Mehta')).toBeInTheDocument();
    expect(db.queries[0]).toMatchObject({ status: 'pending' });
    expect(within(rowOf('Ivy Mehta')).getByText('20 – 21 Oct 2026')).toBeInTheDocument();
    expect(within(rowOf('Ivy Mehta')).getByText('Family wedding')).toBeInTheDocument();
    expect(within(rowOf('Ivy Mehta')).getByText('8')).toBeInTheDocument();
    expect(within(rowOf('Raj Patel')).getByText('-1')).toBeInTheDocument();
    expect(within(rowOf('Omar Old')).getByText('Unlimited')).toBeInTheDocument();
  });

  it('approves with a note, removes the row and refreshes the badge count', async () => {
    renderPage();
    await screen.findByText('Ivy Mehta');
    const callsBefore = db.pendingCountCalls;
    await userEvent.click(within(rowOf('Ivy Mehta')).getByRole('button', { name: /approve/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Approve leave?')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/note to ivy mehta/i), 'Enjoy!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(db.decisions).toEqual([{ id: 'r1', action: 'approve', note: 'Enjoy!' }]));
    await waitFor(() => expect(screen.queryByText('Ivy Mehta')).not.toBeInTheDocument());
    await waitFor(() => expect(db.pendingCountCalls).toBeGreaterThan(callsBefore));
  });

  it('warns before approving more than the remaining balance, and rejects with a note', async () => {
    renderPage();
    await screen.findByText('Raj Patel');
    await userEvent.click(within(rowOf('Raj Patel')).getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/more than their remaining balance/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(rowOf('Raj Patel')).getByRole('button', { name: /reject/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Release week');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(db.decisions).toEqual([{ id: 'r2', action: 'reject', note: 'Release week' }]));
  });

  it('says when another admin already decided, and reloads the list', async () => {
    renderPage();
    await screen.findByText('Ivy Mehta');
    db.alreadyDecided = true;
    const queriesBefore = db.queries.length;
    await userEvent.click(within(rowOf('Ivy Mehta')).getByRole('button', { name: /approve/i }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This request is already approved')).toBeInTheDocument();
    await waitFor(() => expect(db.queries.length).toBeGreaterThan(queriesBefore));
  });

  it('shows everything on All requests, and filters by status', async () => {
    db.rows.push(row('r4', 'Neha New', { status: 'approved', decidedByName: 'Ann Admin', availableAfter: null }));
    renderPage();
    await screen.findByText('Ivy Mehta');
    await userEvent.click(screen.getByRole('tab', { name: 'All requests' }));
    expect(await screen.findByText('Neha New')).toBeInTheDocument();
    expect(db.queries.at(-1)?.status).toBeUndefined();
    expect(within(rowOf('Neha New')).getByText('Approved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByTitle('Approved'));
    await waitFor(() => expect(db.queries.at(-1)).toMatchObject({ status: 'approved' }));
    await waitFor(() => expect(screen.queryByText('Ivy Mehta')).not.toBeInTheDocument());
  });

  it('opens the Record leave form', async () => {
    renderPage();
    await screen.findByText('Ivy Mehta');
    await userEvent.click(screen.getByRole('button', { name: /record leave/i }));
    expect(await screen.findByText('Record leave for an employee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record & approve' })).toBeDisabled();
  });

  it('says so when nothing is waiting', async () => {
    db.rows = [];
    renderPage();
    expect(await screen.findByText('All caught up 🎉')).toBeInTheDocument();
  });
});
