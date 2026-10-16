import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { AttendanceRequestRow } from '../../types/attendance';
import LeaveApprovalsPage from './LeaveApprovalsPage';

function row(id: string, extra: Partial<AttendanceRequestRow> = {}): AttendanceRequestRow {
  return {
    id,
    employeeId: `e-${id}`,
    employeeName: 'Ivy Mehta',
    kind: 'regularization',
    startDate: '2026-10-02',
    endDate: '2026-10-02',
    clockIn: '09:30',
    clockOut: '18:30',
    reason: 'Forgot to clock out',
    status: 'pending',
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    recordedByName: null,
    createdAt: '2026-10-03T10:00:00.000Z',
    canCancel: false,
    ...extra,
  };
}

let db: { rows: AttendanceRequestRow[]; queries: Record<string, string>[]; decisions: unknown[]; stale: boolean };

beforeEach(() => {
  db = { rows: [row('f1'), row('w1', { kind: 'wfh', employeeName: 'Raj Patel', startDate: '2026-10-07', endDate: '2026-10-08', clockIn: null, clockOut: null, reason: 'Plumber' })], queries: [], decisions: [], stale: false };
  const ok = (data: unknown, meta?: object) => HttpResponse.json({ success: true, data, meta });
  server.use(
    http.get(`${API_BASE_URL}/people`, () => ok([])),
    http.get(`${API_BASE_URL}/leave/pending-count`, () => ok({ count: 2 })),
    http.get(`${API_BASE_URL}/expenses/pending-count`, () => ok({ count: 0 })),
    http.get(`${API_BASE_URL}/leave/requests`, () => ok([], { page: 1, limit: 20, total: 0 })),
    http.get(`${API_BASE_URL}/attendance/pending-count`, () => {
      const pending = db.rows.filter((r) => r.status === 'pending');
      const fixes = pending.filter((r) => r.kind === 'regularization').length;
      return ok({ regularization: fixes, wfh: pending.length - fixes, total: pending.length });
    }),
    http.get(`${API_BASE_URL}/attendance/requests`, ({ request }) => {
      const q = Object.fromEntries(new URL(request.url).searchParams);
      db.queries.push(q);
      const rows = db.rows.filter((r) => r.kind === q.kind && (!q.status || r.status === q.status));
      return ok(rows, { page: 1, limit: 20, total: rows.length });
    }),
    http.post(`${API_BASE_URL}/attendance/requests/:id/:action`, async ({ params, request }) => {
      if (db.stale) return HttpResponse.json({ success: false, error: { message: 'This request is already approved' } }, { status: 409 });
      const { note } = (await request.json()) as { note: string };
      db.decisions.push({ id: params.id, action: params.action, note });
      const r = db.rows.find((x) => x.id === params.id)!;
      Object.assign(r, { status: params.action === 'approve' ? 'approved' : 'rejected', decisionNote: note, decidedByName: 'Ann Admin' });
      return ok(r);
    })
  );
});

function renderPage(url = '/leave/approvals') {
  render(
    <Provider store={makeTestStore()}>
      <MemoryRouter initialEntries={[url]}>
        <LeaveApprovalsPage />
      </MemoryRouter>
    </Provider>
  );
}

describe('Approvals: attendance tabs', () => {
  it('shows a count on each tab', async () => {
    renderPage();
    const fixesTab = await screen.findByRole('tab', { name: /attendance fixes/i });
    await waitFor(() => expect(fixesTab).toHaveTextContent('1'));
    expect(screen.getByRole('tab', { name: /work from home/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /^leave/i })).toHaveTextContent('2');
  });

  it('approves a fix with a note, and drops it from Pending', async () => {
    renderPage('/leave/approvals?tab=fixes');
    expect(await screen.findByText('09:30–18:30')).toBeInTheDocument();
    expect(db.queries[0]).toMatchObject({ kind: 'regularization', status: 'pending' });

    await userEvent.click(screen.getByRole('button', { name: 'Approve Ivy Mehta' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("Approving replaces that day's punches with these times.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/note to ivy mehta/i), 'Done');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(db.decisions).toEqual([{ id: 'f1', action: 'approve', note: 'Done' }]));
    expect(await screen.findByText('All caught up 🎉')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('tab', { name: /attendance fixes/i })).not.toHaveTextContent('1'));

    await userEvent.click(screen.getByText('All'));
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  it('rejects WFH, and says when someone else decided first', async () => {
    renderPage('/leave/approvals?tab=wfh');
    expect(await screen.findByText('Raj Patel')).toBeInTheDocument();
    db.stale = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reject Raj Patel' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('This request is already approved')).toBeInTheDocument();
  });

  it("opens the Fix someone's attendance form from the fixes tab", async () => {
    renderPage('/leave/approvals?tab=fixes');
    await userEvent.click(await screen.findByRole('button', { name: /fix someone's attendance/i }));
    expect(await screen.findByText("Fix someone's attendance", { selector: '.ant-drawer-title' })).toBeInTheDocument();
  });
});
