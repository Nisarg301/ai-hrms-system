import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription } from '../../test/fixtures';
import { dayView } from '../../test/attendanceFixtures';
import type { AuthState } from '../../store/auth/authSlice';
import type { Person } from '../../types/people';
import TeamAttendancePage from './TeamAttendancePage';

function person(id: string, name: string, departmentName: string | null = 'Engineering'): Person {
  return { id, name, jobTitle: null, departmentName, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01' };
}

let queries: { path: string; q: Record<string, string> }[];
let downloads: string[];

beforeEach(() => {
  queries = [];
  downloads = [];
  Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  const ok = (data: unknown) => HttpResponse.json({ success: true, data, meta: { page: 1, limit: 999999, total: 2 } });
  server.use(
    http.get(`${API_BASE_URL}/departments`, () => ok([{ id: 'd1', title: 'Engineering', description: '', status: 'active' }, { id: 'd2', title: 'Operations', description: '', status: 'active' }])),
    http.get(`${API_BASE_URL}/attendance/team`, ({ request }) => {
      queries.push({ path: 'day', q: Object.fromEntries(new URL(request.url).searchParams) });
      return ok({
        date: '2026-10-05',
        rows: [
          { person: person('e1', 'Ivy Mehta'), day: dayView('2026-10-05', { status: 'in_progress', late: true, firstIn: '2026-10-05T04:20:00.000Z', workedMinutes: 100 }) },
          { person: person('e2', 'Raj Patel'), day: dayView('2026-10-05', { status: 'on_leave', leave: { halfDay: null, typeName: 'Paid Leave' } }) },
          { person: person('e3', 'Zoe', 'Operations'), day: dayView('2026-10-05', { status: 'not_in_yet', wfh: true }) },
        ],
        counts: { in_progress: 1, on_leave: 1, not_in_yet: 1 },
        late: 1,
        wfh: 1,
      });
    }),
    http.get(`${API_BASE_URL}/attendance/team/month`, ({ request }) => {
      queries.push({ path: 'month', q: Object.fromEntries(new URL(request.url).searchParams) });
      const dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
      return ok({
        month: '2026-10',
        dates,
        rows: [
          {
            person: person('e1', 'Ivy Mehta'),
            days: [
              { date: '2026-10-01', status: 'present', late: true, wfh: false, workedMinutes: 500 },
              { date: '2026-10-02', status: 'absent', late: false, wfh: false, workedMinutes: 0 },
              { date: '2026-10-03', status: 'weekend', late: false, wfh: false, workedMinutes: 0 },
            ],
          },
        ],
      });
    }),
    http.get(`${API_BASE_URL}/exports/attendance`, () => new HttpResponse('Date\r\n', { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="attendance-2026-10.csv"' } }))
  );
});
afterEach(() => vi.restoreAllMocks());

function renderPage(plan: 'basic' | 'professional' = 'professional') {
  const auth: AuthState = {
    user: { id: 'a1', name: 'Ann', email: 'ann@x.com', role: 'ORG_ADMIN', organizationId: 'o1', roleId: null, mustChangePassword: false, permissions: { scope: 'all' }, subscription: activeSubscription(plan) },
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
  render(
    <Provider store={makeTestStore({ auth })}>
      <TeamAttendancePage />
    </Provider>
  );
}

describe('TeamAttendancePage', () => {
  it("shows today's statuses with a summary", async () => {
    renderPage();
    const ivy = (await screen.findByText('Ivy Mehta')).closest('tr') as HTMLElement;
    expect(within(ivy).getByText('In progress')).toBeInTheDocument();
    expect(within(ivy).getByText('Late')).toBeInTheDocument();
    expect(within(ivy).getByText('1h 40m')).toBeInTheDocument();
    expect(within(screen.getByText('Raj Patel').closest('tr') as HTMLElement).getByText('Paid Leave')).toBeInTheDocument();
    expect(within(screen.getByText('Zoe').closest('tr') as HTMLElement).getByText('WFH')).toBeInTheDocument();
    const summary = screen.getByTestId('day-summary');
    expect(summary).toHaveTextContent('In progress: 1');
    expect(summary).toHaveTextContent('Late: 1');
    expect(summary).toHaveTextContent('WFH: 1');
  });

  it('filters by department', async () => {
    renderPage();
    await screen.findByText('Ivy Mehta');
    await userEvent.click(screen.getByRole('combobox', { name: 'Department' }));
    await userEvent.click(await screen.findByTitle('Operations'));
    await waitFor(() => expect(queries.at(-1)).toEqual({ path: 'day', q: expect.objectContaining({ departmentId: 'd2' }) }));
  });

  it('shows the month grid and exports it on Professional', async () => {
    renderPage('professional');
    await screen.findByText('Ivy Mehta');
    await userEvent.click(screen.getByText('Month'));
    expect(await screen.findByTestId('cell-2026-10-01')).toHaveTextContent('P');
    expect(screen.getByTestId('cell-2026-10-02')).toHaveTextContent('A');
    expect(screen.getByText('1 / 1 / 0')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(downloads).toEqual(['attendance-2026-10.csv']));
  });

  it('has no export on Basic', async () => {
    renderPage('basic');
    await screen.findByText('Ivy Mehta');
    await userEvent.click(screen.getByText('Month'));
    await screen.findByTestId('cell-2026-10-01');
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();
  });
});
